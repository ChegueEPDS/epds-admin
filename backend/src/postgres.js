let pool;

function databaseEngine() {
  return String(process.env.DATABASE_ENGINE || 'mongodb').trim().toLowerCase();
}

function isPostgresConfigured() {
  return Boolean(String(process.env.DATABASE_URL || '').trim());
}

function getPool() {
  if (!isPostgresConfigured()) throw new Error('Missing DATABASE_URL');
  if (!pool) {
    // Loaded lazily so MongoDB mode and existing tests do not require a live
    // PostgreSQL server. The production image installs pg during build.
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Math.max(2, Number(process.env.POSTGRES_POOL_MAX || 12)),
      idleTimeoutMillis: Math.max(1000, Number(process.env.POSTGRES_IDLE_TIMEOUT_MS || 30000)),
      connectionTimeoutMillis: Math.max(1000, Number(process.env.POSTGRES_CONNECT_TIMEOUT_MS || 5000)),
      statement_timeout: Math.max(1000, Number(process.env.POSTGRES_STATEMENT_TIMEOUT_MS || 30000)),
      application_name: 'epds-admin-backend'
    });
    pool.on('error', (error) => console.error('[postgres] idle client error', error));
  }
  return pool;
}

async function query(text, params = []) {
  return getPool().query(text, params);
}

async function withTransaction(callback, options = {}) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    if (options.isolationLevel) {
      const level = String(options.isolationLevel).toUpperCase();
      const allowed = new Set(['READ COMMITTED', 'REPEATABLE READ', 'SERIALIZABLE']);
      if (!allowed.has(level)) throw new Error(`Unsupported isolation level: ${level}`);
      await client.query(`SET TRANSACTION ISOLATION LEVEL ${level}`);
    }
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function checkPostgresHealth(timeoutMs = 1500) {
  if (!isPostgresConfigured()) return { ok: false, configured: false, stateLabel: 'not-configured' };
  try {
    const result = await Promise.race([
      query('SELECT current_database() AS database, current_user AS user, now() AS server_time'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('PostgreSQL ping timed out')), timeoutMs))
    ]);
    return { ok: true, configured: true, stateLabel: 'connected', ...result.rows[0] };
  } catch (error) {
    return { ok: false, configured: true, stateLabel: 'error', error: error.message };
  }
}

async function closePostgres() {
  if (!pool) return;
  const current = pool;
  pool = undefined;
  await current.end();
}

module.exports = {
  databaseEngine, isPostgresConfigured, getPool, query,
  withTransaction, checkPostgresHealth, closePostgres
};
