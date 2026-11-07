const fs = require('fs');
const path = require('path');
const { databaseEngine, withTransaction } = require('../postgres');

const MIGRATION_ID = '002_domain_customer_monitoring';

// Run before any repository that reads the new columns, including tenant setup.
// One transaction and an advisory lock serialize upgrades across API replicas.
async function ensureDomainCustomerSchema({ engine = databaseEngine(), transaction = withTransaction } = {}) {
  if (engine !== 'postgresql') return false;
  return transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(2026110702)');
    await client.query(`CREATE TABLE IF NOT EXISTS app_schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const existing = await client.query('SELECT id FROM app_schema_migrations WHERE id=$1', [MIGRATION_ID]);
    if (existing.rowCount) return false;
    const sql = fs.readFileSync(path.join(__dirname, '../../postgres/002_domain_customer_monitoring.sql'), 'utf8');
    await client.query(sql);
    await client.query('INSERT INTO app_schema_migrations(id) VALUES($1)', [MIGRATION_ID]);
    console.log('[db] domain customer monitoring schema upgraded');
    return true;
  });
}
module.exports = { ensureDomainCustomerSchema, MIGRATION_ID };
