const crypto = require('crypto');
const { query } = require('../../database');
const repository = require('./staff.repository');

function hashPin(pin) {
  return crypto.createHash('sha256').update(pin).digest('hex');
}

function validateName(name) {
  if (!name || !String(name).trim()) throw { code: 'VALIDATION_ERROR', error: 'Name is required.' };
  return String(name).trim();
}

function validatePin(pin) {
  if (!pin || !/^\d{4,6}$/.test(String(pin))) throw { code: 'VALIDATION_ERROR', error: 'PIN must be 4–6 digits.' };
  return String(pin);
}

/**
 * Generate a unique username from the staff name and restaurant.
 * Format: sanitizedName@restaurantCode (e.g., johnsmith@forno).
 * Uniqueness is scoped to the given restaurant only.
 */
async function generateUsername(name, restaurantId) {
  const baseName = name.toLowerCase().replace(/[^a-z0-9]/g, '') || 'user';

  // Get the restaurant code
  const codeRes = await query(`SELECT restaurant_code FROM restaurants WHERE id = $1`, [restaurantId]);
  const code = codeRes.rows[0]?.restaurant_code || 'unknown';
  const base = baseName + '@' + code;

  let username = base;
  let counter = 1;
  while (true) {
    // Check uniqueness only within the same restaurant
    const res = await query(
      `SELECT id FROM users WHERE username = $1 AND restaurant_id = $2 LIMIT 1`,
      [username, restaurantId]
    );
    if (res.rows.length === 0) break;
    username = baseName + (counter++) + '@' + code;
  }
  return username;
}

async function listStaff(restaurantId) {
  return repository.listStaff(restaurantId);
}

async function createStaff(restaurantId, name, pin) {
  const cleanedName = validateName(name);
  const cleanedPin = validatePin(pin);
  const hash = hashPin(cleanedPin);
  const username = await generateUsername(cleanedName, restaurantId);
  return repository.createStaff(restaurantId, cleanedName, hash, username);
}

async function updateStaff(restaurantId, userId, updates, currentUserId) {
  const staff = await repository.getStaffById(userId, restaurantId);
  if (!staff) throw { code: 'NOT_FOUND', error: 'Staff member not found.' };

  if (userId === currentUserId) {
    throw { code: 'FORBIDDEN', error: 'You cannot edit your own account.' };
  }

  const fields = {};

  if (updates.name !== undefined) {
    const newName = validateName(updates.name);
    fields.name = newName;
    // Auto‑regenerate username when name changes
    const newUsername = await generateUsername(newName, restaurantId);
    fields.username = newUsername;
  }

  if (updates.pin !== undefined) {
    const cleanedPin = validatePin(updates.pin);
    fields.password_hash = hashPin(cleanedPin);
  }

  if (updates.is_active !== undefined) {
    if (typeof updates.is_active !== 'boolean') throw { code: 'VALIDATION_ERROR', error: 'is_active must be a boolean.' };
    fields.is_active = updates.is_active;
  }

  return repository.updateStaff(userId, restaurantId, fields);
}

module.exports = { listStaff, createStaff, updateStaff };