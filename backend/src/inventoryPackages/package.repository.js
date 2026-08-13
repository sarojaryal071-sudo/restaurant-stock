const { query } = require('../../database');

async function listPackages(restaurantId) {
  const res = await query(
    `SELECT p.*, i.name AS item_name
     FROM item_packages p
     JOIN items i ON p.item_id = i.id
     WHERE p.restaurant_id = $1 AND i.is_deleted = FALSE
     ORDER BY i.name, p.sort_order`,
    [restaurantId]
  );
  return res.rows;
}

async function getPackageById(packageId, restaurantId) {
  const res = await query(
    `SELECT * FROM item_packages WHERE id = $1 AND restaurant_id = $2`,
    [packageId, restaurantId]
  );
  return res.rows[0] || null;
}

async function createPackage(restaurantId, itemId, packageUnit, unitsPerPackage, sortOrder = 0) {
  const { v4: uuidv4 } = require('uuid');
  const id = uuidv4();
  await query(
    `INSERT INTO item_packages (id, restaurant_id, item_id, package_unit, units_per_package, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, restaurantId, itemId, packageUnit, unitsPerPackage, sortOrder]
  );
  return { id };
}

async function updatePackage(packageId, restaurantId, fields) {
  const allowedFields = ['package_unit', 'units_per_package', 'enabled', 'sort_order'];
  const sets = [];
  const values = [packageId, restaurantId];
  let idx = 3;
  for (const field of allowedFields) {
    if (fields[field] !== undefined) {
      sets.push(`${field} = $${idx++}`);
      values.push(fields[field]);
    }
  }
  if (sets.length === 0) return null;
  await query(
    `UPDATE item_packages SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1 AND restaurant_id = $2`,
    values
  );
  return getPackageById(packageId, restaurantId);
}

async function deletePackage(packageId, restaurantId) {
  await query(
    `DELETE FROM item_packages WHERE id = $1 AND restaurant_id = $2`,
    [packageId, restaurantId]
  );
}

module.exports = { listPackages, getPackageById, createPackage, updatePackage, deletePackage };