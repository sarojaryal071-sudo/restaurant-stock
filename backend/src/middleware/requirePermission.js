const { can } = require('../../permissions');

/**
 * Middleware that checks whether the authenticated user has the required
 * module‑action permission.
 * Must be used after requireAuth.
 *
 * @param {string} module   e.g. 'recipes'
 * @param {string} action   e.g. 'create'
 */
function requirePermission(module, action) {
  return (req, res, next) => {
    const role = req.auth.role || 'staff';
    if (!can(role, module, action)) {
      return res.status(403).json({
        ok: false,
        code: 'FORBIDDEN',
        error: 'You do not have permission to perform this action.'
      });
    }
    next();
  };
}

module.exports = requirePermission;