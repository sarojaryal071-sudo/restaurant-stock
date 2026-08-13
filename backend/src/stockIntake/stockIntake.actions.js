const service = require('./stockIntake.service');

async function create(req, res) {
  try {
    const { restaurantId, userId } = req.auth;
    const { items } = req.body;
    await service.createIntake(restaurantId, userId, items);
    res.json({ ok: true });
  } catch (err) {
    if (err.code) return res.json({ ok: false, code: err.code, error: err.error });
    console.error('stockIntake create error:', err);
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: err.message });
  }
}

async function preview(req, res) {
  try {
    const { restaurantId } = req.auth;
    const { itemId, packageId, quantityPurchased } = req.body;
    const calculation = await service.previewIntake(
      restaurantId,
      itemId,
      packageId,
      quantityPurchased
    );
    res.json({ ok: true, calculation });
  } catch (err) {
    if (err.code) return res.json({ ok: false, code: err.code, error: err.error });
    console.error('stockIntake preview error:', err);
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: err.message });
  }
}

async function list(req, res) {
  try {
    const { restaurantId } = req.auth;
    const { start, end } = req.query;
    const intakes = await service.listIntakes(restaurantId, start, end);
    res.json({ ok: true, intakes });
  } catch (err) {
    console.error('stockIntake list error:', err);
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: err.message });
  }
}

module.exports = { create, preview, list };