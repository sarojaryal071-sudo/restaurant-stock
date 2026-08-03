const repository = require('./posIntegration.repository');

async function getIntegration(restaurantId) {
  return repository.getIntegration(restaurantId);
}

async function updateIntegration(restaurantId, data) {
  return repository.updateIntegration(restaurantId, data);
}

module.exports = { getIntegration, updateIntegration };