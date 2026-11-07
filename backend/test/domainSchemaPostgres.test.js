const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('a deployment over the old PostgreSQL schema upgrades before repository startup and remains restart-safe', { skip: process.env.DOMAIN_SCHEMA_QA !== 'true' }, async () => {
  const db = require('../src/postgres');
  const domains = require('../src/repositories/postgres/domainHealthRepository');
  const { connectDb } = require('../src/db');
  const { ensureDomainCustomerSchema } = require('../src/services/domainSchemaMigrationService');
  try {
    assert.equal((await db.query('SELECT current_database() name')).rows[0].name, 'epds_schema_upgrade_qa');
    const schema = fs.readFileSync(path.join(__dirname, '../postgres/001_initial_schema.sql'), 'utf8');
    await db.query(schema.slice(0, schema.indexOf('\nALTER TABLE domain_monitors ADD COLUMN')));
    await assert.rejects(domains.listMonitors({ all: true }), error => error.code === '42703');
    await connectDb();
    assert.deepEqual(await domains.listMonitors({ all: true }), []);
    assert.equal((await db.query('SELECT count(*)::int count FROM app_schema_migrations')).rows[0].count, 1);
    const repeats = await Promise.all([ensureDomainCustomerSchema(), ensureDomainCustomerSchema()]);
    assert.deepEqual(repeats, [false, false]);
    await connectDb();
    assert.equal((await db.query('SELECT count(*)::int count FROM app_schema_migrations')).rows[0].count, 1);
  } finally { await db.closePostgres(); }
});
