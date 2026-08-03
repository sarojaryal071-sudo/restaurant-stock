// =================================================================
// CENTRALISED PERMISSION DEFINITIONS
// =================================================================
// Roles: manager, staff
// Modules: inventory, recipes, categories, allocations, pos, settings

const PERMISSIONS = {
  manager: {
    inventory:    ['add', 'edit', 'delete', 'save', 'view'],
    recipes:      ['create', 'edit', 'delete', 'view'],
    categories:   ['add', 'edit', 'delete'],
    allocations:  ['list', 'details', 'resolve'],
    pos:          ['sale'],
    settings:     ['manage']
  },
  staff: {
    inventory:    ['save', 'view'],
    recipes:      ['view'],
    allocations:  ['list', 'details', 'resolve'],
    pos:          ['sale']
  }
};

/**
 * Check if a role can perform an action on a module.
 * @param {string} role - 'manager' or 'staff'
 * @param {string} module - e.g. 'recipes'
 * @param {string} action - e.g. 'create'
 * @returns {boolean}
 */
function can(role, module, action) {
  const rolePerms = PERMISSIONS[role];
  if (!rolePerms) return false;
  const modulePerms = rolePerms[module];
  if (!modulePerms) return false;
  return modulePerms.includes(action);
}

/**
 * Return the full permissions object for a given role.
 * Used in login response.
 */
function getPermissions(role) {
  return PERMISSIONS[role] || {};
}

module.exports = { can, getPermissions };