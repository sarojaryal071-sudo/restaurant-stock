const service = require('./posSales.service');

async function getSalesSummary(req, res) {
  try {
    const { restaurantId } = req.auth;
    const { period, start, end } = req.query;
    const result = await service.getSummary(restaurantId, period, start, end);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('pos/sales error:', err);
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: err.message });
  }
}

module.exports = { getSalesSummary };