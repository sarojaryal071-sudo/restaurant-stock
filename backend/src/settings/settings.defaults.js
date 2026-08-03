// Default values for the remaining Settings sections.
// Only inventoryBehaviour and posIntegration are currently managed.
const DEFAULTS = {
  inventoryBehaviour: {
    negativeStockAllowed: false,
    showNegativeWarning: true
  },
  posIntegration: {
    provider: 'flatpay',        // placeholder
    status: 'disconnected',     // connected | disconnected
    lastSync: null,
    statistics: {
      totalSales: 0,
      lastSaleAt: null
    },
    connectStatus: 'not_configured'
  }
};

module.exports = DEFAULTS;