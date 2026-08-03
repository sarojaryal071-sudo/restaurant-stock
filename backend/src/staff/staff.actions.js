const service = require('./staff.service');

async function list(req, res) {
  try {
    const staff = await service.listStaff(req.auth.restaurantId);
    res.json({ ok: true, staff });
  } catch (err) {
    console.error('staff list error:', err);
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: err.message });
  }
}

async function create(req, res) {
  try {
    const { name, pin } = req.body;
    const user = await service.createStaff(req.auth.restaurantId, name, pin);
    res.json({ ok: true, user });
  } catch (err) {
    if (err.code) return res.json({ ok: false, code: err.code, error: err.error });
    console.error('staff create error:', err);
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: err.message });
  }
}

async function update(req, res) {
  try {
    const userId = req.params.id;
    const updates = req.body; // may contain name, pin, is_active
    const user = await service.updateStaff(req.auth.restaurantId, userId, updates, req.auth.userId);
    res.json({ ok: true, user });
  } catch (err) {
    if (err.code) return res.json({ ok: false, code: err.code, error: err.error });
    console.error('staff update error:', err);
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: err.message });
  }
}

module.exports = { list, create, update };