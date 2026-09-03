const { query, transaction } = require('../../database');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { applyRecipeSaleTx, stockUnitsFromServing, stockUnitsFromSalesServing } = require('../../recipes');

/**
 * Compute SHA-256 hash of a buffer.
 */
function computeFileHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Save or update a product mapping.
 *
 * Accepts either itemId or recipeId, plus an optional raw unit (existing
 * Flatpay/wine variable-pour override) and an optional serving override
 * (servingName/salesVolume/salesVolumeUnit) - the "Save as default for
 * this product" case. Both are independent of the item's own permanent
 * serving_name/sales_volume/sales_volume_unit configuration.
 */
async function saveProductMapping(restaurantId, sourceProductName, itemId = null, recipeId = null, unit = null, source = 'flatpay', serving = {}) {
  const servingName = serving.servingName || null;
  const salesVolume = serving.salesVolume != null && serving.salesVolume !== '' ? serving.salesVolume : null;
  const salesVolumeUnit = serving.salesVolumeUnit || null;

  await query(
    `INSERT INTO sales_product_mappings
       (restaurant_id, source, source_product_name, item_id, recipe_id, unit, serving_name, sales_volume, sales_volume_unit)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (restaurant_id, source, source_product_name)
     DO UPDATE SET
       item_id = EXCLUDED.item_id,
       recipe_id = EXCLUDED.recipe_id,
       unit = EXCLUDED.unit,
       serving_name = EXCLUDED.serving_name,
       sales_volume = EXCLUDED.sales_volume,
       sales_volume_unit = EXCLUDED.sales_volume_unit,
       updated_at = NOW()`,
    [restaurantId, source, sourceProductName, itemId, recipeId, unit, servingName, salesVolume, salesVolumeUnit]
  );
}

/**
 * Get all mappings for a restaurant + source.
 *
 * Returns an object keyed by source_product_name.
 * Each value contains itemId, recipeId, unit, and the saved serving
 * override (servingName/salesVolume/salesVolumeUnit), if any.
 */
async function getMappings(restaurantId, source = 'flatpay') {
  const res = await query(
    `SELECT source_product_name, item_id, recipe_id, unit, serving_name, sales_volume, sales_volume_unit
     FROM sales_product_mappings
     WHERE restaurant_id = $1 AND source = $2`,
    [restaurantId, source]
  );

  const map = {};

  for (const row of res.rows) {
    map[row.source_product_name] = {
      itemId: row.item_id || null,
      recipeId: row.recipe_id || null,
      unit: row.unit || null,
      servingName: row.serving_name || null,
      salesVolume: row.sales_volume != null ? parseFloat(row.sales_volume) : null,
      salesVolumeUnit: row.sales_volume_unit || null
    };
  }

  return map;
}

/**
 * Distinct serving names known to this restaurant, for populating the
 * "Serving name" datalist: the item's own configured names plus any
 * previously saved per-product mapping overrides. Read-only, additive.
 */
async function getKnownServingNames(restaurantId) {
  const res = await query(
    `SELECT DISTINCT serving_name FROM (
       SELECT serving_name FROM items WHERE restaurant_id = $1 AND serving_name IS NOT NULL AND is_deleted = FALSE
       UNION
       SELECT serving_name FROM sales_product_mappings WHERE restaurant_id = $1 AND serving_name IS NOT NULL
     ) names
     ORDER BY serving_name ASC`,
    [restaurantId]
  );

  return res.rows.map(r => r.serving_name);
}

/**
 * Check if an import with the given file hash already exists.
 */
async function importExists(restaurantId, fileHash) {
  const res = await query(
    `SELECT id FROM sales_imports WHERE restaurant_id = $1 AND file_hash = $2`,
    [restaurantId, fileHash]
  );

  return res.rows.length > 0;
}

/**
 * Record sales import and apply stock deductions.
 *
 * Runs inside an existing transaction.
 *
 * items may contain:
 *   { type: 'inventory', itemId, sourceProductName, quantitySold, salesUnit?,
 *     servingName?, salesVolume?, salesVolumeUnit? }
 *   { type: 'recipe', recipeId, sourceProductName, quantitySold }
 *
 * Resolution order for an inventory item (unified, reuses the same
 * conversion engine for every case - see recipes.js):
 *   1. salesUnit (existing Flatpay/wine variable-pour raw-unit override -
 *      quantitySold is already a volume expressed in salesUnit)
 *   2. servingName/salesVolume/salesVolumeUnit sent with this sale - a
 *      per-sale/mapping serving override - or, if none was sent, the
 *      item's own configured serving_name/sales_volume/sales_volume_unit
 *   3. no configuration at all - quantitySold is deducted directly
 *      against the item's stock unit
 */
