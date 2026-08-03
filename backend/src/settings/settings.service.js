const repository = require('./settings.repository');
const DEFAULTS = require('./settings.defaults');

/**
 * Get all settings for a restaurant, merging with defaults.
 */
async function getAllSettings(restaurantId) {
  const stored = await repository.loadSettings(restaurantId);
  const merged = {};

  for (const section of Object.keys(DEFAULTS)) {
    merged[section] = stored[section] !== undefined
      ? stored[section]
      : DEFAULTS[section];
  }
  return merged;
}

/**
 * Get a single settings section by key.
 */
async function getSection(restaurantId, key) {
  const stored = await repository.loadSection(restaurantId, key);
  if (stored !== null) return stored;
  return DEFAULTS[key] || null;
}

/**
 * Update (replace) a settings section.
 */
async function updateSection(restaurantId, key, data) {
  await repository.saveSection(restaurantId, key, data);
  return data;
}

// Convenience getters / updaters for the remaining sections
async function getInventoryBehaviour(restaurantId) { return getSection(restaurantId, 'inventoryBehaviour'); }
async function getPOSIntegrationSettings(restaurantId) { return getSection(restaurantId, 'posIntegration'); }

async function updateInventoryBehaviour(restaurantId, data) { return updateSection(restaurantId, 'inventoryBehaviour', data); }
async function updatePOSIntegration(restaurantId, data) { return updateSection(restaurantId, 'posIntegration', data); }

module.exports = {
  getAllSettings,
  getSection,
  updateSection,
  getInventoryBehaviour,
  getPOSIntegrationSettings,
  updateInventoryBehaviour,
  updatePOSIntegration
};