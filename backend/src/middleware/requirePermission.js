/**
 * Middleware that checks whether the authenticated user has the required
 * module‑action permission.
 * Must be used after requireAuth.
 *
 * Permissions are read from req.auth.permissions (set by requireAuth/login).
 */
function requirePermission(module, action) {
  return (req, res, next) => {
    const perms = req.auth.permissions || {};
    const allowedActions = perms[module] || [];
    if (!allowedActions.includes(action)) {
      return res.json({
        ok: false,
        code: 'FORBIDDEN',
        error: 'You do not have permission to perform this action.'
      });
    }
    next();
  };
}

module.exports = requirePermission;