async function applyImport(tx, importId, restaurantId, userId, items, fileHash, periodStart, periodEnd) {
  await tx(
    `INSERT INTO sales_imports (id, restaurant_id, imported_by, source, period_start, period_end, file_hash)
     VALUES ($1, $2, $3, 'flatpay', $4, $5, $6)`,
    [importId, restaurantId, userId, periodStart || null, periodEnd || null, fileHash]
  );

  for (const item of items) {
    const productName = item.sourceProductName || 'Unknown';

    if (item.type === 'recipe') {
      const deductions = await applyRecipeSaleTx(
        tx,
        restaurantId,
        userId,
        item.recipeId,
        item.quantitySold,
        'CSV_RECIPE_SALE',
        `Recipe "${productName}" imported from CSV and sold x${item.quantitySold}`
      );

      for (const ded of deductions) {
        await tx(
          `INSERT INTO sales_import_effects (id, import_id, item_id, stock_reduction)
           VALUES (gen_random_uuid(), $1, $2, $3)`,
          [importId, ded.itemId, ded.deduction]
        );
      }

      await tx(
        `INSERT INTO pos_sales (restaurant_id, provider, product_name, quantity, sold_at, unit, sales_import_id)
         VALUES ($1, 'flatpay', $2, $3, NOW(), $4, $5)`,
        [restaurantId, productName, item.quantitySold, null, importId]
      );

      continue;
    }

    // Direct inventory item sale.
    const itemId = item.itemId;
    const quantitySold = item.quantitySold;
    const salesUnit = item.salesUnit || null;

    const itemRes = await tx(
      `SELECT id, name, unit, volume, volume_unit, sales_volume, sales_volume_unit, serving_name
       FROM items
       WHERE id = $1 AND restaurant_id = $2 AND is_deleted = FALSE`,
      [itemId, restaurantId]
    );

    if (itemRes.rows.length === 0) {
      throw { code: 'ITEM_NOT_FOUND', error: `Item not found: ${itemId}` };
    }

    const dbItem = itemRes.rows[0];

    // A serving override travels with the sale itself (per-sale edit, or a
    // saved "default for this product" mapping resolved by the service
    // layer before this call) and takes precedence over the item's own
    // permanent configuration. servingName is a label only - it never
    // participates in the conversion, only salesVolume/salesVolumeUnit do.
    const effectiveSalesVolume = item.salesVolume != null && item.salesVolume !== ''
      ? item.salesVolume
      : dbItem.sales_volume;
    const effectiveSalesVolumeUnit = item.salesVolumeUnit || dbItem.sales_volume_unit;
    const effectiveServingName = item.servingName || dbItem.serving_name;

    let stockReduction = quantitySold;
    let displayUnit = dbItem.unit;

    if (salesUnit && dbItem.volume != null && dbItem.volume_unit) {
      // Existing Flatpay/wine variable-pour path - unchanged. quantitySold
      // is already a volume expressed in salesUnit (e.g. a 175ml pour).
      const converted = stockUnitsFromServing(
        quantitySold,
        salesUnit,
        dbItem.volume,
        dbItem.volume_unit
      );

      if (converted !== null && !isNaN(converted)) {
        stockReduction = converted;
      }

      displayUnit = salesUnit;
    } else if (effectiveSalesVolume != null && effectiveSalesVolumeUnit) {
      // A serving is configured - either as a per-sale/mapping override or
      // as the item's own default. quantitySold means "servings sold",
      // not "stock units sold".
      const converted = stockUnitsFromSalesServing(
        quantitySold,
        effectiveSalesVolume,
        effectiveSalesVolumeUnit,
        dbItem.volume,
        dbItem.volume_unit,
        dbItem.unit
      );

      // If the conversion can't actually be computed (most likely a
      // missing or incompatible physical Volume), refuse to guess rather
      // than silently deducting the raw sold count as if it were stock
      // units - this applies just as much to a per-sale override as it
      // does to the item's own configured default.
      if (converted === null || isNaN(converted)) {
        throw {
          code: 'SERVING_CONVERSION_FAILED',
          error: `Cannot convert the serving size for "${dbItem.name}" into stock units. Set the item's physical Volume and Volume Unit, then try importing again.`
        };
      }

      stockReduction = converted;
      displayUnit = effectiveServingName || effectiveSalesVolumeUnit;
    }

    await tx(
      `INSERT INTO sales_import_items (id, import_id, item_id, source_product_name, quantity_sold)
       VALUES ($1, $2, $3, $4, $5)`,
      [uuidv4(), importId, itemId, productName, quantitySold]
    );

    // Record exact stock reduction so cancellation can reverse it later.
    await tx(
      `INSERT INTO sales_import_effects (id, import_id, item_id, stock_reduction)
       VALUES (gen_random_uuid(), $1, $2, $3)`,
      [importId, itemId, stockReduction]
    );

    const stockRes = await tx(
      `SELECT quantity FROM stocks WHERE item_id = $1 AND restaurant_id = $2`,
      [itemId, restaurantId]
    );

    const current = stockRes.rows.length > 0 ? parseFloat(stockRes.rows[0].quantity) : 0;
    const newQty = current - stockReduction;

    const negSetting = await tx(
      `SELECT value FROM settings WHERE key = 'negativeStockAllowed'`
    );

    const negativeAllowed = negSetting.rows.length > 0 ? negSetting.rows[0].value === 'true' : false;

    if (!negativeAllowed && newQty < 0) {
      throw { code: 'NEGATIVE_STOCK_NOT_ALLOWED', error: `Insufficient stock for item ${dbItem.name}.` };
    }

    if (stockRes.rows.length > 0) {
      await tx(
        `UPDATE stocks SET quantity = $1, updated_at = NOW() WHERE item_id = $2 AND restaurant_id = $3`,
        [Math.max(0, newQty), itemId, restaurantId]
      );
    } else {
      await tx(
        `INSERT INTO stocks (id, item_id, restaurant_id, quantity, updated_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [uuidv4(), itemId, restaurantId, Math.max(0, newQty)]
      );
    }

    await tx(
      `INSERT INTO pos_sales (restaurant_id, provider, product_name, quantity, sold_at, unit, sales_import_id)
       VALUES ($1, 'flatpay', $2, $3, NOW(), $4, $5)`,
      [restaurantId, productName, quantitySold, displayUnit || null, importId]
    );
  }
}

async function cancelImport(tx, importId, restaurantId, userId) {
  const importRes = await tx(
    `SELECT id, status
     FROM sales_imports
     WHERE id = $1 AND restaurant_id = $2
     FOR UPDATE`,
    [importId, restaurantId]
  );

  if (importRes.rows.length === 0) {
    throw { code: 'NOT_FOUND', error: 'Sales import not found.' };
  }

  if (importRes.rows[0].status === 'cancelled') {
    throw { code: 'ALREADY_CANCELLED', error: 'Sales import is already cancelled.' };
  }

  const effects = await tx(
    `SELECT item_id, stock_reduction
     FROM sales_import_effects
     WHERE import_id = $1`,
    [importId]
  );

  for (const effect of effects.rows) {
    const stockReduction = parseFloat(effect.stock_reduction);

    await tx(
      `UPDATE stocks
       SET quantity = quantity + $1, updated_at = NOW()
       WHERE item_id = $2 AND restaurant_id = $3`,
      [stockReduction, effect.item_id, restaurantId]
    );
  }

  await tx(
    `UPDATE sales_imports
     SET status = 'cancelled',
         cancelled_at = NOW(),
         cancelled_by = $1
     WHERE id = $2 AND restaurant_id = $3`,
    [userId || null, importId, restaurantId]
  );

  // Do NOT delete pos_sales rows.
  // They remain for historical audit and are excluded from active sales summary
  // by filtering on sales_imports.status = 'active'.

  await tx(
    `INSERT INTO logs (id, action, details, user_id, restaurant_id, timestamp)
     VALUES (gen_random_uuid(), 'CANCEL_SALES_IMPORT', $1, $2, $3, NOW())`,
    [`Sales import ${importId} cancelled and stock reversed`, userId, restaurantId]
  );
}

async function listImports(restaurantId, start, end) {
  let sql = `
    SELECT si.id,
           si.created_at,
           si.status,
           si.cancelled_at,
           ps.product_name,
           ps.quantity,
           ps.unit,
           ps.sold_at
    FROM sales_imports si
    LEFT JOIN pos_sales ps ON ps.sales_import_id = si.id
    WHERE si.restaurant_id = $1
  `;

  const params = [restaurantId];

  if (start) {
    sql += ` AND si.created_at >= $${params.push(start)}`;
  }

  if (end) {
    sql += ` AND si.created_at <= $${params.push(end)}`;
  }

  sql += ` ORDER BY si.created_at DESC, ps.sold_at ASC`;

  const res = await query(sql, params);
  const map = new Map();

  for (const row of res.rows) {
    if (!map.has(row.id)) {
      map.set(row.id, {
        id: row.id,
        createdAt: row.created_at,
        status: row.status,
        cancelledAt: row.cancelled_at || null,
        items: []
      });
    }

    if (row.product_name) {
      map.get(row.id).items.push({
        productName: row.product_name,
        quantity: parseFloat(row.quantity) || 0,
        unit: row.unit || null,
        soldAt: row.sold_at
      });
    }
  }

  return Array.from(map.values());
}

module.exports = {
  computeFileHash,
  saveProductMapping,
  getMappings,
  getKnownServingNames,
  importExists,
  applyImport,
  cancelImport,
  listImports
};