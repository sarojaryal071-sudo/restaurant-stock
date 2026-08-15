const { query, transaction } = require('../../database');
const repository = require('./stockIntake.repository');

function validateItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw { code: 'VALIDATION_ERROR', error: 'At least one item is required.' };
  }
  for (const it of items) {
    if (!it.itemId) throw { code: 'VALIDATION_ERROR', error: 'Each item must have an itemId.' };
    const qty = parseFloat(it.quantityPurchased || it.quantity);
    if (isNaN(qty) || qty <= 0) throw { code: 'VALIDATION_ERROR', error: 'Quantity must be a positive number.' };
  }
}

function validatePurchaseDate(purchaseDate) {
  if (!purchaseDate) return null;
  const d = new Date(purchaseDate);
  if (Number.isNaN(d.getTime())) {
    throw { code: 'VALIDATION_ERROR', error: 'purchaseDate must be a valid date.' };
  }
  return purchaseDate;
}

/**
 * Resolve a single proposed stock-intake item into its authoritative
 * stock-unit quantity.
 *
 * This is the ONLY place where purchase-package conversion happens for
 * stock intake. Both the real intake and preview use this function.
 *
 * `db` defaults to the regular query helper. During a transaction, pass
 * the transaction-aware query function so package/stock reads participate
 * in the same transaction.
 */
async function resolveIntakeItem(restaurantId, itemId, packageId, quantityPurchasedInput, db = query) {
  if (!itemId) {
    throw { code: 'VALIDATION_ERROR', error: 'itemId is required.' };
  }

  const quantityPurchased = parseFloat(quantityPurchasedInput);
  if (isNaN(quantityPurchased) || quantityPurchased <= 0) {
    throw { code: 'VALIDATION_ERROR', error: 'quantityPurchased must be a positive number.' };
  }

  const itemRes = await db(
    `SELECT id, name, unit
     FROM items
     WHERE id = $1 AND restaurant_id = $2 AND is_deleted = FALSE`,
    [itemId, restaurantId]
  );
  if (itemRes.rows.length === 0) {
    throw { code: 'NOT_FOUND', error: 'Item not found.' };
  }
  const item = itemRes.rows[0];

  let resolvedPackageId = null;
  let purchaseUnit = item.unit || null;
  let unitsPerPackage = 1;

  if (packageId) {
    const pkgRes = await db(
      `SELECT id, package_unit, units_per_package
       FROM item_packages
       WHERE id = $1 AND restaurant_id = $2 AND item_id = $3 AND enabled = TRUE`,
      [packageId, restaurantId, itemId]
    );
    if (pkgRes.rows.length === 0) {
      throw { code: 'NOT_FOUND', error: 'Package not found or not applicable for item.' };
    }

    const pkg = pkgRes.rows[0];
    resolvedPackageId = pkg.id;
    purchaseUnit = pkg.package_unit;
    unitsPerPackage = parseFloat(pkg.units_per_package);
  }

  const quantityAdded = quantityPurchased * unitsPerPackage;

  return {
    itemId,
    itemName: item.name,
    stockUnit: item.unit || null,
    packageId: resolvedPackageId,
    purchaseUnit,
    quantityPurchased,
    unitsPerPackage,
    quantityAdded
  };
}

function aggregateStockEffects(items) {
  const map = new Map();
  items.forEach(it => {
    const itemId = it.itemId;
    const qty = parseFloat(it.quantityAdded) || 0;
    if (!map.has(itemId)) {
      map.set(itemId, { itemId, itemName: it.itemName || null, quantityAdded: 0 });
    }
    map.get(itemId).quantityAdded += qty;
  });
  return Array.from(map.values());
}

async function getNegativeStockAllowed(db, restaurantId) {
  const res = await db(
    `SELECT value FROM restaurant_settings WHERE restaurant_id = $1 AND key = 'inventoryBehaviour'`,
    [restaurantId]
  );
  if (!res.rows.length) return false;

  let value = res.rows[0].value;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch (e) { return false; }
  }
  return !!(value && value.negativeStockAllowed);
}

async function createIntake(restaurantId, userId, items, purchaseDate = null) {
  validateItems(items);
  purchaseDate = validatePurchaseDate(purchaseDate);

  const intakeItems = [];
  for (const it of items) {
    const resolved = await resolveIntakeItem(
      restaurantId,
      it.itemId,
      it.packageId || null,
      it.quantityPurchased || it.quantity || 1
    );

    intakeItems.push({
      itemId: resolved.itemId,
      quantityAdded: resolved.quantityAdded,
      packageId: resolved.packageId,
      quantityPurchased: resolved.quantityPurchased,
      unitsPerPackageAtTime: resolved.unitsPerPackage
    });
  }

  return repository.createIntake(restaurantId, userId, intakeItems, purchaseDate);
}

