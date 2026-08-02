const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { query } = require('./database');

// -------------------------------------------------------------------
// PIN Hashing – identical to Apps Script SHA-256
// -------------------------------------------------------------------
function hashPin(pin) {
  return crypto.createHash('sha256').update(String(pin)).digest('hex');
}

// -------------------------------------------------------------------
// Session helpers
// -------------------------------------------------------------------
async function createSession(userId, restaurantId) {
  const token = uuidv4();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await query(
    `INSERT INTO sessions (id, user_id, restaurant_id, token, created_at, expires_at)
     VALUES ($1, $2, $3, $4, NOW(), $5)`,
    [uuidv4(), userId, restaurantId, token, expiresAt]
  );
  return token;
}

async function validateSession(token) {
  const res = await query(
    `SELECT user_id, restaurant_id, expires_at FROM sessions WHERE token = $1`,
    [token]
  );
  if (res.rows.length === 0) return null;
  const session = res.rows[0];
  if (new Date(session.expires_at) < new Date()) return null;
  return { userId: session.user_id, restaurantId: session.restaurant_id };
}

async function deleteSession(token) {
  await query(`DELETE FROM sessions WHERE token = $1`, [token]);
}

// -------------------------------------------------------------------
// Helper: get a restaurant object by ID
// -------------------------------------------------------------------
async function getRestaurant(restaurantId) {
  if (!restaurantId) return null;
  const res = await query(`SELECT * FROM restaurants WHERE id = $1`, [restaurantId]);
  if (res.rows.length === 0) return null;
  const r = res.rows[0];
  return {
    id: r.id,
    name: r.name,
    displayName: r.display_name || r.name,
    logoUrl: r.logo_url || '',
    themeColor: r.theme_color || ''
  };
}

// -------------------------------------------------------------------
// Login handler
// -------------------------------------------------------------------
async function login(req, res) {
  const { pin } = req.body;
  if (!pin) return res.json({ ok: false, code: 'INVALID_PIN', error: 'PIN is required.' });

  const hash = hashPin(pin);
  const userRes = await query(
    `SELECT u.id, u.name, u.role, u.restaurant_id
     FROM users u
     WHERE u.password_hash = $1`,
    [hash]
  );

  if (userRes.rows.length === 0) {
    return res.json({ ok: false, code: 'INVALID_PIN', error: 'The PIN you entered is incorrect.' });
  }

  const user = userRes.rows[0];
  const restaurant = await getRestaurant(user.restaurant_id);
  if (!restaurant) return res.json({ ok: false, code: 'SERVER_ERROR', error: 'Restaurant not found.' });

  const token = await createSession(user.id, user.restaurant_id);

  await query(
    `INSERT INTO logs (id, action, details, user_id, restaurant_id, timestamp)
     VALUES ($1, 'LOGIN', $2, $3, $4, NOW())`,
    [uuidv4(), `User "${user.name}" logged in`, user.id, user.restaurant_id]
  );

  return res.json({
    ok: true,
    token,
    user: { id: user.id, name: user.name, role: user.role },
    restaurant
  });
}

// -------------------------------------------------------------------
// Logout handler
// -------------------------------------------------------------------
async function logout(req, res) {
  const token = req.body.token || req.query.token;
  if (token) {
    await deleteSession(token);
    await query(
      `INSERT INTO logs (id, action, details, user_id, restaurant_id, timestamp)
       VALUES ($1, 'LOGOUT', 'User logged out', NULL, NULL, NOW())`,
      [uuidv4()]
    );
  }
  return res.json({ ok: true });
}

// -------------------------------------------------------------------
// Middleware: requireAuth
// -------------------------------------------------------------------
async function requireAuth(req, res, next) {
  const settingRes = await query(`SELECT value FROM settings WHERE key = 'requireAuth'`);
  const requireAuthSetting = settingRes.rows.length > 0 ? settingRes.rows[0].value : 'false';

  if (requireAuthSetting !== 'true') {
    // Authentication disabled → use the first restaurant from the database
    try {
      const restRes = await query(`SELECT id FROM restaurants ORDER BY created_at LIMIT 1`);
      const restaurantId = restRes.rows.length > 0 ? restRes.rows[0].id : null;
      req.auth = { restaurantId, userId: null, role: null };
      return next();
    } catch (err) {
      req.auth = { restaurantId: null, userId: null, role: null };
      return next();
    }
  }

  const token = req.body.token || req.query.token;
  if (!token) {
    return res.status(401).json({ ok: false, code: 'UNAUTHORIZED', error: 'Missing authentication token.' });
  }

  const session = await validateSession(token);
  if (!session) {
    return res.status(401).json({ ok: false, code: 'UNAUTHORIZED', error: 'Invalid or expired token.' });
  }

  const userRes = await query(`SELECT role FROM users WHERE id = $1`, [session.userId]);
  const role = userRes.rows.length > 0 ? userRes.rows[0].role : null;

  req.auth = {
    restaurantId: session.restaurantId,
    userId: session.userId,
    role
  };
  next();
}

// -------------------------------------------------------------------
// Middleware: requireAdmin
// -------------------------------------------------------------------
async function requireAdmin(req, res, next) {
  const settingRes = await query(`SELECT value FROM settings WHERE key = 'requireAuth'`);
  const requireAuthSetting = settingRes.rows.length > 0 ? settingRes.rows[0].value : 'false';
  if (requireAuthSetting !== 'true') return next();
  if (req.auth.role !== 'admin') {
    return res.status(403).json({ ok: false, code: 'FORBIDDEN', error: 'Admin access required.' });
  }
  next();
}

module.exports = { hashPin, createSession, validateSession, deleteSession, login, logout, requireAuth, requireAdmin, getRestaurant };