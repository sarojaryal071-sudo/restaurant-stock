const { query, transaction } = require('../../database');
const { v4: uuidv4 } = require('uuid');

async function createIntake(restaurantId, userId, items, purchaseDate = null) {
  const intakeId = uuidv4();
  await transaction(async (tx) => {
    await tx(
      `INSERT INTO stock_intakes (id, restaurant_id, user_id, purchase_date)
       VALUES ($1, $2, $3, $4)`,
      [intakeId, restaurantId, userId || null, purchaseDate || null]
    );
    for (const item of items) {
      await tx(
        `INSERT INTO stock_intake_items (id, intake_id, item_id, quantity_added, package_id, quantity_purchased, units_per_package_at_time)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [uuidv4(), intakeId, item.itemId, item.quantityAdded, item.packageId || null, item.quantityPurchased, item.unitsPerPackageAtTime]
      );
      await tx(
        `UPDATE stocks SET quantity = quantity + $1, updated_at = NOW() WHERE item_id = $2 AND restaurant_id = $3`,
        [item.quantityAdded, item.itemId, restaurantId]
      );
    }
  });
  return intakeId;
}

async function listIntakes(restaurantId, start, end) {
  let sql =     `SELECT si.id, si.intake_type, si.created_at, si.purchase_date,
            sii.item_id, i.name AS item_name, sii.quantity_added,
            sii.package_id, sii.quantity_purchased, sii.units_per_package_at_time,
            ip.package_unit
     FROM stock_intakes si
     JOIN stock_intake_items sii ON si.id = sii.intake_id
     JOIN items i ON sii.item_id = i.id
     LEFT JOIN item_packages ip ON sii.package_id = ip.id
     WHERE si.restaurant_id = $1`;
  const params = [restaurantId];
  if (start) { sql += ` AND si.created_at >= $${params.push(start)}`; }
  if (end)   { sql += ` AND si.created_at <= $${params.push(end)}`; }
  sql += ` ORDER BY si.created_at DESC`;
  const res = await query(sql, params);
  // Group by intake
  const map = new Map();
  for (const row of res.rows) {
    if (!map.has(row.id)) {
      map.set(row.id, {
        id: row.id,
        intakeType: row.intake_type,
        createdAt: row.created_at,
        purchaseDate: row.purchase_date || null,
        items: []
      });
    }
    map.get(row.id).items.push({
      itemId: row.item_id,
      itemName: row.item_name,
      quantityAdded: parseFloat(row.quantity_added),
      packageId: row.package_id,
      packageUnit: row.package_unit || null,
      quantityPurchased: row.quantity_purchased ? parseFloat(row.quantity_purchased) : null,
      unitsPerPackageAtTime: row.units_per_package_at_time ? parseFloat(row.units_per_package_at_time) : null
    });
  }
  return Array.from(map.values());
}

module.exports = { createIntake, listIntakes };