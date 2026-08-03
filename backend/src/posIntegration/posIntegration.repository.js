const { query } = require('../../database');

/**
 * Get the POS integration row for a restaurant, or null.
 */
async function getIntegration(restaurantId) {
  const res = await query(
    `SELECT * FROM pos_integrations WHERE restaurant_id = $1`,
    [restaurantId]
  );
  if (res.rows.length === 0) return null;

  const row = res.rows[0];
  return {
    provider: row.provider,
    status: row.status,
    last_sync: row.last_sync,
    configuration: row.configuration,
    statistics: row.statistics
  };
}

/**
 * Partial update of the POS integration row.
 * Only the provided fields are updated.
 */
async function updateIntegration(restaurantId, data) {
  // Ensure a row exists (insert generic default if missing)
  await query(
    `INSERT INTO pos_integrations (restaurant_id, provider, status, statistics)
     VALUES ($1, 'None', 'Disconnected', '{"totalSales":0,"lastSaleAt":null}')
     ON CONFLICT (restaurant_id) DO NOTHING`,
    [restaurantId]
  );

  const allowedFields = ['provider', 'status', 'last_sync', 'configuration', 'statistics'];
  const sets = [];
  const values = [restaurantId];
  let paramIndex = 2;

  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      sets.push(`${field} = $${paramIndex}`);
      const val = (field === 'configuration' || field === 'statistics')
        ? JSON.stringify(data[field])
        : data[field];
      values.push(val);
      paramIndex++;
    }
  }

  if (sets.length > 0) {
    await query(
      `UPDATE pos_integrations SET ${sets.join(', ')}, updated_at = NOW() WHERE restaurant_id = $1`,
      values
    );
  }

  return getIntegration(restaurantId);
}

module.exports = { getIntegration, updateIntegration };