const { getIntegration, updateIntegration } = require('./posIntegration.service');
const { getAdapter } = require('../posAdapters/adapterFactory');

/**
 * Connect to the configured POS provider.
 * The provider is determined by the environment (POS_PROVIDER),
 * not by the frontend.
 */
async function connect(req, res) {
  try {
    const { restaurantId } = req.auth;
    const adapter = getAdapter();

    if (!adapter) {
      return res.json({
        ok: false,
        code: 'NO_PROVIDER',
        error: 'No POS provider has been configured on the server.'
      });
    }

    // Validate configuration (API keys, etc.) before proceeding
    try {
      adapter.validateConfiguration();
    } catch (configErr) {
      return res.json({
        ok: false,
        code: 'CONFIGURATION_ERROR',
        error: configErr.message
      });
    }

    // Attempt connection (placeholder – will do real API work later)
    const result = await adapter.connect();

    // Update the database with the provider name from the adapter
    const updated = await updateIntegration(restaurantId, {
      provider: adapter.getProviderName(),
      status: 'Connected',
      last_sync: result.last_sync || null
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
 */
async function disconnect(req, res) {
  try {
    const { restaurantId } = req.auth;
    const adapter = getAdapter();

    if (adapter) {
      await adapter.disconnect();
    }

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
 * Trigger a sync with the current POS provider.
 * Updates last_sync and statistics in the database.
 */
async function sync(req, res) {
  try {
    const { restaurantId } = req.auth;
    const adapter = getAdapter();

    if (!adapter) {
      return res.json({
        ok: false,
        code: 'NO_PROVIDER',
        error: 'No POS provider configured. Sync not possible.'
      });
    }

    const syncResult = await adapter.sync();

    const updated = await updateIntegration(restaurantId, {
      last_sync: syncResult.last_sync || new Date().toISOString(),
      statistics: syncResult.statistics || {}
    });

    res.json({ ok: true, message: 'Sync completed', posIntegration: updated });
  } catch (err) {
    console.error('pos/sync error:', err);
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: err.message });
  }
}

module.exports = { connect, disconnect, sync };