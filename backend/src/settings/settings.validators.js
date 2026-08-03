/**
 * Validate that the provided settings object conforms to the expected shape.
 * Returns an array of error messages, empty if valid.
 */
function validateSettings(section, data) {
  const errors = [];
  if (!data || typeof data !== 'object') {
    errors.push('Settings payload must be a JSON object.');
    return errors;
  }

  if (section === 'inventoryBehaviour') {
    if (typeof data.negativeStockAllowed !== 'boolean') {
      errors.push('inventoryBehaviour.negativeStockAllowed must be a boolean.');
    }
    if (typeof data.showNegativeWarning !== 'boolean') {
      errors.push('inventoryBehaviour.showNegativeWarning must be a boolean.');
    }
  }

  if (section === 'posIntegration') {
    // Accept any valid JSON object for POS integration settings.
    // The frontend will manage the exact structure.
  }

  return errors;
}

module.exports = { validateSettings };