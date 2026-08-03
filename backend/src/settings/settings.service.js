const repository = require('./settings.repository');
const DEFAULTS = require('./settings.defaults');
const posIntegrationService = require('../posIntegration/posIntegration.service');

/**
 * Get all settings for a restaurant, merging with defaults.
 */
async function getAllSettings(restaurantId) {
  const stored = await repository.loadSettings(restaurantId);
  const merged = {};

  // Inventory Behaviour from stored or defaults
  merged.inventoryBehaviour = stored.inventoryBehaviour !== undefined
    ? stored.inventoryBehaviour
    : DEFAULTS.inventoryBehaviour;

  // POS Integration – always comes from the posIntegration service
  const posIntegration = await posIntegrationService.getIntegration(restaurantId);
  merged.posIntegration = posIntegration || DEFAULTS.posIntegration;  // fallback defaults if no row

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
  if (key === 'posIntegration') {
    return posIntegrationService.updateIntegration(restaurantId, data);
  }
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