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

  // Optional: deeper per‑section validation can be added later.
  // For now, we accept any valid JSON.
  return errors;
}

module.exports = { validateSettings };