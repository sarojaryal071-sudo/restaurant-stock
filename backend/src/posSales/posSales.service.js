const repository = require('./posSales.repository');

function toIsoOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function resolveDateRange(period, customStart, customEnd) {
  const now = new Date();

  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  const startProvided = toIsoOrNull(customStart);
  const endProvided = toIsoOrNull(customEnd);

  // If the frontend sends explicit start/end values, they always win.
  if (startProvided || endProvided) {
    const start = startProvided || todayStart.toISOString();
    const end = endProvided || todayEnd.toISOString();
    return { start, end };
  }

  switch (period) {
    case 'today':
      return {
        start: todayStart.toISOString(),
        end: todayEnd.toISOString()
      };

    case '7d':
    case '7days': {
      const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      return {
        start: start.toISOString(),
        end: now.toISOString()
      };
    }

    case '30d':
    case '30days': {
      const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      return {
        start: start.toISOString(),
        end: now.toISOString()
      };
    }

    case 'month': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return {
        start: start.toISOString(),
        end: todayEnd.toISOString()
      };
    }

    default:
      return {
        start: todayStart.toISOString(),
        end: todayEnd.toISOString()
      };
  }
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