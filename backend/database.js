const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Test connection on startup (optional, but helpful)
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

/**
 * Execute a single query with parameters.
 * Example: await query('SELECT * FROM users WHERE id = $1', [id])
 */
async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  console.log('Executed query', { text, duration, rows: res.rowCount });
  return res;
}

/**
 * Execute a callback within a database transaction.
 * The callback receives a transaction-capable query function.
 * If the callback throws, the transaction is rolled back.
 */
async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const txQuery = (text, params) => client.query(text, params);
    const result = await callback(txQuery);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { query, transaction, pool };