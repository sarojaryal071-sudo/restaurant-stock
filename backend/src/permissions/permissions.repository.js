const { query, transaction } = require('../../database');

/**
 * Fetch all permission definitions (including disabled) for management UI.
 */
async function getAllDefinitions(includeDisabled = false) {
  let sql = `SELECT id, module, permission, label, description, sort_order, enabled
             FROM permission_definitions`;
  if (!includeDisabled) {
    sql += ` WHERE enabled = TRUE`;
  }
  sql += ` ORDER BY sort_order ASC`;
  const res = await query(sql);
  return res.rows;
}

/**
 * Fetch all role_permission rows for a given restaurant and role.
 */
async function getRolePermissions(restaurantId, role) {
  const res = await query(
    `SELECT module, permission, allowed
     FROM role_permissions
     WHERE restaurant_id = $1 AND role = $2`,
    [restaurantId, role]
  );
  return res.rows;
}

/**
 * Upsert a single role_permission row.
 */
async function upsertRolePermission(restaurantId, role, module, permission, allowed) {
  await query(
    `INSERT INTO role_permissions (id, restaurant_id, role, module, permission, allowed, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW(), NOW())
     ON CONFLICT (restaurant_id, role, module, permission)
     DO UPDATE SET allowed = $5, updated_at = NOW()`,
    [restaurantId, role, module, permission, allowed]
  );
}

/**
 * Bulk update permissions for a role from a boolean map.
 */
async function bulkUpdatePermissions(restaurantId, role, permissionsObject) {
  await transaction(async (tx) => {
    for (const module of Object.keys(permissionsObject)) {
      const perms = permissionsObject[module];
      if (typeof perms !== 'object') continue;
      for (const action of Object.keys(perms)) {
        const allowed = !!perms[action];
        await tx.query(
          `INSERT INTO role_permissions (id, restaurant_id, role, module, permission, allowed, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW(), NOW())
           ON CONFLICT (restaurant_id, role, module, permission)
           DO UPDATE SET allowed = $5, updated_at = NOW()`,
          [restaurantId, role, module, action, allowed]
        );
      }
    }
  });
}

/**
 * Update the enabled flag of a permission definition.
 */
async function updateDefinitionEnabled(definitionId, enabled) {
  await query(
    `UPDATE permission_definitions SET enabled = $1, updated_at = NOW() WHERE id = $2`,
    [enabled, definitionId]
  );
}

module.exports = {
  getAllDefinitions,
  getRolePermissions,
  upsertRolePermission,
  bulkUpdatePermissions,
  updateDefinitionEnabled
};