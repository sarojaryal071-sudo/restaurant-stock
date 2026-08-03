const service = require('./permissions.service');

/**
 * GET /api/permissions
 */
async function getPermissions(req, res) {
  try {
    const { restaurantId } = req.auth;
    const [definitions, permissions] = await Promise.all([
      service.getDefinitions(),
      service.getAllRolePermissions(restaurantId)
    ]);
    res.json({ ok: true, definitions, permissions });
  } catch (err) {
    console.error('getPermissions error:', err);
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: err.message });
  }
}

/**
 * PATCH /api/permissions
 * Supports both role permission updates and definition enabled toggles.
 *
 * For role permissions:
 *   { role: "staff", permissions: { inventory: { view: true, ... } } }
 *
 * For definition toggles:
 *   { updates: [ { definitionId: "...", enabled: false }, ... ] }
 */
async function patchPermissions(req, res) {
  try {
    const { restaurantId } = req.auth;
    const { role, permissions, updates } = req.body;

    // If 'updates' is provided, handle definition toggles
    if (Array.isArray(updates)) {
      await service.updateDefinitionEnabledBulk(updates);
      // Return fresh definitions and current permissions after update
      const [definitions, perms] = await Promise.all([
        service.getDefinitions(),
        service.getAllRolePermissions(restaurantId)
      ]);
      return res.json({ ok: true, definitions, permissions: perms });
    }

    // Otherwise, treat as role permissions update
    if (!role || !permissions || typeof permissions !== 'object') {
      return res.json({ ok: false, code: 'VALIDATION_ERROR', error: 'role and permissions object are required, or provide updates array' });
    }
    if (role !== 'staff' && role !== 'manager') {
      return res.json({ ok: false, code: 'VALIDATION_ERROR', error: 'role must be "staff" or "manager"' });
    }
    const updated = await service.updateRolePermissions(restaurantId, role, permissions);
    res.json({ ok: true, permissions: updated });
  } catch (err) {
    console.error('patchPermissions error:', err);
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: err.message });
  }
}

module.exports = { getPermissions, patchPermissions };