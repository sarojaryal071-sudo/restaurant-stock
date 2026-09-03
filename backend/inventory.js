const { v4: uuidv4 } = require('uuid');
const { query, transaction } = require('./database');

// -------------------------------------------------------------------
// Helper: write log entry
// -------------------------------------------------------------------
async function writeLog(action, details, restaurantId, userId) {
  await query(
    `INSERT INTO logs (id, action, details, user_id, restaurant_id, timestamp)
     VALUES ($1, $2, $3, $4, $5, NOW())`,
    [uuidv4(), action, details, userId || null, restaurantId || null]
  );
}

// -------------------------------------------------------------------
// Helper: validate reason / unit against database
// -------------------------------------------------------------------
async function isValidReason(reason) {
  if (!reason) return false;
  const res = await query(
    `SELECT id FROM inventory_adjustment_reasons WHERE value = $1 AND enabled = TRUE`,
    [reason]
  );
  return res.rows.length > 0;
}

async function isValidUnit(unit) {
  if (!unit) return true;
  const res = await query(
    `SELECT id FROM inventory_units WHERE value = $1 AND enabled = TRUE`,
    [unit]
  );
  return res.rows.length > 0;
}

// -------------------------------------------------------------------
// loadStock – returns nested categories → items with quantities
// -------------------------------------------------------------------
async function loadStock(req, res) {
  const { restaurantId } = req.auth;

  try {
    // Categories (active, ordered)
    const catRes = await query(
      `SELECT id, name FROM categories
       WHERE restaurant_id = $1 AND is_deleted = FALSE
       ORDER BY sort_order ASC`,
      [restaurantId]
    );

    const categories = [];

    for (const cat of catRes.rows) {
      // Items in this category (active)
      const itemRes = await query(
        `SELECT i.id, i.name, i.unit, i.volume, i.volume_unit,
                i.sales_volume, i.sales_volume_unit, i.serving_name,
                COALESCE(s.quantity, 0) AS qty
         FROM items i
         LEFT JOIN stocks s ON i.id = s.item_id AND s.restaurant_id = $1
         WHERE i.category_id = $2 AND i.is_deleted = FALSE AND i.restaurant_id = $1
         ORDER BY i.name ASC`,
        [restaurantId, cat.id]
      );

      const items = itemRes.rows.map(item => {
        const qty = parseFloat(item.qty) || 0;
        const volume = item.volume !== null && item.volume !== undefined ? parseFloat(item.volume) : null;
        const volumeUnit = item.volume_unit || null;

        let remainingVolume = null;
        let remainingVolumeUnit = null;

        if (volume !== null && volumeUnit) {
          const wholeUnits = Math.floor(Math.abs(qty) + Number.EPSILON) * (qty < 0 ? -1 : 1);
          const fractionalUnits = qty - wholeUnits;
          const rawRemainingVolume = fractionalUnits * volume;

          remainingVolumeUnit = volumeUnit;
          remainingVolume = Number(rawRemainingVolume.toFixed(3));
        }

        return {
          id: item.id,
          name: item.name,
          unit: item.unit || undefined,
          volume,
          volumeUnit,
          salesVolume: item.sales_volume !== null && item.sales_volume !== undefined
            ? parseFloat(item.sales_volume)
            : null,
          salesVolumeUnit: item.sales_volume_unit || null,
          servingName: item.serving_name || null,
          qty,
          remainingVolume,
          remainingVolumeUnit
        };
      });

      categories.push({
        id: cat.id,
        name: cat.name,
        icon: 'default',
        items
      });
    }

    res.json({ ok: true, categories });
  } catch (err) {
    console.error('loadStock error:', err);
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: err.message });
  }
}

