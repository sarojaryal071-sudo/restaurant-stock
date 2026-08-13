const repository = require('./package.repository');

function validatePackageInput(itemId, packageUnit, unitsPerPackage) {
  if (!itemId) throw { code: 'VALIDATION_ERROR', error: 'itemId is required.' };
  if (!packageUnit || !String(packageUnit).trim()) throw { code: 'VALIDATION_ERROR', error: 'Package unit is required.' };
  if (typeof unitsPerPackage !== 'number' || unitsPerPackage <= 0) throw { code: 'VALIDATION_ERROR', error: 'units_per_package must be a positive number.' };
}

async function listPackages(restaurantId) {
  return repository.listPackages(restaurantId);
}

async function createPackage(restaurantId, itemId, packageUnit, unitsPerPackage, sortOrder) {
  validatePackageInput(itemId, packageUnit, unitsPerPackage);
  const { query } = require('../../database');
  const itemRes = await query(
    `SELECT id FROM items WHERE id = $1 AND restaurant_id = $2 AND is_deleted = FALSE`,
    [itemId, restaurantId]
  );
  if (itemRes.rows.length === 0) throw { code: 'NOT_FOUND', error: 'Item not found.' };
  return repository.createPackage(restaurantId, itemId, packageUnit.trim(), unitsPerPackage, sortOrder || 0);
}

async function updatePackage(restaurantId, packageId, updates) {
  const pkg = await repository.getPackageById(packageId, restaurantId);
  if (!pkg) throw { code: 'NOT_FOUND', error: 'Package not found.' };
  if (updates.item_id) {
    const { query } = require('../../database');
    const itemRes = await query(
      `SELECT id FROM items WHERE id = $1 AND restaurant_id = $2 AND is_deleted = FALSE`,
      [updates.item_id, restaurantId]
    );
    if (itemRes.rows.length === 0) throw { code: 'NOT_FOUND', error: 'Item not found.' };
  }
  return repository.updatePackage(packageId, restaurantId, updates);
}

async function deletePackage(restaurantId, packageId) {
  const pkg = await repository.getPackageById(packageId, restaurantId);
  if (!pkg) throw { code: 'NOT_FOUND', error: 'Package not found.' };
  await repository.deletePackage(packageId, restaurantId);
}

module.exports = { listPackages, createPackage, updatePackage, deletePackage };