// Default configuration for every settings section.
// When a restaurant has no saved settings, the backend returns these.

const DEFAULTS = {
  permissions: {
    // No defaults needed – permissions are managed by the backend RBAC system.
  },
  restaurant: {
    name: '',
    displayName: '',
    logoUrl: '',
    themeColor: '#D4AF37',
    address: '',
    phone: ''
  },
  inventory: {
    negativeStockAllowed: false,
    showNegativeWarning: true,
    defaultBottleSize: 700,
    defaultUnit: 'ml'
  },
  recipe: {
    defaultGlass: '',
    defaultGarnish: '',
    showIngredients: true
  },
  pos: {
    autoResolveShortages: false,
    enableTestSales: true
  },
  backup: {
    autoBackup: false,
    backupFrequency: 'daily'
  },
  about: {
    version: '1.0.0',
    lastUpdated: ''
  }
};

module.exports = DEFAULTS;