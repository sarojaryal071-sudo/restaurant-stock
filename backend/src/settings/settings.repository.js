const { query, transaction } = require('../../database');

/**
 * Load ALL settings for a restaurant as an object { key: value }.
 */
async function loadSettings(restaurantId) {
  const res = await query(
    `SELECT key, value FROM restaurant_settings WHERE restaurant_id = $1`,
    [restaurantId]
  );
  const settings = {};
  for (const row of res.rows) {
    settings[row.key] = row.value;   // value is already JSON from PostgreSQL
  }
  return settings;
}

/**
 * Load a single settings section by key.
 */
async function loadSection(restaurantId, key) {
  const res = await query(
    `SELECT value FROM restaurant_settings WHERE restaurant_id = $1 AND key = $2`,
    [restaurantId, key]
  );
  return res.rows.length > 0 ? res.rows[0].value : null;
}

/**
 * Upsert a settings section.
 */
async function saveSection(restaurantId, key, value) {
  await query(
    `INSERT INTO restaurant_settings (id, restaurant_id, key, value, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, NOW(), NOW())
     ON CONFLICT (restaurant_id, key) DO UPDATE SET value = $3, updated_at = NOW()`,
    [restaurantId, key, JSON.stringify(value)]
  );
}

/**
 * Delete a settings section.
 */
async function deleteSection(restaurantId, key) {
  await query(
    `DELETE FROM restaurant_settings WHERE restaurant_id = $1 AND key = $2`,
    [restaurantId, key]
  );
}

module.exports = { loadSettings, loadSection, saveSection, deleteSection };