const service = require('./productBarcode.service');

async function lookup(req, res) {
  try {
    const { barcode } = req.body;
    if (!barcode) return res.json({ ok: false, code: 'VALIDATION_ERROR', error: 'Barcode is required.' });

    const result = await service.lookupBarcode(req.auth.restaurantId, barcode);
    res.json(result);
  } catch (err) {
    if (err.code) return res.json({ ok: false, code: err.code, error: err.error });
    console.error('barcode lookup error:', err);
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: err.message });
  }
}

module.exports = { lookup };