/**
 * Flatpay POS provider plugin.
 *
 * This file implements the provider adapter interface:
 *   - connect()
 *   - disconnect()
 *   - sync()
 *   - validateConfiguration()
 *   - getProviderName()
 *
 * All real API integration logic will be added here in the future.
 * For now, methods are safe placeholders that return success.
 */

const providerName = 'Flatpay';

function validateConfiguration() {
  const requiredVars = ['FLATPAY_API_KEY', 'FLATPAY_SECRET'];
  for (const v of requiredVars) {
    if (!process.env[v]) {
      throw new Error(`Missing required environment variable: ${v}`);
    }
  }
  return true;
}

async function connect() {
  // TODO: Real Flatpay authentication, webhook registration, etc.
  validateConfiguration();
  console.log('Flatpay provider: connect() called (placeholder)');
  return { success: true };
}

async function disconnect() {
  // TODO: Real Flatpay cleanup (unregister webhooks, etc.)
  console.log('Flatpay provider: disconnect() called (placeholder)');
  return { success: true };
}

async function sync() {
  // TODO: Fetch real sales statistics from Flatpay
  console.log('Flatpay provider: sync() called (placeholder)');
  return {
    last_sync: new Date().toISOString(),
    statistics: {
      totalSales: 0,
      lastSaleAt: null
    }
  };
}

function getProviderName() {
  return providerName;
}

module.exports = {
  connect,
  disconnect,
  sync,
  validateConfiguration,
  getProviderName
};