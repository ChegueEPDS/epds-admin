const test = require('node:test');
const assert = require('node:assert/strict');
const { ensureDomainCustomerSchema, MIGRATION_ID } = require('../src/services/domainSchemaMigrationService');

test('runtime upgrade applies the new columns before recording success', async () => {
  const calls = [];
  const transaction = async work => work({ query: async (sql, parameters) => {
    calls.push({ sql, parameters });
    return { rowCount: 0, rows: [] };
  }});
  assert.equal(await ensureDomainCustomerSchema({ engine: 'postgresql', transaction }), true);
  assert.match(calls[0].sql, /pg_advisory_xact_lock/);
  assert.match(calls[3].sql, /ADD COLUMN IF NOT EXISTS monitoring_state/);
  assert.match(calls[3].sql, /CREATE TABLE IF NOT EXISTS domain_operations/);
  assert.match(calls[4].sql, /INSERT INTO app_schema_migrations/);
  assert.deepEqual(calls[4].parameters, [MIGRATION_ID]);
});

test('already applied upgrade skips DDL and historical rewrites on restart', async () => {
  const calls = [];
  const transaction = async work => work({ query: async sql => {
    calls.push(sql);
    return { rowCount: sql.startsWith('SELECT id') ? 1 : 0, rows: [] };
  }});
  assert.equal(await ensureDomainCustomerSchema({ engine: 'postgresql', transaction }), false);
  assert.equal(calls.length, 3);
});

test('a failed upgrade never records its migration marker', async () => {
  const calls = [];
  const transaction = async work => work({ query: async sql => {
    calls.push(sql);
    if (sql.includes('ALTER TABLE domain_monitors')) throw Error('upgrade failed');
    return { rowCount: 0, rows: [] };
  }});
  await assert.rejects(ensureDomainCustomerSchema({ engine: 'postgresql', transaction }), /upgrade failed/);
  assert.ok(!calls.some(sql => sql.startsWith('INSERT INTO app_schema_migrations')));
});

test('MongoDB connection does not run PostgreSQL schema SQL', async () => {
  assert.equal(await ensureDomainCustomerSchema({ engine: 'mongodb', transaction: () => assert.fail('PostgreSQL must not run') }), false);
});
