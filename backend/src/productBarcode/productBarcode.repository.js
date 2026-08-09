const { query } = require('../../database');

async function findCachedProduct(restaurantId, barcode) {
  const res = await query(
    `SELECT * FROM product_barcodes WHERE restaurant_id = $1 AND barcode = $2`,
    [restaurantId, barcode]
  );
  return res.rows[0] || null;
}

async function saveCachedProduct(restaurantId, barcode, product) {
  const { v4: uuidv4 } = require('uuid');
  await query(
    `INSERT INTO product_barcodes (id, restaurant_id, barcode, product_name, brand, description, category,
      quantity_value, quantity_unit, package_quantity, package_unit, inventory_item_id, provider, provider_product_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      uuidv4(),
      restaurantId,
      barcode,
      product.name || null,
      product.brand || null,
      product.description || null,
      product.category || null,
      product.quantityValue || null,
      product.quantityUnit || null,
      product.packageQuantity || null,
      product.packageUnit || null,
      null, // inventory_item_id (not set here)
      product.provider || 'open_food_facts',
      product.providerProductId || null
    ]
  );
}

async function findInventoryItemByName(restaurantId, name) {
  if (!name) return null;
  const res = await query(
    `SELECT id, name FROM items WHERE restaurant_id = $1 AND LOWER(name) = LOWER($2) AND is_deleted = FALSE LIMIT 1`,
    [restaurantId, name]
  );
  return res.rows[0] || null;
}

module.exports = { findCachedProduct, saveCachedProduct, findInventoryItemByName };