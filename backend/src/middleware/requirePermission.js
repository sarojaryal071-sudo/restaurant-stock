function requirePermission(module, action) {
  return (req, res, next) => {
    const perms = req.auth.permissions || {};
    if (!perms[module] || perms[module][action] !== true) {
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