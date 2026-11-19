const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { withTransaction } = require('../postgres');

const migrationIds = ['015_account_invitations', '016_local_mfa', '017_security_audit', '018_tenant_logo', '019_user_tenant_memberships'];

async function ensureAccountSchema() {
  await withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(2026111915)');
    for (const migrationId of migrationIds) {
      const existing = await client.query('SELECT id FROM app_schema_migrations WHERE id=$1', [migrationId]);
      if (existing.rowCount) continue;
      await client.query(readFileSync(join(__dirname, '../../postgres', `${migrationId}.sql`), 'utf8'));
      await client.query('INSERT INTO app_schema_migrations(id) VALUES ($1)', [migrationId]);
    }
  });
}

module.exports = { ensureAccountSchema };
