const repository = require('./repository');

function findRecipe(productId) {
  const mapping = repository.findMenuItemByPosProduct(productId);
  return mapping ? mapping.recipeId : null;
}

function findMenuItem(productId) {
  const mapping = repository.findMenuItemByPosProduct(productId);
  return mapping ? mapping.menuItem : null;
}

function createMapping(productId, menuItem, recipeId) {
  repository.saveMenuMapping(productId, menuItem, recipeId);
}

function updateMapping(productId, menuItem, recipeId) {
  return repository.updateMenuMapping(productId, menuItem, recipeId);
}

function deleteMapping(productId) {
  return repository.deleteMenuMapping(productId);
}

module.exports = { findRecipe, findMenuItem, createMapping, updateMapping, deleteMapping };