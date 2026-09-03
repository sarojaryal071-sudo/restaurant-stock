const service = require('./posSalesImport.service');
const multer = require('multer');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 }
}).single('file');

async function preview(req, res) {
  upload(req, res, async (err) => {
    if (err) return res.json({ ok: false, code: 'INVALID_FILE', error: err.message });
    if (!req.file) return res.json({ ok: false, code: 'INVALID_FILE', error: 'No file uploaded.' });

    try {
      const result = await service.previewSales(req.auth.restaurantId, {
        buffer: req.file.buffer,
        originalname: req.file.originalname,
        mimetype: req.file.mimetype
      });

      res.json({ ok: true, ...result });
    } catch (e) {
      if (e.code) return res.json({ ok: false, code: e.code, error: e.error });
      console.error('preview error:', e);
      res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: e.message });
    }
  });
}

async function saveMapping(req, res) {
  try {
    const {
      sourceProductName,
      itemId = null,
      recipeId = null,
      unit = null
    } = req.body;

    if (!sourceProductName) {
      return res.json({
        ok: false,
        code: 'VALIDATION_ERROR',
        error: 'sourceProductName is required.'
      });
    }

    await service.saveProductMapping(
      req.auth.restaurantId,
      sourceProductName,
      itemId || null,
      recipeId || null,
      unit || null
    );

    res.json({ ok: true });
  } catch (err) {
    if (err.code) return res.json({ ok: false, code: err.code, error: err.error });
    console.error('mapping error:', err);
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: err.message });
  }
}

async function apply(req, res) {
  try {
    const { restaurantId, userId } = req.auth;
    const { fileHash, periodStart, periodEnd, items } = req.body;

    if (!fileHash || !Array.isArray(items) || items.length === 0) {
      return res.json({
        ok: false,
        code: 'VALIDATION_ERROR',
        error: 'fileHash and items array are required.'
      });
    }

    await service.applySalesImport(
      restaurantId,
      userId,
      fileHash,
      periodStart,
      periodEnd,
      items
    );

    res.json({ ok: true });
  } catch (err) {
    if (err.code) return res.json({ ok: false, code: err.code, error: err.error });
    console.error('apply error:', err);
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: err.message });
  }
}

async function cancel(req, res) {
  try {
    const { restaurantId, userId } = req.auth;
    const importId = req.params.id;

    await service.cancelSalesImport(restaurantId, userId, importId);
    res.json({ ok: true });
  } catch (err) {
    if (err.code) return res.json({ ok: false, code: err.code, error: err.error });
    console.error('cancel sales import error:', err);
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: err.message });
  }
}

async function history(req, res) {
  try {
    const { restaurantId } = req.auth;
    const { start, end } = req.query;

    const imports = await service.listSalesImports(restaurantId, start, end);
    res.json({ ok: true, imports });
  } catch (err) {
    console.error('sales import history error:', err);
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: err.message });
  }
}

module.exports = {
  preview,
  saveMapping,
  apply,
  cancel,
  history
};