// -------------------------------------------------------------------
// saveStock – requires reason for every change, records adjustments
// -------------------------------------------------------------------
async function saveStock(req, res) {
  const { restaurantId, userId } = req.auth;
  const updates = req.body.updates || [];   // array of { itemId, quantity, reason?, note? }

  try {
    if (!Array.isArray(updates) || updates.length === 0) {
      return res.json({ ok: false, code: 'VALIDATION_ERROR', error: 'No updates provided.' });
    }

    let changed;   // <--- declared here, before the transaction

    await transaction(async (tx) => {
      // 1. Load current stock and item names for this restaurant
      const stockRows = await tx(
        `SELECT item_id, quantity FROM stocks WHERE restaurant_id = $1`,
        [restaurantId]
      );
      const stockMap = {};
      for (const r of stockRows.rows) {
        stockMap[r.item_id] = parseFloat(r.quantity) || 0;
      }

      const itemRows = await tx(
        `SELECT id, name FROM items WHERE restaurant_id = $1 AND is_deleted = FALSE`,
        [restaurantId]
      );
      const itemMap = {};
      for (const r of itemRows.rows) { itemMap[r.id] = r.name; }

      // 2. Collect only items whose quantity actually changes, validate reasons
      changed = [];   // <--- initialized here
      for (const upd of updates) {
        const itemId = upd.itemId;
        const newQty = parseFloat(upd.quantity);
        if (!itemId || isNaN(newQty)) continue;

        // Verify item exists and is not deleted
        const itemRes = await tx(
          `SELECT id FROM items WHERE id = $1 AND restaurant_id = $2 AND is_deleted = FALSE`,
          [itemId, restaurantId]
        );
        if (itemRes.rows.length === 0) continue;

        const oldQty = stockMap[itemId] || 0;
        if (newQty === oldQty) continue;   // no change → skip

        // Reason required for every change
        const reason = (upd.reason || '').trim();
        if (!reason) throw { code: 'VALIDATION_ERROR', error: `Reason is required for item "${itemMap[itemId] || itemId}".` };

        // Determine direction from quantity change
        const direction = newQty > oldQty ? 'increase' : 'decrease';

        // Validate reason against the database – must exist, be enabled, and have the correct direction
        const reasonCheck = await tx(
          `SELECT id FROM inventory_adjustment_reasons WHERE value = $1 AND enabled = TRUE AND direction = $2`,
          [reason, direction]
        );
        if (reasonCheck.rows.length === 0) {
          throw { code: 'VALIDATION_ERROR', error: `Invalid reason "${reason}" for a ${direction} adjustment on item "${itemMap[itemId] || itemId}".` };
        }

        // Special handling for "other" reasons – note required
        if (reason.startsWith('other_') && !(upd.note || '').trim()) {
          throw { code: 'VALIDATION_ERROR', error: `A note is required when reason is "Other" for item "${itemMap[itemId] || itemId}".` };
        }

        changed.push({ itemId, oldQty, newQty, reason, note: (upd.note || '').trim() });
      }

      // 3. If nothing changed, exit early (still OK)
      if (changed.length === 0) return;

      // 4. Create adjustment header
      const adjId = uuidv4();
      await tx(
        `INSERT INTO inventory_adjustments (id, restaurant_id, user_id) VALUES ($1, $2, $3)`,
        [adjId, restaurantId, userId || null]
      );

      // 5. Update stocks and create adjustment item rows
      for (const c of changed) {
        const diff = c.newQty - c.oldQty;

        // Upsert stock (set absolute quantity)
        const stockRes = await tx(
          `SELECT id FROM stocks WHERE item_id = $1 AND restaurant_id = $2`,
          [c.itemId, restaurantId]
        );
        if (stockRes.rows.length > 0) {
          await tx(
            `UPDATE stocks SET quantity = $1, updated_at = NOW() WHERE item_id = $2 AND restaurant_id = $3`,
            [Math.max(0, c.newQty), c.itemId, restaurantId]
          );
        } else {
          await tx(
            `INSERT INTO stocks (id, item_id, restaurant_id, quantity, updated_at)
             VALUES ($1, $2, $3, $4, NOW())`,
            [uuidv4(), c.itemId, restaurantId, Math.max(0, c.newQty)]
          );
        }

        // Record adjustment item
        await tx(
          `INSERT INTO inventory_adjustment_items (id, adjustment_id, item_id, old_quantity, new_quantity, difference, reason, note)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [uuidv4(), adjId, c.itemId, c.oldQty, c.newQty, diff, c.reason, c.note || null]
        );
      }
    });

    await writeLog('BATCH_SAVE', `Adjustment recorded for ${changed.length} items`, restaurantId, userId);
    res.json({ ok: true });
  } catch (err) {
    if (err.code) return res.json({ ok: false, code: err.code, error: err.error });
    console.error('saveStock error:', err);
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: err.message });
  }
}

// -------------------------------------------------------------------
// addCustomItem (with unit validation)
// -------------------------------------------------------------------
async function addCustomItem(req, res) {
  const { restaurantId, userId } = req.auth;
  const {
    categoryId,
    name,
    quantity,
    unit,
    volume,
    volumeUnit,
    salesVolume,
    salesVolumeUnit,
    servingName
  } = req.body;

  if (!categoryId || !name) {
    return res.json({ ok: false, code: 'VALIDATION_ERROR', error: 'Missing categoryId or name' });
  }

  const newUnit = (unit || '').trim();
  if (newUnit && !(await isValidUnit(newUnit))) {
    return res.json({ ok: false, code: 'VALIDATION_ERROR', error: `Invalid unit: ${newUnit}` });
  }

  const parsedVolume = volume !== undefined && volume !== null && volume !== '' ? parseFloat(volume) : null;
  const newVolumeUnit = (volumeUnit || '').trim() || null;

  if (parsedVolume !== null && (isNaN(parsedVolume) || parsedVolume <= 0)) {
    return res.json({ ok: false, code: 'VALIDATION_ERROR', error: 'Volume must be a positive number.' });
  }

  if (parsedVolume !== null && !['ml', 'cl', 'L'].includes(newVolumeUnit)) {
    return res.json({ ok: false, code: 'VALIDATION_ERROR', error: 'Volume unit must be ml, cl, or L.' });
  }

  const parsedSalesVolume = salesVolume !== undefined && salesVolume !== null && salesVolume !== ''
    ? parseFloat(salesVolume)
    : null;
  const newSalesVolumeUnit = (salesVolumeUnit || '').trim() || null;

  if (parsedSalesVolume !== null && (isNaN(parsedSalesVolume) || parsedSalesVolume <= 0)) {
    return res.json({ ok: false, code: 'VALIDATION_ERROR', error: 'Sales volume must be a positive number.' });
  }

  if (parsedSalesVolume !== null && newSalesVolumeUnit && !(await isValidUnit(newSalesVolumeUnit))) {
    return res.json({ ok: false, code: 'VALIDATION_ERROR', error: `Invalid sales volume unit: ${newSalesVolumeUnit}` });
  }

  // Guard against the "silent fallback" risk: a configured serving size in a
  // unit different from the stock unit can only be converted into stock
  // units if the item's physical Volume/Volume Unit are also known
  // (stockUnitsFromSalesServing requires them). Without this, an import
  // could silently treat "6 shots" as "6 bottles". Refuse to save that
  // combination up front rather than letting it reach the deduction path.
  if (parsedSalesVolume !== null && newSalesVolumeUnit) {
    const salesUnitNorm = newSalesVolumeUnit.trim().toLowerCase();
    const stockUnitNorm = newUnit.trim().toLowerCase();
    if (salesUnitNorm !== stockUnitNorm && (parsedVolume === null || !newVolumeUnit)) {
      return res.json({
        ok: false,
        code: 'VALIDATION_ERROR',
        error: 'A serving size in a different unit than "Counted in" requires Volume and Volume Unit to be set first.'
      });
    }
  }

  const newServingName = (servingName || '').trim() || null;

  try {
    const itemId = uuidv4();
    const qty = parseFloat(quantity) || 0;

    await transaction(async (tx) => {
      await tx(
        `INSERT INTO items (id, name, category_id, unit, default_quantity, restaurant_id, is_default, is_deleted, container_volume, volume, volume_unit, sales_volume, sales_volume_unit, serving_name, created_at)
         VALUES ($1, $2, $3, $4, 0, $5, FALSE, FALSE, NULL, $6, $7, $8, $9, $10, NOW())`,
        [itemId, name, categoryId, newUnit, restaurantId, parsedVolume, newVolumeUnit, parsedSalesVolume, newSalesVolumeUnit, newServingName]
      );
      await tx(
        `INSERT INTO stocks (id, item_id, restaurant_id, quantity, updated_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [uuidv4(), itemId, restaurantId, qty]
      );
    });

    await writeLog('ADD_CUSTOM_ITEM', `Item "${name}" added`, restaurantId, userId);
    res.json({ ok: true, item: { id: itemId, name, qty, custom: true, servingName: newServingName } });
  } catch (err) {
    console.error('addCustomItem error:', err);
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: err.message });
  }
}

