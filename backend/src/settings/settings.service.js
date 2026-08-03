const repository = require('./settings.repository');
const DEFAULTS = require('./settings.defaults');
const { getAllRolePermissions } = require('../permissions/permissions.service');

/**
 * Get all settings for a restaurant, merging with defaults.
 */
async function getAllSettings(restaurantId) {
  const stored = await repository.loadSettings(restaurantId);
  const merged = {};

  for (const section of Object.keys(DEFAULTS)) {
    if (section === 'permissions') {
      // For permissions, return the effective permissions for the restaurant
      merged.permissions = await getAllRolePermissions(restaurantId);
    } else {
      merged[section] = stored[section] !== undefined
        ? stored[section]
        : DEFAULTS[section];
    }
  }
  return merged;
}
// Individual section getters
async function getSection(restaurantId, key) {
  const stored = await repository.loadSection(restaurantId, key);
  if (stored !== null) return stored;
  return DEFAULTS[key] || null;
}

// Individual section updaters
async function updateSection(restaurantId, key, data) {
  // Merge with defaults? For now, replace entirely.
  await repository.saveSection(restaurantId, key, data);
  return data;
}

// Convenience getters
async function getPermissions(restaurantId) { return getSection(restaurantId, 'permissions'); }
async function getInventorySettings(restaurantId) { return getSection(restaurantId, 'inventory'); }
async function getRecipeSettings(restaurantId) { return getSection(restaurantId, 'recipe'); }
async function getRestaurantSettings(restaurantId) { return getSection(restaurantId, 'restaurant'); }
async function getPOSSettings(restaurantId) { return getSection(restaurantId, 'pos'); }
async function getBackupSettings(restaurantId) { return getSection(restaurantId, 'backup'); }
async function getAboutSettings(restaurantId) { return getSection(restaurantId, 'about'); }

// Convenience updaters
async function updatePermissions(restaurantId, data) { return updateSection(restaurantId, 'permissions', data); }
async function updateInventory(restaurantId, data) { return updateSection(restaurantId, 'inventory', data); }
async function updateRecipe(restaurantId, data) { return updateSection(restaurantId, 'recipe', data); }
async function updateRestaurant(restaurantId, data) { return updateSection(restaurantId, 'restaurant', data); }
async function updatePOS(restaurantId, data) { return updateSection(restaurantId, 'pos', data); }
async function updateBackup(restaurantId, data) { return updateSection(restaurantId, 'backup', data); }
async function updateAbout(restaurantId, data) { return updateSection(restaurantId, 'about', data); }

module.exports = {
  getAllSettings,
  getSection,
  updateSection,
  getPermissions,
  getInventorySettings,
  getRecipeSettings,
  getRestaurantSettings,
  getPOSSettings,
  getBackupSettings,
  getAboutSettings,
  updatePermissions,
  updateInventory,
  updateRecipe,
  updateRestaurant,
  updatePOS,
  updateBackup,
  updateAbout
};