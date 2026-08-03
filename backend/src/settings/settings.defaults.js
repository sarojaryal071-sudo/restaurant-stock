// Default values for the remaining Settings sections.
// Only inventoryBehaviour and posIntegration are currently managed.
const DEFAULTS = {
  inventoryBehaviour: {
    negativeStockAllowed: false,
    showNegativeWarning: true
  },
  posIntegration: {
    provider: 'None',
    status: 'Disconnected',
    last_sync: null,
    configuration: {},
    statistics: {
      totalSales: 0,
      lastSaleAt: null
    }
  }
};

module.exports = DEFAULTS;