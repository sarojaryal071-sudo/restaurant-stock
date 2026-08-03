const { getIntegration, updateIntegration } = require('./posIntegration.service');

/**
 * Connect a POS provider.
 * Sets the provider name and status to 'Connected'.
 * Does not modify statistics or configuration.
 */
async function connect(req, res) {
  try {
    const { restaurantId } = req.auth;
    const { provider } = req.body;
    if (!provider || typeof provider !== 'string') {
      return res.json({ ok: false, code: 'VALIDATION_ERROR', error: 'Provider name is required.' });
    }
    const updated = await updateIntegration(restaurantId, {
      provider,
      status: 'Connected'
    });
    res.json({ ok: true, posIntegration: updated });
  } catch (err) {
    console.error('pos/connect error:', err);
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: err.message });
  }
}

/**
 * Disconnect the current POS provider.
 * Leaves the provider name unchanged (so it can be reconnected later).
 * Sets status to 'Disconnected'.
 */
async function disconnect(req, res) {
  try {
    const { restaurantId } = req.auth;
    const updated = await updateIntegration(restaurantId, {
      status: 'Disconnected'
    });
    res.json({ ok: true, posIntegration: updated });
  } catch (err) {
    console.error('pos/disconnect error:', err);
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: err.message });
  }
}

/**
 * Trigger a manual sync (placeholder).
 * Updates the last_sync timestamp.
 * In the future, this will communicate with the actual POS provider.
 */
async function sync(req, res) {
  try {
    const { restaurantId } = req.auth;
    const updated = await updateIntegration(restaurantId, {
      last_sync: new Date().toISOString()
    });
    res.json({ ok: true, message: 'Sync completed (placeholder)', posIntegration: updated });
  } catch (err) {
    console.error('pos/sync error:', err);
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: err.message });
  }
}

module.exports = { connect, disconnect, sync };