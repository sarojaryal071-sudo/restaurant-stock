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
    SELECT ps.sold_at::date AS sale_date,
           ps.product_name,
           ps.unit,
           SUM(ps.quantity)::numeric AS total_quantity
    FROM pos_sales ps
    LEFT JOIN sales_imports si
      ON si.id = ps.sales_import_id
    WHERE ps.restaurant_id = $1
      AND (si.id IS NULL OR si.status = 'active')
  `;
  const params = [restaurantId];

  if (startDate) {
    sql += ` AND ps.sold_at >= $2`;
    params.push(startDate);
  }

  if (endDate) {
    sql += ` AND ps.sold_at <= $${params.length + 1}`;
    params.push(endDate);
  }

  sql += `
    GROUP BY ps.sold_at::date, ps.product_name, ps.unit
    ORDER BY sale_date DESC, total_quantity DESC
  `;

  const res = await query(sql, params);

  return res.rows.map(r => ({
    date: r.sale_date,
    product: r.product_name,
    quantity: parseFloat(r.total_quantity),
    unit: r.unit || null
  }));
}

module.exports = { recordSale, getSummary };