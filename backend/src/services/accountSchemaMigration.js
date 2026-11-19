const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { withTransaction } = require('../postgres');

const migrationId = '015_account_invitations';

async function ensureAccountSchema() {
  await withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(2026111915)');
    const existing = await client.query('SELECT id FROM app_schema_migrations WHERE id=$1', [migrationId]);
    if (existing.rowCount) return;
    await client.query(readFileSync(join(__dirname, '../../postgres', `${migrationId}.sql`), 'utf8'));
    await client.query('INSERT INTO app_schema_migrations(id) VALUES ($1)', [migrationId]);
  });
}

module.exports = { ensureAccountSchema };
