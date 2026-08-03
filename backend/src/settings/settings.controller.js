const service = require('./settings.service');
const { validateSettings } = require('./settings.validators');

/**
 * GET /api/settings – return all settings for the authenticated restaurant.
 */
async function getAll(req, res) {
  const { restaurantId } = req.auth;
  try {
    const settings = await service.getAllSettings(restaurantId);
    res.json({ ok: true, settings });
  } catch (err) {
    console.error('settings.getAll error:', err);
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: err.message });
  }
}

/**
 * PATCH /api/settings/:section – update a single settings section.
 * The section name is extracted from the URL.
 */
async function patchSection(req, res) {
  const { restaurantId } = req.auth;
  const section = req.params.section;
  const data = req.body;

  // Validate
  const errors = validateSettings(section, data);
  if (errors.length > 0) {
    return res.json({ ok: false, code: 'VALIDATION_ERROR', error: errors.join(' ') });
  }

  try {
    const updated = await service.updateSection(restaurantId, section, data);
    res.json({ ok: true, section, settings: updated });
  } catch (err) {
    console.error(`settings.patchSection (${section}) error:`, err);
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: err.message });
  }
}

module.exports = { getAll, patchSection };