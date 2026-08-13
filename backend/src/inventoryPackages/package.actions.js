const service = require('./package.service');

async function list(req, res) {
  try {
    const packages = await service.listPackages(req.auth.restaurantId);
    res.json({ ok: true, packages });
  } catch (err) {
    console.error('list packages error:', err);
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: err.message });
  }
}

async function create(req, res) {
  try {
    const { itemId, packageUnit, unitsPerPackage, sortOrder } = req.body;
    const pkg = await service.createPackage(req.auth.restaurantId, itemId, packageUnit, unitsPerPackage, sortOrder);
    res.json({ ok: true, package: pkg });
  } catch (err) {
    if (err.code) return res.json({ ok: false, code: err.code, error: err.error });
    console.error('create package error:', err);
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: err.message });
  }
}

async function update(req, res) {
  try {
    const packageId = req.params.id;
    const updates = req.body;
    const updated = await service.updatePackage(req.auth.restaurantId, packageId, updates);
    res.json({ ok: true, package: updated });
  } catch (err) {
    if (err.code) return res.json({ ok: false, code: err.code, error: err.error });
    console.error('update package error:', err);
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: err.message });
  }
}

async function remove(req, res) {
  try {
    const packageId = req.params.id;
    await service.deletePackage(req.auth.restaurantId, packageId);
    res.json({ ok: true });
  } catch (err) {
    if (err.code) return res.json({ ok: false, code: err.code, error: err.error });
    console.error('delete package error:', err);
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: err.message });
  }
}

module.exports = { list, create, update, remove };