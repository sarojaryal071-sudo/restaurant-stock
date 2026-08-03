const { query } = require('../../database');

async function listStaff(restaurantId) {
  const res = await query(
    `SELECT id, name, username, role, is_active, created_at
     FROM users
     WHERE restaurant_id = $1 AND role = 'staff'
     ORDER BY name ASC`,
    [restaurantId]
  );
  return res.rows;
}

async function getStaffById(userId, restaurantId) {
  const res = await query(
    `SELECT * FROM users WHERE id = $1 AND restaurant_id = $2 AND role = 'staff'`,
    [userId, restaurantId]
  );
  return res.rows[0] || null;
}

async function createStaff(restaurantId, name, passwordHash, username) {
  const { v4: uuidv4 } = require('uuid');
  const id = uuidv4();
  await query(
    `INSERT INTO users (id, name, username, role, restaurant_id, password_hash, is_active, created_at)
     VALUES ($1, $2, $3, 'staff', $4, $5, TRUE, NOW())`,
    [id, name, username, restaurantId, passwordHash]
  );
  return { id, name, username, role: 'staff', is_active: true, created_at: new Date().toISOString() };
}

async function updateStaff(userId, restaurantId, fields) {
  const sets = [];
  const values = [userId, restaurantId];
  let idx = 3;
  if (fields.name !== undefined) {
    sets.push(`name = $${idx++}`);
    values.push(fields.name);
  }
  if (fields.password_hash !== undefined) {
    sets.push(`password_hash = $${idx++}`);
    values.push(fields.password_hash);
  }
  if (fields.is_active !== undefined) {
    sets.push(`is_active = $${idx++}`);
    values.push(fields.is_active);
  }
  if (sets.length === 0) return getStaffById(userId, restaurantId);

  await query(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $1 AND restaurant_id = $2`,
    values
  );
  return getStaffById(userId, restaurantId);
}

module.exports = { listStaff, getStaffById, createStaff, updateStaff };