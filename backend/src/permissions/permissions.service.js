const repository = require('./permissions.repository');

/**
 * Get effective permissions for a role.
 * Only enabled definitions are considered.
 */
async function getEffectivePermissions(restaurantId, role) {
  // Fetch only enabled definitions
  const defs = await repository.getAllDefinitions(false);
  const enabledModules = new Map();
  for (const def of defs) {
    if (!enabledModules.has(def.module)) {
      enabledModules.set(def.module, new Set());
    }
    enabledModules.get(def.module).add(def.permission);
  }

  const rows = await repository.getRolePermissions(restaurantId, role);
  const perms = {};
  for (const row of rows) {
    // Ignore rows for disabled definitions
    if (!enabledModules.has(row.module) || !enabledModules.get(row.module).has(row.permission)) {
      continue;
    }
    if (!perms[row.module]) perms[row.module] = {};
    perms[row.module][row.permission] = row.allowed;
  }

  // Also fill in any enabled definitions that don't have a role_permission row (default false)
  for (const def of defs) {
    if (!perms[def.module]) perms[def.module] = {};
    if (perms[def.module][def.permission] === undefined) {
      perms[def.module][def.permission] = false;
    }
  }
  return perms;
}

/**
 * Get definitions (all, including disabled for management).
 */
async function getDefinitions() {
  return repository.getAllDefinitions(true);
}

/**
 * Get full permissions for both manager and staff.
 */
async function getAllRolePermissions(restaurantId) {
  const [managerPerms, staffPerms] = await Promise.all([
    getEffectivePermissions(restaurantId, 'manager'),
    getEffectivePermissions(restaurantId, 'staff')
  ]);
  return { manager: managerPerms, staff: staffPerms };
}

/**
 * Update permissions for a role.
 */
async function updateRolePermissions(restaurantId, role, permissionsObject) {
  await repository.bulkUpdatePermissions(restaurantId, role, permissionsObject);
  return getEffectivePermissions(restaurantId, role);
}

/**
 * Update definition enabled flags in bulk.
 */
async function updateDefinitionEnabledBulk(updates) {
  for (const update of updates) {
    await repository.updateDefinitionEnabled(update.definitionId, update.enabled);
  }
}

module.exports = {
  getEffectivePermissions,
  getDefinitions,
  getAllRolePermissions,
  updateRolePermissions,
  updateDefinitionEnabledBulk
};