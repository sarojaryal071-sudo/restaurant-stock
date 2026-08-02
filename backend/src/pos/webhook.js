const provider = require('./provider');
const flatpay = require('./flatpay');

async function handleIncomingSale(req, res) {
  try {
    const payload = req.body;
    if (!flatpay.validatePayload(payload)) {
      return res.status(400).json({ ok: false, code: 'VALIDATION_ERROR', error: 'Invalid payload' });
    }
    const normalized = flatpay.normalizeSale(payload);
    await provider.processSale(normalized, req, res);
  } catch (err) {
    console.error('webhook error:', err);
    if (!res.headersSent) {
      res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: err.message });
    }
  }
}

module.exports = { handleIncomingSale };