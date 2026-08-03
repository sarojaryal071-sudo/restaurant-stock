const crypto = require('crypto');
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

async function listStaff(restaurantId) {
  return repository.listStaff(restaurantId);
}

async function createStaff(restaurantId, name, pin) {
  const cleanedName = validateName(name);
  const cleanedPin = validatePin(pin);
  const hash = hashPin(cleanedPin);
  return repository.createStaff(restaurantId, cleanedName, hash);
}

async function updateStaff(restaurantId, userId, updates, currentUserId) {
  const staff = await repository.getStaffById(userId, restaurantId);
  if (!staff) throw { code: 'NOT_FOUND', error: 'Staff member not found.' };

  // Prevent self-editing (optional safety)
  if (userId === currentUserId) {
    throw { code: 'FORBIDDEN', error: 'You cannot edit your own account.' };
  }

  const fields = {};
  if (updates.name !== undefined) fields.name = validateName(updates.name);
  if (updates.pin !== undefined) fields.password_hash = hashPin(validatePin(updates.pin));
  if (updates.is_active !== undefined) {
    if (typeof updates.is_active !== 'boolean') throw { code: 'VALIDATION_ERROR', error: 'is_active must be a boolean.' };
    fields.is_active = updates.is_active;
  }
  return repository.updateStaff(userId, restaurantId, fields);
}

module.exports = { listStaff, createStaff, updateStaff };