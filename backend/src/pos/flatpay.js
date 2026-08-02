// Placeholder Flatpay provider adapter

function normalizeSale(flatpayPayload) {
  return {
    productId: flatpayPayload.productId || flatpayPayload.id || '',
    productName: flatpayPayload.productName || flatpayPayload.name || '',
    quantity: parseInt(flatpayPayload.quantity || flatpayPayload.qty, 10) || 0,
    timestamp: flatpayPayload.timestamp || flatpayPayload.createdAt || new Date().toISOString()
  };
}

function validatePayload(payload) {
  return payload != null;
}

function extractProduct(payload) {
  return payload.productId || payload.id || '';
}

function extractQuantity(payload) {
  return parseInt(payload.quantity || payload.qty, 10) || 0;
}

module.exports = { normalizeSale, validatePayload, extractProduct, extractQuantity };