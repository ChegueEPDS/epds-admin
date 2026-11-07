const test = require('node:test');
const assert = require('node:assert/strict');

test('document uploads persist with varchar IDs and reject other tenants or archived works', {
  skip: !process.env.WORK_DOCUMENT_TEST_DATABASE_URL
}, async () => {
  const { Client } = require('pg');
  const client = new Client({ connectionString: process.env.WORK_DOCUMENT_TEST_DATABASE_URL });
  await client.connect();
  const postgres = require('../src/postgres');
  const originalQuery = postgres.query;
  const repositoryPath = require.resolve('../src/repositories/postgres/workBoardRepository');
  try {
    await client.query('BEGIN');
    await client.query(`CREATE TEMP TABLE work_items (id varchar(24) PRIMARY KEY, tenant_id varchar(24), archived_at timestamptz);
      CREATE TEMP TABLE work_documents (
        id varchar(24), tenant_id varchar(24), work_item_id varchar(24), category text,
        display_name text, file_name text, storage_key text, content_type text, size bigint,
        uploaded_by varchar(24), uploaded_by_name text, created_at timestamptz, updated_at timestamptz
      )`);
    const tenant = '111111111111111111111111', work = '222222222222222222222222';
    await client.query('INSERT INTO work_items VALUES ($1,$2,NULL)', [work, tenant]);
    postgres.query = (sql, params) => client.query(sql, params);
    delete require.cache[repositoryPath];
    const store = require(repositoryPath);
    const input = { category: 'contract', displayName: 'Szerződés', fileName: 'test.txt', storageKey: 'test/file', size: 4 };
    const document = await store.createDocument(tenant, work, '333333333333333333333333', input);
    assert.equal(document.tenantId, tenant);
    assert.equal(document.workItemId, work);
    assert.equal(document.fileName, input.fileName);
    assert.equal(document.size, 4);
    assert.equal((await store.listDocuments(tenant, work)).length, 1);
    assert.equal(await store.createDocument('444444444444444444444444', work, null, input), null);
    await client.query('UPDATE work_items SET archived_at=now() WHERE id=$1', [work]);
    assert.equal(await store.createDocument(tenant, work, null, input), null);
  } finally {
    postgres.query = originalQuery;
    delete require.cache[repositoryPath];
    await client.query('ROLLBACK');
    await client.end();
  }
});
