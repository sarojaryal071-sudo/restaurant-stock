const { query, transaction } = require('../../database');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { applyRecipeSaleTx } = require('../../recipes');

/**
 * Compute SHA-256 hash of a buffer.
 */
function computeFileHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Save a product mapping.
 */
async function saveProductMapping(restaurantId, sourceProductName, itemId, source = 'flatpay') {
  await query(
    `INSERT INTO sales_product_mappings (restaurant_id, source, source_product_name, item_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (restaurant_id, source, source_product_name)
     DO UPDATE SET item_id = $4, updated_at = NOW()`,
    [restaurantId, source, sourceProductName, itemId]
  );
}

/**
 * Get all mappings for a restaurant + source.
 */
async function getMappings(restaurantId, source = 'flatpay') {
  const res = await query(
    `SELECT source_product_name, item_id FROM sales_product_mappings WHERE restaurant_id = $1 AND source = $2`,
    [restaurantId, source]
  );

  const map = {};
  for (const row of res.rows) {
    map[row.source_product_name] = row.item_id;
  }
  return map;
}

/**
 * Check if an import with the given file hash already exists for the restaurant.
 */
async function importExists(restaurantId, fileHash) {
  const res = await query(
    `SELECT id FROM sales_imports WHERE restaurant_id = $1 AND file_hash = $2`,
    [restaurantId, fileHash]
  );
  return res.rows.length > 0;
}

/**
 * Record a sales import and its items, update stocks and insert pos_sales rows.
 * Runs inside a transaction provided by the caller.
 *
 * items may contain:
 *   { type: 'inventory', itemId, sourceProductName, quantitySold }
 *   { type: 'recipe', recipeId, sourceProductName, quantitySold }
 */
async function applyImport(tx, importId, restaurantId, userId, items, fileHash, periodStart, periodEnd) {
  // Insert import header
  await tx(
    `INSERT INTO sales_imports (id, restaurant_id, imported_by, source, period_start, period_end, file_hash)
     VALUES ($1, $2, $3, 'flatpay', $4, $5, $6)`,
    [importId, restaurantId, userId, periodStart || null, periodEnd || null, fileHash]
  );

  for (const item of items) {
    const productName = item.sourceProductName || 'Unknown';

    if (item.type === 'recipe') {
      // Reuse the authoritative recipe sale/deduction engine.
      await applyRecipeSaleTx(
        tx,
        restaurantId,
        userId,
        item.recipeId,
        item.quantitySold,
        'CSV_RECIPE_SALE',
        `Recipe "${productName}" imported from CSV and sold x${item.quantitySold}`
      );

      await tx(
        `INSERT INTO pos_sales (restaurant_id, provider, product_name, quantity, sold_at)
         VALUES ($1, 'flatpay', $2, $3, NOW())`,
        [restaurantId, productName, item.quantitySold]
      );

      continue;
    }

    // Direct inventory item sale.
    const itemId = item.itemId;
    const quantitySold = item.quantitySold;

    // Insert import item
    await tx(
      `INSERT INTO sales_import_items (id, import_id, item_id, source_product_name, quantity_sold)
       VALUES ($1, $2, $3, $4, $5)`,
      [uuidv4(), importId, itemId, productName, quantitySold]
    );

    // Decrement stock
    const stockRes = await tx(
      `SELECT quantity FROM stocks WHERE item_id = $1 AND restaurant_id = $2`,
      [itemId, restaurantId]
    );
    const current = stockRes.rows.length > 0 ? parseFloat(stockRes.rows[0].quantity) : 0;
    const newQty = current - quantitySold;

    const negSetting = await tx(
      `SELECT value FROM settings WHERE key = 'negativeStockAllowed'`
    );
    const negativeAllowed = negSetting.rows.length > 0 ? negSetting.rows[0].value === 'true' : false;

    if (!negativeAllowed && newQty < 0) {
      throw { code: 'NEGATIVE_STOCK_NOT_ALLOWED', error: `Insufficient stock for item ${itemId}.` };
    }

    // Upsert stock
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

    // Insert into canonical pos_sales for sales summary
    await tx(
      `INSERT INTO pos_sales (restaurant_id, provider, product_name, quantity, sold_at)
       VALUES ($1, 'flatpay', $2, $3, NOW())`,
      [restaurantId, productName, quantitySold]
    );
  }
}

module.exports = {
  computeFileHash,
  saveProductMapping,
  getMappings,
  importExists,
  applyImport
};