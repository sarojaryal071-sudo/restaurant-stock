// In-memory POS product mapping repository
// Phase 1: simple in-memory store (will be replaced by DB later)

const mappings = new Map(); // key: productId, value: { menuItem, recipeId }

function findMenuItemByPosProduct(productId) {
  return mappings.get(productId) || null;
}

function saveMenuMapping(productId, menuItem, recipeId) {
  mappings.set(productId, { menuItem, recipeId });
}

function updateMenuMapping(productId, menuItem, recipeId) {
  if (mappings.has(productId)) {
    mappings.set(productId, { menuItem, recipeId });
    return true;
  }
  return false;
}

function deleteMenuMapping(productId) {
  return mappings.delete(productId);
}

module.exports = { findMenuItemByPosProduct, saveMenuMapping, updateMenuMapping, deleteMenuMapping };