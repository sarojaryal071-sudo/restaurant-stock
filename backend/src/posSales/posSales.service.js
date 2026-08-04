const repository = require('./posSales.repository');

function resolveDateRange(period, customStart, customEnd) {
  const now = new Date();
  let start = null, end = null;

  switch (period) {
    case 'today':
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).toISOString();
      break;
    case '7d':
      start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      end = now.toISOString();
      break;
    case '30d':
      start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      end = now.toISOString();
      break;
    case 'month':
      start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).toISOString();
      break;
    case 'custom':
      if (customStart) start = new Date(customStart).toISOString();
      if (customEnd) end = new Date(customEnd).toISOString();
      break;
    default:
      // default to today
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).toISOString();
  }
  return { start, end };
}

async function getSummary(restaurantId, period, customStart, customEnd) {
  const { start, end } = resolveDateRange(period, customStart, customEnd);
  const summary = await repository.getSummary(restaurantId, start, end);
  return {
    period: period || 'today',
    start,
    end,
    summary
  };
}

module.exports = { getSummary, resolveDateRange };