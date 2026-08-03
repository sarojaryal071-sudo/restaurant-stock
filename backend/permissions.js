const { query } = require('./database');

// Static fallback definitions
const DEFAULTS = {
  manager: {
    inventory:   ['add', 'edit', 'delete', 'save', 'view'],
    recipes:     ['create', 'edit', 'delete', 'view'],
    categories:  ['add', 'edit', 'delete'],
    allocations: ['list', 'details', 'resolve'],
    pos:         ['sale'],
    settings:    ['manage']
  },
  staff: {
    inventory:   ['save', 'view'],
    recipes:     ['view'],
    allocations: ['list', 'details', 'resolve'],
    pos:         ['sale']
  }
};

/**
 * Load custom permissions from restaurant_settings.
 */
async function loadCustomPermissions(restaurantId) {
  try {
    const res = await query(
      `SELECT value FROM restaurant_settings WHERE restaurant_id = $1 AND key = 'permissions'`,
      [restaurantId]
    );
    if (res.rows.length > 0 && res.rows[0].value) {
      return res.rows[0].value;
    }
    return null;
  } catch (err) {
    console.error('Failed to load custom permissions:', err);
    return null;
  }
}

/**
 * Resolve effective permissions for a single role.
 */
async function resolvePermissions(role, restaurantId) {
  const custom = await loadCustomPermissions(restaurantId);
  if (custom && custom[role]) {
    return custom[role];
  }
  return DEFAULTS[role] || {};
}

/**
 * Resolve the full permissions object for a restaurant (both roles).
 * Used by settings endpoint to display current permissions.
 */
async function resolveAllPermissions(restaurantId) {
  const custom = await loadCustomPermissions(restaurantId);
  if (custom) {
    return {
      manager: custom.manager || DEFAULTS.manager,
      staff:   custom.staff   || DEFAULTS.staff
    };
  }
  // No custom saved – return static defaults
  return { ...DEFAULTS };
}

// Also export the static defaults for backward compatibility
module.exports = DEFAULTS;
module.exports.resolvePermissions = resolvePermissions;
module.exports.resolveAllPermissions = resolveAllPermissions;