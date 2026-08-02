const { v4: uuidv4 } = require('uuid');
const { query, transaction } = require('./database');

// -------------------------------------------------------------------
// Helper: write log entry (reuse from inventory if available, else inline)
// -------------------------------------------------------------------
async function writeLog(action, details, restaurantId, userId) {
  await query(
    `INSERT INTO logs (id, action, details, user_id, restaurant_id, timestamp)
     VALUES ($1, $2, $3, $4, $5, NOW())`,
    [uuidv4(), action, details, userId || null, restaurantId || null]
  );
}

// -------------------------------------------------------------------
// listPendingAllocations – returns unresolved shortages grouped by
// inventory category.
// -------------------------------------------------------------------
async function listPendingAllocations(req, res) {
  const { restaurantId } = req.auth;
  try {
    const result = await query(
      `SELECT pa.id, pa.inventory_category_name, pa.inventory_category_id,
              SUM(pa.required_quantity) AS total_required,
              pa.unit,
              COUNT(DISTINCT pad.recipe_id) AS cocktail_count
       FROM pending_allocations pa
       LEFT JOIN pending_allocation_details pad ON pa.id = pad.pending_allocation_id
       WHERE pa.restaurant_id = $1 AND pa.resolved = FALSE
       GROUP BY pa.id, pa.inventory_category_name, pa.inventory_category_id, pa.unit
       ORDER BY pa.created_at DESC`,
      [restaurantId]
    );
    res.json({
      ok: true,
      allocations: result.rows.map(row => ({
        id: row.id,
        categoryName: row.inventory_category_name,
        categoryId: row.inventory_category_id,
        totalRequired: parseFloat(row.total_required),
        unit: row.unit,
        cocktailCount: parseInt(row.cocktail_count)
      }))
    });
  } catch (err) {
    console.error('listPendingAllocations error:', err);
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: err.message });
  }
}

// -------------------------------------------------------------------
// getPendingAllocationDetails – returns each cocktail that contributed
// to a specific shortage.
// -------------------------------------------------------------------
async function getPendingAllocationDetails(req, res) {
  const { restaurantId } = req.auth;
  const allocationId = req.body.allocationId || req.query.allocationId;
  if (!allocationId) return res.json({ ok: false, code: 'VALIDATION_ERROR', error: 'Missing allocationId' });

  try {
    // Ensure the allocation belongs to this restaurant
    const parent = await query(
      `SELECT id FROM pending_allocations WHERE id = $1 AND restaurant_id = $2 AND resolved = FALSE`,
      [allocationId, restaurantId]
    );
    if (parent.rows.length === 0) return res.json({ ok: false, code: 'NOT_FOUND', error: 'Pending allocation not found' });

    const details = await query(
      `SELECT pad.id, pad.recipe_name, pad.inventory_item_name, pad.quantity, pad.unit
       FROM pending_allocation_details pad
       WHERE pad.pending_allocation_id = $1
       ORDER BY pad.recipe_name`,
      [allocationId]
    );

    res.json({
      ok: true,
      details: details.rows.map(d => ({
        id: d.id,
        recipeName: d.recipe_name,
        inventoryItemName: d.inventory_item_name,
        quantity: parseFloat(d.quantity),
        unit: d.unit
      }))
    });
  } catch (err) {
    console.error('getPendingAllocationDetails error:', err);
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: err.message });
  }
}

// -------------------------------------------------------------------
// resolvePendingAllocation – manager maps cocktails to replacement
// inventory items and the backend validates stock and applies deductions.
//
// Body: {
//   allocationId: "...",
//   mappings: [
//     { detailId: "...", newInventoryItemId: "..." },
//     ...
//   ]
// }
// -------------------------------------------------------------------
async function resolvePendingAllocation(req, res) {
  const { restaurantId, userId } = req.auth;
  const { allocationId, mappings } = req.body;

  if (!allocationId || !Array.isArray(mappings) || mappings.length === 0) {
    return res.json({ ok: false, code: 'VALIDATION_ERROR', error: 'allocationId and mappings array are required' });
  }

  try {
    await transaction(async (tx) => {
      // 1. Verify the allocation exists and is unresolved
      const allocRes = await tx(
        `SELECT id FROM pending_allocations WHERE id = $1 AND restaurant_id = $2 AND resolved = FALSE`,
        [allocationId, restaurantId]
      );
      if (allocRes.rows.length === 0) {
        throw { code: 'NOT_FOUND', error: 'Pending allocation not found or already resolved' };
      }

      // 2. Verify each detail exists and collect the required deductions
      const deductions = []; // { newInventoryItemId, quantityToDeduct }
      for (const mapping of mappings) {
        const { detailId, newInventoryItemId } = mapping;
        if (!detailId || !newInventoryItemId) {
          throw { code: 'VALIDATION_ERROR', error: 'Each mapping must have detailId and newInventoryItemId' };
        }

        // Check that the detail belongs to this allocation
        const detail = await tx(
          `SELECT quantity, unit FROM pending_allocation_details WHERE id = $1 AND pending_allocation_id = $2`,
          [detailId, allocationId]
        );
        if (detail.rows.length === 0) {
          throw { code: 'NOT_FOUND', error: `Detail not found: ${detailId}` };
        }

        const qty = parseFloat(detail.rows[0].quantity);

        // Verify new inventory item exists and belongs to the restaurant
        const item = await tx(
          `SELECT id FROM items WHERE id = $1 AND restaurant_id = $2 AND is_deleted = FALSE`,
          [newInventoryItemId, restaurantId]
        );
        if (item.rows.length === 0) {
          throw { code: 'NOT_FOUND', error: `Replacement inventory item not found: ${newInventoryItemId}` };
        }

        // Check stock
        const stock = await tx(
          `SELECT quantity FROM stocks WHERE item_id = $1 AND restaurant_id = $2`,
          [newInventoryItemId, restaurantId]
        );
        const currentStock = stock.rows.length > 0 ? parseFloat(stock.rows[0].quantity) : 0;
        if (currentStock < qty) {
          throw {
            code: 'INSUFFICIENT_STOCK',
            error: `Not enough stock for item ${newInventoryItemId}. Required: ${qty}, available: ${currentStock}`
          };
        }

        deductions.push({ newInventoryItemId, quantityToDeduct: qty, detailId });
      }

      // 3. Apply deductions (reduce stock for the replacement items)
      for (const ded of deductions) {
        await tx(
          `UPDATE stocks SET quantity = quantity - $1, updated_at = NOW() WHERE item_id = $2 AND restaurant_id = $3`,
          [ded.quantityToDeduct, ded.newInventoryItemId, restaurantId]
        );
        // Log the allocation change
        await tx(
          `INSERT INTO allocation_logs (id, pending_allocation_id, old_inventory_item_id, new_inventory_item_id, quantity, resolved_by, resolved_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
          [uuidv4(), allocationId, null, ded.newInventoryItemId, ded.quantityToDeduct, userId]
        );
      }

      // 4. Mark the allocation as resolved
      await tx(
        `UPDATE pending_allocations SET resolved = TRUE, resolved_at = NOW(), resolved_by = $1 WHERE id = $2`,
        [userId, allocationId]
      );
    });

    await writeLog('RESOLVE_ALLOCATION', `Allocation ${allocationId} resolved`, restaurantId, userId);
    res.json({ ok: true });
  } catch (err) {
    console.error('resolvePendingAllocation error:', err);
    if (err.code) {
      return res.json({ ok: false, code: err.code, error: err.error });
    }
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: err.message });
  }
}

module.exports = { listPendingAllocations, getPendingAllocationDetails, resolvePendingAllocation };