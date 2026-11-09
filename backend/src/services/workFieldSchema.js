const fs = require('node:fs/promises');
const path = require('node:path');
const { withTransaction } = require('../postgres');

async function ensureWorkFieldSchema() {
  await withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(2026110904)');
    for (const id of ['004_work_custom_fields', '005_work_catalogs', '006_tenant_default_currency', '007_work_dashboard']) {
      if ((await client.query('SELECT id FROM app_schema_migrations WHERE id=$1', [id])).rowCount) continue;
      await client.query(await fs.readFile(path.join(__dirname, '../../postgres', id + '.sql'), 'utf8'));
      await client.query('INSERT INTO app_schema_migrations(id) VALUES($1)', [id]);
    }
  });
}

module.exports = { ensureWorkFieldSchema };