// -------------------------------------------------------------------
// resolveServingName - the serving_name to save for an updateItem call.
//
// `servingName` is optional/nullable: omitted from the request means
// "leave it as-is", while an empty string or an explicit `null` means
// "the user cleared it". Those must never be handled with `String(x)` -
// in JavaScript, String(null) is the literal text "null", not an empty
// string, so a naive `String(servingName).trim() || null` would save the
// actual word "null" into the database the moment someone cleared the
// field. `(servingName || '').trim() || null` treats null/undefined/''
// identically as "no value", which is the only correct behavior here.
// -------------------------------------------------------------------
function resolveServingName(servingName, existingServingName) {
  return servingName !== undefined
    ? ((servingName || '').trim() || null)
    : (existingServingName || null);
}

// -------------------------------------------------------------------
// updateItem
// -------------------------------------------------------------------
async function updateItem(req, res) {
  const { restaurantId, userId } = req.auth;
  const {
    itemId,
    name,
    unit,
    defaultQuantity,
    categoryId,
    containerVolume,
    volume,
    volumeUnit,
    salesVolume,
    salesVolumeUnit,
    servingName
  } = req.body;

  if (!itemId) return res.json({ ok: false, code: 'VALIDATION_ERROR', error: 'Missing itemId' });

  try {
    // Fetch existing item
    const existing = await query(
      `SELECT * FROM items WHERE id = $1 AND restaurant_id = $2 AND is_deleted = FALSE`,
      [itemId, restaurantId]
    );
    if (existing.rows.length === 0) {
      return res.json({ ok: false, code: 'NOT_FOUND', error: 'Item not found' });
    }

    // Guard against the same null->"null" bug fixed in resolveServingName:
    // `name || ''` before String() so an explicit null never survives as
    // the literal text "null" (which would also slip past the "cannot be
    // empty" check below, since a non-empty string is truthy).
    const newName = name !== undefined ? String(name || '').trim() : existing.rows[0].name;
    const newUnit = unit !== undefined ? unit : existing.rows[0].unit;
    const newDefaultQty = defaultQuantity !== undefined ? parseFloat(defaultQuantity) || 0 : parseFloat(existing.rows[0].default_quantity) || 0;
    const newCategoryId = categoryId || existing.rows[0].category_id;
    const newContainerVolume = containerVolume !== undefined ? parseInt(containerVolume, 10) || null : existing.rows[0].container_volume;

    let newVolume;
    let newVolumeUnit;

    if (volume !== undefined && volume !== null && volume !== '') {
      newVolume = parseFloat(volume);
      if (isNaN(newVolume) || newVolume <= 0) {
        return res.json({ ok: false, code: 'VALIDATION_ERROR', error: 'Volume must be a positive number.' });
      }
      newVolumeUnit = (volumeUnit || '').trim() || null;
      if (!['ml', 'cl', 'L'].includes(newVolumeUnit)) {
        return res.json({ ok: false, code: 'VALIDATION_ERROR', error: 'Volume unit must be ml, cl, or L.' });
      }
    } else {
      newVolume = null;
      newVolumeUnit = null;
    }

    let newSalesVolume;
    let newSalesVolumeUnit;

    if (salesVolume !== undefined && salesVolume !== null && salesVolume !== '') {
      newSalesVolume = parseFloat(salesVolume);
      if (isNaN(newSalesVolume) || newSalesVolume <= 0) {
        return res.json({ ok: false, code: 'VALIDATION_ERROR', error: 'Sales volume must be a positive number.' });
      }
      newSalesVolumeUnit = (salesVolumeUnit || '').trim() || null;
      if (newSalesVolumeUnit && !(await isValidUnit(newSalesVolumeUnit))) {
        return res.json({ ok: false, code: 'VALIDATION_ERROR', error: `Invalid sales volume unit: ${newSalesVolumeUnit}` });
      }
    } else {
      newSalesVolume = null;
      newSalesVolumeUnit = null;
    }

    // Guard against the "silent fallback" risk: a configured serving size in
    // a unit different from the stock unit can only be converted into stock
    // units if the item's physical Volume/Volume Unit are also known
    // (stockUnitsFromSalesServing requires them). Without this, an import
    // could silently treat "6 shots" as "6 bottles". Refuse to save that
    // combination up front rather than letting it reach the deduction path.
    if (newSalesVolume !== null && newSalesVolumeUnit) {
      const salesUnitNorm = newSalesVolumeUnit.trim().toLowerCase();
      const stockUnitNorm = (newUnit || '').trim().toLowerCase();
      if (salesUnitNorm !== stockUnitNorm && (newVolume === null || !newVolumeUnit)) {
        return res.json({
          ok: false,
          code: 'VALIDATION_ERROR',
          error: 'A serving size in a different unit than "Counted in" requires Volume and Volume Unit to be set first.'
        });
      }
    }

    const newServingName = resolveServingName(servingName, existing.rows[0].serving_name);

    if (!newName) return res.json({ ok: false, code: 'VALIDATION_ERROR', error: 'Item name cannot be empty' });

    // Duplicate name check (within same category)
    const dupCheck = await query(
      `SELECT id FROM items WHERE LOWER(name) = LOWER($1) AND category_id = $2 AND restaurant_id = $3 AND id != $4 AND is_deleted = FALSE`,
      [newName, newCategoryId, restaurantId, itemId]
    );
    if (dupCheck.rows.length > 0) {
      return res.json({ ok: false, code: 'DUPLICATE_NAME', error: 'An item with that name already exists in this category' });
    }

        // Validate unit (if provided and non-empty)
    if (newUnit && !(await isValidUnit(newUnit))) {
      return res.json({ ok: false, code: 'VALIDATION_ERROR', error: `Invalid unit: ${newUnit}` });
    }

    await query(
      `UPDATE items SET name = $1, category_id = $2, unit = $3, default_quantity = $4, container_volume = $5, volume = $6, volume_unit = $7, sales_volume = $8, sales_volume_unit = $9, serving_name = $10
       WHERE id = $11 AND restaurant_id = $12`,
      [newName, newCategoryId, newUnit, newDefaultQty, newContainerVolume, newVolume, newVolumeUnit, newSalesVolume, newSalesVolumeUnit, newServingName, itemId, restaurantId]
    );

    await writeLog('UPDATE_ITEM', `Item "${newName}" updated`, restaurantId, userId);
    res.json({ ok: true, item: { id: itemId, name: newName, unit: newUnit, defaultQuantity: newDefaultQty, categoryId: newCategoryId, containerVolume: newContainerVolume, volume: newVolume, volumeUnit: newVolumeUnit, salesVolume: newSalesVolume, salesVolumeUnit: newSalesVolumeUnit, servingName: newServingName } });
  } catch (err) {
    console.error('updateItem error:', err);
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: err.message });
  }
}

