const repository = require('./stockIntake.repository');

function validateItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw { code: 'VALIDATION_ERROR', error: 'At least one item is required.' };
  }
  for (const it of items) {
    if (!it.itemId)  throw { code: 'VALIDATION_ERROR', error: 'Each item must have an itemId.' };
    const qty = parseFloat(it.quantity);
    if (isNaN(qty) || qty <= 0) throw { code: 'VALIDATION_ERROR', error: 'Quantity must be a positive number.' };
  }
}

async function createIntake(restaurantId, userId, items) {
  validateItems(items);
  const intakeItems = [];

  for (const it of items) {
    const itemId = it.itemId;
    const qtyPurchased = parseFloat(it.quantityPurchased || it.quantity || 1);
    if (isNaN(qtyPurchased) || qtyPurchased <= 0) {
      throw { code: 'VALIDATION_ERROR', error: 'Each item must have a positive quantity.' };
    }

    let quantityAdded = qtyPurchased;
    let packageId = null, unitsPerPackage = 1;

    if (it.packageId) {
      const { query } = require('../../database');
      const pkgRes = await query(
        `SELECT * FROM item_packages WHERE id = $1 AND restaurant_id = $2 AND item_id = $3 AND enabled = TRUE`,
        [it.packageId, restaurantId, itemId]
      );
      if (pkgRes.rows.length === 0) {
        throw { code: 'NOT_FOUND', error: 'Package not found or not applicable for item.' };
      }
      const pkg = pkgRes.rows[0];
      unitsPerPackage = parseFloat(pkg.units_per_package);
      quantityAdded = qtyPurchased * unitsPerPackage;
      packageId = pkg.id;
    }

    intakeItems.push({
      itemId,
      quantityAdded,
      packageId,
      quantityPurchased: qtyPurchased,
      unitsPerPackageAtTime: unitsPerPackage
    });
  }

  const intakeId = await repository.createIntake(restaurantId, userId, intakeItems);
  return intakeId;
}

async function listIntakes(restaurantId, start, end) {
  return repository.listIntakes(restaurantId, start, end);
}

module.exports = { createIntake, listIntakes };