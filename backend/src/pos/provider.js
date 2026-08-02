const mapper = require('./mapper');
const recipes = require('../../recipes');   // recipes.js in backend/

let currentProvider = null;

function registerProvider(name, providerImpl) {
  // For future use
}

function setProvider(providerImpl) {
  currentProvider = providerImpl;
}

async function processSale(normalizedSale, req, res) {
  const { productId, productName, quantity, timestamp } = normalizedSale;
  const recipeId = mapper.findRecipe(productId);
  if (!recipeId) {
    return res.json({ ok: false, code: 'UNMAPPED_PRODUCT', error: 'POS product has not been mapped to a menu item.' });
  }

  const originalBody = req.body;
  req.body = { ...req.body, recipeId, quantity };
  try {
    await recipes.recordSale(req, res);
  } finally {
    req.body = originalBody;
  }
}

module.exports = { registerProvider, setProvider, processSale };