// -------------------------------------------------------------------
// deleteItem – permanent deletion
// -------------------------------------------------------------------
// -------------------------------------------------------------------
// deleteItemTx - the actual dependency-check + cleanup + delete logic,
// factored out to take `tx` as a parameter (same pattern already used by
// posSalesImport.repository.js:applyImport) so it can be exercised with
// a mock transaction in tests, without a live database connection.
// -------------------------------------------------------------------
async function deleteItemTx(tx, itemId, restaurantId) {
  // Check if item is referenced in any recipe; if so, block deletion.
  const refCheck = await tx(
    `SELECT id FROM recipe_ingredients WHERE inventory_item_id = $1 LIMIT 1`,
    [itemId]
  );
  if (refCheck.rows.length > 0) {
    throw { code: 'ITEM_IN_USE', error: 'Item is used in one or more recipes. Remove it from recipes first.' };
  }

  // Check every other table with a foreign key on items.id for
  // historical/operational records that must never be silently lost.
  // A single round trip - this is a rare, interactive action, not a
  // hot path, so clarity matters more than shaving a query here.
  // NOTE: inventory_adjustments is only the batch/header row (id,
  // restaurant_id, user_id, created_at) - it has no item_id column.
  // The actual per-item foreign key lives on inventory_adjustment_items.
  const depCheck = await tx(
    `SELECT
       EXISTS(SELECT 1 FROM sales_import_items WHERE item_id = $1) AS has_sales_import_items,
       EXISTS(SELECT 1 FROM sales_import_effects WHERE item_id = $1) AS has_sales_import_effects,
       EXISTS(SELECT 1 FROM stock_intake_items WHERE item_id = $1) AS has_stock_intake,
       EXISTS(SELECT 1 FROM inventory_adjustment_items WHERE item_id = $1) AS has_adjustment_items,
       EXISTS(SELECT 1 FROM pending_allocation_details WHERE inventory_item_id = $1) AS has_pending_allocations,
       EXISTS(SELECT 1 FROM allocation_logs WHERE old_inventory_item_id = $1 OR new_inventory_item_id = $1) AS has_allocation_logs,
       EXISTS(SELECT 1 FROM product_barcodes WHERE inventory_item_id = $1) AS has_barcodes`,
    [itemId]
  );

  const dep = depCheck.rows[0];
  const reasons = [];
  if (dep.has_sales_import_items || dep.has_sales_import_effects) reasons.push('historical sales records');
  if (dep.has_stock_intake) reasons.push('historical stock intake (purchase) records');
  if (dep.has_adjustment_items) reasons.push('historical inventory adjustment records');
  if (dep.has_pending_allocations || dep.has_allocation_logs) reasons.push('pending or resolved stock allocation records');
  if (dep.has_barcodes) reasons.push('a saved barcode association');

  if (reasons.length > 0) {
    throw {
      code: 'ITEM_IN_USE',
      error: `This item cannot be deleted because it is already used in existing records (${reasons.join(', ')}). Remove those references first, or stop using this item going forward instead of deleting it.`
    };
  }

  // Current-state stock, not historical: a stocks row simply records
  // "how much is on hand right now". A positive quantity means real
  // inventory would be silently discarded, so that still blocks
  // deletion - but a zero quantity is nothing but bookkeeping and is
  // safe to clear as part of removing the item (Case D).
  const stockRes = await tx(
    `SELECT COALESCE(SUM(quantity), 0) AS total_quantity FROM stocks WHERE item_id = $1 AND restaurant_id = $2`,
    [itemId, restaurantId]
  );
  const totalQuantity = parseFloat(stockRes.rows[0].total_quantity) || 0;

  if (totalQuantity > 0) {
    throw {
      code: 'ITEM_HAS_STOCK',
      error: `This item still has ${totalQuantity} in stock and cannot be deleted while stock remains. Reduce the stock to zero first, or keep the item instead of deleting it.`
    };
  }

  // A saved Sales product mapping is a routing pointer ("this POS
  // product name resolves to this item"), not a record of anything
  // that happened - safe to clean up as part of deleting its target,
  // unlike the historical tables checked above. Removed in the same
  // transaction as the item delete, so a failure below rolls it back
  // too - no partially-cleaned state.
  await tx(`DELETE FROM sales_product_mappings WHERE item_id = $1`, [itemId]);

  // The stocks row(s) are confirmed zero-quantity at this point (also
  // covered by ON DELETE CASCADE, kept explicit for clarity).
  await tx(`DELETE FROM stocks WHERE item_id = $1 AND restaurant_id = $2`, [itemId, restaurantId]);
  // Delete the item.
  await tx(`DELETE FROM items WHERE id = $1 AND restaurant_id = $2`, [itemId, restaurantId]);
}

