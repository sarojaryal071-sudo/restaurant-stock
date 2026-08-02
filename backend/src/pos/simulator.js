const provider = require('./provider');

function simulateSale(productId, productName, quantity, timestamp, req, res) {
  const normalizedSale = {
    productId,
    productName,
    quantity: parseInt(quantity, 10),
    timestamp: timestamp || new Date().toISOString()
  };
  return provider.processSale(normalizedSale, req, res);
}

module.exports = { simulateSale };