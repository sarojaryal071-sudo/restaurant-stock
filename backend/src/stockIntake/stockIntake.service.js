const repository = require('./stockIntake.repository');

function validateItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw { code: 'VALIDATION_ERROR', error: 'At least one item is required.' };
  }
  for (const it of items) {
    if (!it.itemId)  throw { code: 'VALIDATION_ERROR', error: 'Each item must have an itemId.' };
    const qty = parseFloat(it.quantity);
    if (isNaN(qty) || qty <= 0) throw { code: 'VALIDATION_ERROR', error: 'Quantity must be a positive number.' };
  }
}

async function createIntake(restaurantId, userId, items) {
  validateItems(items);
  return repository.createIntake(restaurantId, userId, items);
}

async function listIntakes(restaurantId, start, end) {
  return repository.listIntakes(restaurantId, start, end);
}

module.exports = { createIntake, listIntakes };