// -------------------------------------------------------------------
// mapDeleteError - turns a caught error from deleteItemTx into the
// { status, code, error } response shape. Factored out so the mapping
// itself (including the raw-PostgreSQL-error fallback) can be tested
// directly with plain error objects, no HTTP or DB involved.
// -------------------------------------------------------------------
function mapDeleteError(err) {
  // An error this module threw itself always carries both a semantic
  // `.code` (e.g. 'ITEM_IN_USE') and a real `.error` message - safe to
  // forward as-is, with a normal 200-with-ok:false response (it's an
  // expected, handled outcome, not a server fault).
  if (err.code && err.error) {
    return { status: 200, code: err.code, error: err.error };
  }

  // A raw PostgreSQL error has a `.code` that is a SQLSTATE (e.g.
  // '23503' for a foreign-key violation) and its message is on
  // `.message`, not `.error` - never read `.error` off one of these,
  // it doesn't exist there. 23503 specifically means some dependency
  // this function's checks didn't anticipate still exists - handle it
  // the same way as a known dependency instead of leaking a SQLSTATE.
  if (err.code === '23503') {
    return {
      status: 200,
      code: 'ITEM_IN_USE',
      error: 'This item cannot be deleted because it is already used in existing records. Remove those references first, or stop using this item going forward instead of deleting it.'
    };
  }

  // Genuinely unexpected error - a real HTTP 500, but still with a
  // usable message in the body (the frontend now reads it - see
  // frontend/js/api.js) instead of only a bare status code.
  return { status: 500, code: 'SERVER_ERROR', error: err.message || 'Failed to delete item.' };
}

