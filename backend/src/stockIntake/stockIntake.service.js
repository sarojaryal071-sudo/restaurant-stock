const { query } = require('../../database');
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

/**
 * Resolve a single proposed stock-intake item into its authoritative
 * stock-unit quantity.
 *
 * This is the ONLY place where purchase-package conversion happens for
 * stock intake. Both the real intake and preview use this function.
 */
async function resolveIntakeItem(restaurantId, itemId, packageId, quantityPurchasedInput) {
  if (!itemId) {
    throw { code: 'VALIDATION_ERROR', error: 'itemId is required.' };
  }

  const quantityPurchased = parseFloat(quantityPurchasedInput);
  if (isNaN(quantityPurchased) || quantityPurchased <= 0) {
    throw { code: 'VALIDATION_ERROR', error: 'quantityPurchased must be a positive number.' };
  }

  const itemRes = await query(
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
    const pkgRes = await query(
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

async function createIntake(restaurantId, userId, items, purchaseDate = null) {
  validateItems(items);

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

async function listIntakes(restaurantId, start, end) {
  return repository.listIntakes(restaurantId, start, end);
}

module.exports = {
  createIntake,
  previewIntake,
  listIntakes
};