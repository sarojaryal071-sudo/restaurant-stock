// -------------------------------------------------------------------
// Middleware: only allow managers (role === "manager" or "admin")
// -------------------------------------------------------------------
function requireManager(req, res, next) {
  // If auth is disabled, allow everything (like requireAdmin previously)
  const role = req.auth.role;
  if (!role) {
    // No role → treat as staff, block
    return res.status(403).json({ ok: false, code: 'FORBIDDEN', error: 'Manager access required.' });
  }
  if (role !== 'manager' && role !== 'admin') {
    return res.status(403).json({ ok: false, code: 'FORBIDDEN', error: 'Manager access required.' });
  }
  next();
}

module.exports = requireManager;