async function deleteItem(req, res) {
  const { restaurantId, userId } = req.auth;
  const { itemId } = req.body;
  if (!itemId) return res.json({ ok: false, code: 'VALIDATION_ERROR', error: 'Missing itemId' });

  try {
    const item = await query(
      `SELECT id, name FROM items WHERE id = $1 AND restaurant_id = $2`,
      [itemId, restaurantId]
    );
    if (item.rows.length === 0) return res.json({ ok: false, code: 'NOT_FOUND', error: 'Item not found' });

    await transaction(tx => deleteItemTx(tx, itemId, restaurantId));

    await writeLog('DELETE_ITEM', `Item "${item.rows[0].name}" permanently deleted`, restaurantId, userId);
    res.json({ ok: true });
  } catch (err) {
    console.error('deleteItem error:', err);
    const mapped = mapDeleteError(err);
    res.status(mapped.status).json({ ok: false, code: mapped.code, error: mapped.error });
  }
}
// -------------------------------------------------------------------
// restoreItem – not supported (permanent delete), stub for compatibility
// -------------------------------------------------------------------
async function restoreItem(req, res) {
  return res.json({ ok: false, code: 'NOT_FOUND', error: 'Restore not available; items are permanently deleted.' });
}

// -------------------------------------------------------------------
// addCategory
// -------------------------------------------------------------------
async function addCategory(req, res) {
  const { restaurantId, userId } = req.auth;
  const { name } = req.body;
  if (!name || !String(name).trim()) {
    return res.json({ ok: false, code: 'VALIDATION_ERROR', error: 'Category name is required' });
  }
  const trimmedName = String(name).trim();

  try {
    // Duplicate check
    const dup = await query(
      `SELECT id FROM categories WHERE LOWER(name) = LOWER($1) AND restaurant_id = $2 AND is_deleted = FALSE`,
      [trimmedName, restaurantId]
    );
    if (dup.rows.length > 0) {
      return res.json({ ok: false, code: 'DUPLICATE_CATEGORY', error: 'A category with this name already exists' });
    }

    // Compute next sort order
    const maxOrder = await query(
      `SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM categories WHERE restaurant_id = $1 AND is_deleted = FALSE`,
      [restaurantId]
    );
    const sortOrder = parseInt(maxOrder.rows[0].max_order) + 1;

    const categoryId = uuidv4();
    await query(
      `INSERT INTO categories (id, name, restaurant_id, sort_order, is_deleted, created_at)
       VALUES ($1, $2, $3, $4, FALSE, NOW())`,
      [categoryId, trimmedName, restaurantId, sortOrder]
    );

    await writeLog('ADD_CATEGORY', `Category "${trimmedName}" added`, restaurantId, userId);
    res.json({ ok: true, category: { id: categoryId, name: trimmedName, restaurantId, sortOrder, isDeleted: false } });
  } catch (err) {
    console.error('addCategory error:', err);
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: err.message });
  }
}

