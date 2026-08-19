const { query } = require('../../database');

function normalizeName(name) {
  return String(name || '').trim().toLowerCase();
}

async function resolveSalesProduct(restaurantId, productName) {
  const normalized = normalizeName(productName);
  if (!normalized || !restaurantId) {
    return { type: 'unresolved', name: productName || '' };
  }

  const itemRes = await query(
    `SELECT id, name
     FROM items
     WHERE restaurant_id = $1 AND is_deleted = FALSE AND LOWER(name) = $2
     LIMIT 2`,
    [restaurantId, normalized]
  );

  const recipeRes = await query(
    `SELECT id, name
     FROM recipes
     WHERE restaurant_id = $1 AND LOWER(name) = $2
     LIMIT 2`,
    [restaurantId, normalized]
  );

  const item = itemRes.rows[0] || null;
  const recipe = recipeRes.rows[0] || null;
  const itemCount = itemRes.rows.length;
  const recipeCount = recipeRes.rows.length;

  if (itemCount > 1 || recipeCount > 1 || (item && recipe)) {
    return { type: 'ambiguous', name: productName };
  }

  if (item) {
    return { type: 'inventory', id: item.id, name: item.name };
  }

  if (recipe) {
    return { type: 'recipe', id: recipe.id, name: recipe.name };
  }

  return { type: 'unresolved', name: productName };
}

module.exports = { resolveSalesProduct, normalizeName };