async function previewIntake(restaurantId, itemId, packageId, quantityPurchased) {
  const resolved = await resolveIntakeItem(
    restaurantId,
    itemId,
    packageId || null,
    quantityPurchased
  );

  return {
    itemId: resolved.itemId,
    itemName: resolved.itemName,
    packageId: resolved.packageId,
    purchaseUnit: resolved.purchaseUnit,
    quantityPurchased: resolved.quantityPurchased,
    stockUnit: resolved.stockUnit,
    unitsPerPackage: resolved.unitsPerPackage,
    quantityAdded: resolved.quantityAdded
  };
}

async function updateIntake(restaurantId, userId, intakeId, purchaseDate, items) {
  validateItems(items);
  purchaseDate = validatePurchaseDate(purchaseDate);

  return transaction(async tx => {
    // Lock the purchase row.
    const intakeRes = await tx(
      `SELECT id, status
       FROM stock_intakes
       WHERE id = $1 AND restaurant_id = $2
       FOR UPDATE`,
      [intakeId, restaurantId]
    );
    if (intakeRes.rows.length === 0) {
      throw { code: 'NOT_FOUND', error: 'Purchase not found.' };
    }
    if (intakeRes.rows[0].status !== 'active') {
      throw { code: 'CANNOT_EDIT_CANCELLED', error: 'Cancelled purchase cannot be edited.' };
    }

    // Read historical stock effect from existing lines.
    const oldRows = await tx(
      `SELECT sii.item_id, sii.quantity_added, i.name AS item_name
       FROM stock_intake_items sii
       JOIN items i ON i.id = sii.item_id
       WHERE sii.intake_id = $1`,
      [intakeId]
    );
    const oldEffects = aggregateStockEffects(oldRows.rows.map(r => ({
      itemId: r.item_id,
      itemName: r.item_name,
      quantityAdded: r.quantity_added
    })));

    // Resolve new lines using current package configuration.
    const resolvedItems = [];
    for (const it of items) {
      const resolved = await resolveIntakeItem(
        restaurantId,
        it.itemId,
        it.packageId || null,
        it.quantityPurchased || it.quantity || 1,
        tx
      );
      resolvedItems.push(resolved);
    }
    const newEffects = aggregateStockEffects(resolvedItems);

    const negativeAllowed = await getNegativeStockAllowed(tx, restaurantId);

    const stockAdjustments = [];
    const affectedItemIds = new Set([
      ...oldEffects.map(e => e.itemId),
      ...newEffects.map(e => e.itemId)
    ]);

    for (const itemId of affectedItemIds) {
      const old = oldEffects.find(e => e.itemId === itemId);
      const next = newEffects.find(e => e.itemId === itemId);
      const oldQty = old ? old.quantityAdded : 0;
      const newQty = next ? next.quantityAdded : 0;
      const delta = newQty - oldQty;

      if (delta === 0) continue;

      const itemName = next ? next.itemName : (old ? old.itemName : 'Item');

      const stockRes = await tx(
        `SELECT quantity
         FROM stocks
         WHERE item_id = $1 AND restaurant_id = $2
         FOR UPDATE`,
        [itemId, restaurantId]
      );
      const currentQty = stockRes.rows.length ? parseFloat(stockRes.rows[0].quantity) : 0;
      const finalQty = currentQty + delta;

      if (!negativeAllowed && finalQty < 0) {
        throw {
          code: 'NEGATIVE_STOCK_NOT_ALLOWED',
          error: `Insufficient stock to apply purchase correction for ${itemName}.`
        };
      }

      await tx(
        `UPDATE stocks
         SET quantity = $1, updated_at = NOW()
         WHERE item_id = $2 AND restaurant_id = $3`,
        [finalQty, itemId, restaurantId]
      );

      stockAdjustments.push({
        itemId,
        itemName,
        oldQuantityAdded: oldQty,
        newQuantityAdded: newQty,
        delta
      });
    }

    // Update purchase header.
    await tx(
      `UPDATE stock_intakes
       SET purchase_date = $1
       WHERE id = $2 AND restaurant_id = $3`,
      [purchaseDate || null, intakeId, restaurantId]
    );

    // Replace existing lines with the newly resolved lines.
    await tx(`DELETE FROM stock_intake_items WHERE intake_id = $1`, [intakeId]);

    for (const item of resolvedItems) {
      await tx(
        `INSERT INTO stock_intake_items
           (id, intake_id, item_id, quantity_added, package_id, quantity_purchased, units_per_package_at_time)
         VALUES
           (gen_random_uuid(), $1, $2, $3, $4, $5, $6)`,
        [intakeId, item.itemId, item.quantityAdded, item.packageId || null, item.quantityPurchased, item.unitsPerPackage]
      );
    }

    // Audit log.
    await tx(
      `INSERT INTO logs (id, action, details, user_id, restaurant_id, timestamp)
       VALUES (gen_random_uuid(), 'EDIT_PURCHASE', $1, $2, $3, NOW())`,
      [`Purchase ${intakeId} edited`, userId, restaurantId]
    );

    const resultIntake = {
      id: intakeId,
      intakeType: 'purchase',
      status: 'active',
      purchaseDate: purchaseDate || null,
      items: resolvedItems.map(item => ({
        itemId: item.itemId,
        itemName: item.itemName,
        packageId: item.packageId,
        packageUnit: item.purchaseUnit,
        quantityPurchased: item.quantityPurchased,
        unitsPerPackageAtTime: item.unitsPerPackage,
        quantityAdded: item.quantityAdded
      }))
    };

    return { intake: resultIntake, stockAdjustments };
  });
}

