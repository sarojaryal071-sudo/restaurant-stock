const { can } = require('../../permissions');

function requirePermission(module, action) {
  return (req, res, next) => {
    const role = req.auth.role || 'staff';
    if (!can(role, module, action)) {
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