// -------------------------------------------------------------------
// updateCategory
// -------------------------------------------------------------------
async function updateCategory(req, res) {
  const { restaurantId, userId } = req.auth;
  const { categoryId, name, sortOrder } = req.body;
  if (!categoryId) return res.json({ ok: false, code: 'VALIDATION_ERROR', error: 'Missing categoryId' });

  try {
    const existing = await query(
      `SELECT * FROM categories WHERE id = $1 AND restaurant_id = $2 AND is_deleted = FALSE`,
      [categoryId, restaurantId]
    );
    if (existing.rows.length === 0) {
      return res.json({ ok: false, code: 'NOT_FOUND', error: 'Category not found' });
    }

    // Same null->"null" guard as updateItem's resolveServingName.
    const newName = name !== undefined ? String(name || '').trim() : existing.rows[0].name;
    const newSortOrder = sortOrder !== undefined ? parseInt(sortOrder, 10) : existing.rows[0].sort_order;

    if (!newName) return res.json({ ok: false, code: 'VALIDATION_ERROR', error: 'Category name cannot be empty' });

    // Duplicate name check (exclude self)
    const dup = await query(
      `SELECT id FROM categories WHERE LOWER(name) = LOWER($1) AND restaurant_id = $2 AND id != $3 AND is_deleted = FALSE`,
      [newName, restaurantId, categoryId]
    );
    if (dup.rows.length > 0) {
      return res.json({ ok: false, code: 'DUPLICATE_CATEGORY', error: 'A category with this name already exists' });
    }

    await query(
      `UPDATE categories SET name = $1, sort_order = $2 WHERE id = $3 AND restaurant_id = $4`,
      [newName, newSortOrder, categoryId, restaurantId]
    );

    await writeLog('UPDATE_CATEGORY', `Category "${newName}" updated`, restaurantId, userId);
    res.json({ ok: true, category: { id: categoryId, name: newName, restaurantId, sortOrder: newSortOrder, isDeleted: false } });
  } catch (err) {
    console.error('updateCategory error:', err);
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: err.message });
  }
}

