/**
 * Adapter factory – the single entry point for POS provider access.
 *
 * Reads the POS_PROVIDER environment variable and dynamically loads
 * the matching provider plugin from the `providers/` folder.
 *
 * If no provider is configured, or the plugin file is missing,
 * `getAdapter()` returns null. The caller should handle this gracefully
 * (e.g., by reporting "No POS provider configured").
 */

const path = require('path');

function getAdapter() {
  const provider = (process.env.POS_PROVIDER || '').trim().toLowerCase();
  if (!provider) return null;

  // Build the expected module path relative to this file.
  const modulePath = path.join(__dirname, 'providers', provider);

  try {
    return require(modulePath);
  } catch (err) {
    // If the file doesn't exist or has an error, return null.
    console.error(`Failed to load POS provider "${provider}":`, err.message);
    return null;
  }
}

module.exports = { getAdapter };