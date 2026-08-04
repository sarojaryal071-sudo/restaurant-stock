const { query } = require('../../database');

async function recordSale(restaurantId, provider, productName, quantity, soldAt, externalSaleId) {
  await query(
    `INSERT INTO pos_sales (restaurant_id, provider, product_name, quantity, sold_at, external_sale_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [restaurantId, provider, productName, quantity, soldAt, externalSaleId || null]
  );
}

async function getSummary(restaurantId, startDate, endDate) {
  let sql = `
    SELECT product_name, SUM(quantity)::numeric AS total_quantity
    FROM pos_sales
    WHERE restaurant_id = $1
  `;
  const params = [restaurantId];
  if (startDate) {
    sql += ` AND sold_at >= $2`;
    params.push(startDate);
  }
  if (endDate) {
    sql += ` AND sold_at <= $${params.length + 1}`;
    params.push(endDate);
  }
  sql += ` GROUP BY product_name ORDER BY total_quantity DESC`;
  const res = await query(sql, params);
  return res.rows.map(r => ({
    product: r.product_name,
    quantity: parseFloat(r.total_quantity)
  }));
}

module.exports = { recordSale, getSummary };