// -------------------------------------------------------------------
// deleteCategory – permanent deletion (must be empty)
// -------------------------------------------------------------------
async function deleteCategory(req, res) {
  const { restaurantId, userId } = req.auth;
  const { categoryId } = req.body;
  if (!categoryId) return res.json({ ok: false, code: 'VALIDATION_ERROR', error: 'Missing categoryId' });

  try {
    const existing = await query(
      `SELECT * FROM categories WHERE id = $1 AND restaurant_id = $2`,
      [categoryId, restaurantId]
    );
    if (existing.rows.length === 0) return res.json({ ok: false, code: 'NOT_FOUND', error: 'Category not found' });

    // Check if any items exist (including soft‑deleted)
    const items = await query(
      `SELECT id FROM items WHERE category_id = $1 AND restaurant_id = $2`,
      [categoryId, restaurantId]
    );
    if (items.rows.length > 0) {
      return res.json({ ok: false, code: 'CATEGORY_NOT_EMPTY', error: 'Category still contains items. Delete or move them first.' });
    }

    await query(`DELETE FROM categories WHERE id = $1 AND restaurant_id = $2`, [categoryId, restaurantId]);

    await writeLog('DELETE_CATEGORY', `Category "${existing.rows[0].name}" permanently deleted`, restaurantId, userId);
    res.json({ ok: true });
  } catch (err) {
    console.error('deleteCategory error:', err);
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: err.message });
  }
}

// -------------------------------------------------------------------
// restoreCategory – stub (permanent deletion)
// -------------------------------------------------------------------
async function restoreCategory(req, res) {
  return res.json({ ok: false, code: 'NOT_FOUND', error: 'Restore not available; categories are permanently deleted.' });
}

module.exports = {
  loadStock,
  saveStock,
  addCustomItem,
  updateItem,
  deleteItem,
  restoreItem,
  addCategory,
  updateCategory,
  deleteCategory,
  restoreCategory,
  writeLog,
  // Exported for testing without a live DB - see backend/test/deleteItemSafety.test.js
  deleteItemTx,
  mapDeleteError,
  // Exported for testing - see backend/test/servingNameNullBug.test.js
  resolveServingName
};