async function cancelIntake(restaurantId, userId, intakeId) {
  return transaction(async tx => {
    const intakeRes = await tx(
      `SELECT id, status
       FROM stock_intakes
       WHERE id = $1 AND restaurant_id = $2
       FOR UPDATE`,
      [intakeId, restaurantId]
    );
    if (intakeRes.rows.length === 0) {
      throw { code: 'NOT_FOUND', error: 'Purchase not found.' };
    }
    if (intakeRes.rows[0].status === 'cancelled') {
      throw { code: 'ALREADY_CANCELLED', error: 'Purchase is already cancelled.' };
    }

    const lines = await tx(
      `SELECT sii.item_id, sii.quantity_added, i.name AS item_name
       FROM stock_intake_items sii
       JOIN items i ON i.id = sii.item_id
       WHERE sii.intake_id = $1`,
      [intakeId]
    );
    const effects = aggregateStockEffects(lines.rows.map(r => ({
      itemId: r.item_id,
      itemName: r.item_name,
      quantityAdded: r.quantity_added
    })));

    const negativeAllowed = await getNegativeStockAllowed(tx, restaurantId);
    const stockAdjustments = [];

    for (const effect of effects) {
      const stockRes = await tx(
        `SELECT quantity
         FROM stocks
         WHERE item_id = $1 AND restaurant_id = $2
         FOR UPDATE`,
        [effect.itemId, restaurantId]
      );
      const currentQty = stockRes.rows.length ? parseFloat(stockRes.rows[0].quantity) : 0;
      const finalQty = currentQty - effect.quantityAdded;

      if (!negativeAllowed && finalQty < 0) {
        throw {
          code: 'NEGATIVE_STOCK_NOT_ALLOWED',
          error: `Insufficient stock to cancel purchase for ${effect.itemName || effect.itemId}.`
        };
      }

      await tx(
        `UPDATE stocks
         SET quantity = $1, updated_at = NOW()
         WHERE item_id = $2 AND restaurant_id = $3`,
        [finalQty, effect.itemId, restaurantId]
      );

      stockAdjustments.push({
        itemId: effect.itemId,
        itemName: effect.itemName,
        quantityReversed: effect.quantityAdded
      });
    }

    await tx(
      `UPDATE stock_intakes
       SET status = 'cancelled',
           cancelled_at = NOW(),
           cancelled_by = $1
       WHERE id = $2 AND restaurant_id = $3`,
      [userId || null, intakeId, restaurantId]
    );

    await tx(
      `INSERT INTO logs (id, action, details, user_id, restaurant_id, timestamp)
       VALUES (gen_random_uuid(), 'CANCEL_PURCHASE', $1, $2, $3, NOW())`,
      [`Purchase ${intakeId} cancelled`, userId, restaurantId]
    );

    return {
      intake: {
        id: intakeId,
        status: 'cancelled',
        cancelledAt: new Date().toISOString()
      },
      stockAdjustments
    };
  });
}

async function listIntakes(restaurantId, start, end) {
  return repository.listIntakes(restaurantId, start, end);
}

module.exports = {
  createIntake,
  previewIntake,
  updateIntake,
  cancelIntake,
  listIntakes
};