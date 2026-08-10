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
        `SELECT i.id, i.name, COALESCE(s.quantity, 0) AS qty
         FROM items i
         LEFT JOIN stocks s ON i.id = s.item_id AND s.restaurant_id = $1
         WHERE i.category_id = $2 AND i.is_deleted = FALSE AND i.restaurant_id = $1
         ORDER BY i.name ASC`,
        [restaurantId, cat.id]
      );

      const items = itemRes.rows.map(item => ({
        id: item.id,
        name: item.name,
        qty: parseFloat(item.qty) || 0
      }));

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
      const changed = [];
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
  const { categoryId, name, quantity, unit } = req.body;
  if (!categoryId || !name) {
    return res.json({ ok: false, code: 'VALIDATION_ERROR', error: 'Missing categoryId or name' });
  }

  const newUnit = (unit || '').trim();
  if (newUnit && !(await isValidUnit(newUnit))) {
    return res.json({ ok: false, code: 'VALIDATION_ERROR', error: `Invalid unit: ${newUnit}` });
  }

  try {
    const itemId = uuidv4();
    const qty = parseFloat(quantity) || 0;

    await transaction(async (tx) => {
      await tx(
        `INSERT INTO items (id, name, category_id, unit, default_quantity, restaurant_id, is_default, is_deleted, container_volume, created_at)
         VALUES ($1, $2, $3, $4, 0, $5, FALSE, FALSE, NULL, NOW())`,
        [itemId, name, categoryId, newUnit, restaurantId]
      );
      await tx(
        `INSERT INTO stocks (id, item_id, restaurant_id, quantity, updated_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [uuidv4(), itemId, restaurantId, qty]
      );
    });

    await writeLog('ADD_CUSTOM_ITEM', `Item "${name}" added`, restaurantId, userId);
    res.json({ ok: true, item: { id: itemId, name, qty, custom: true } });
  } catch (err) {
    console.error('addCustomItem error:', err);
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: err.message });
  }
}

// -------------------------------------------------------------------
// updateItem
// -------------------------------------------------------------------
async function updateItem(req, res) {
  const { restaurantId, userId } = req.auth;
  const { itemId, name, unit, defaultQuantity, categoryId, containerVolume } = req.body;
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

    const newName = name !== undefined ? String(name).trim() : existing.rows[0].name;
    const newUnit = unit !== undefined ? unit : existing.rows[0].unit;
    const newDefaultQty = defaultQuantity !== undefined ? parseFloat(defaultQuantity) || 0 : parseFloat(existing.rows[0].default_quantity) || 0;
    const newCategoryId = categoryId || existing.rows[0].category_id;
    const newContainerVolume = containerVolume !== undefined ? parseInt(containerVolume, 10) || null : existing.rows[0].container_volume;

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
      `UPDATE items SET name = $1, category_id = $2, unit = $3, default_quantity = $4, container_volume = $5
       WHERE id = $6 AND restaurant_id = $7`,
      [newName, newCategoryId, newUnit, newDefaultQty, newContainerVolume, itemId, restaurantId]
    );

    await writeLog('UPDATE_ITEM', `Item "${newName}" updated`, restaurantId, userId);
    res.json({ ok: true, item: { id: itemId, name: newName, unit: newUnit, defaultQuantity: newDefaultQty, categoryId: newCategoryId, containerVolume: newContainerVolume } });
  } catch (err) {
    console.error('updateItem error:', err);
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: err.message });
  }
}

// -------------------------------------------------------------------
// deleteItem – permanent deletion
// -------------------------------------------------------------------
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

    await transaction(async (tx) => {
      // Check if item is referenced in any recipe; if so, block deletion
      const refCheck = await tx(
        `SELECT id FROM recipe_ingredients WHERE inventory_item_id = $1 LIMIT 1`,
        [itemId]
      );
      if (refCheck.rows.length > 0) {
        throw { code: 'ITEM_IN_USE', error: 'Item is used in one or more recipes. Remove it from recipes first.' };
      }
      // Delete stocks first
      await tx(`DELETE FROM stocks WHERE item_id = $1 AND restaurant_id = $2`, [itemId, restaurantId]);
      // Delete the item
      await tx(`DELETE FROM items WHERE id = $1 AND restaurant_id = $2`, [itemId, restaurantId]);
    });

    await writeLog('DELETE_ITEM', `Item "${item.rows[0].name}" permanently deleted`, restaurantId, userId);
    res.json({ ok: true });
  } catch (err) {
    console.error('deleteItem error:', err);
    if (err.code) {
      return res.json({ ok: false, code: err.code, error: err.error });
    }
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: err.message });
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

    const newName = name !== undefined ? String(name).trim() : existing.rows[0].name;
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
  writeLog
};