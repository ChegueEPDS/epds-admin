const assert = require('node:assert/strict');
const { test } = require('node:test');
const { clientCompanyDetails, normalizeTaxNumber } = require('../src/services/clientCompanyDetails');
const ClientCompany = require('../src/models/clientCompany');
const { readWorkbook, errorWorkbook } = require('../src/services/workTransferWorkbook');

test('foreign clients can have no tax number without sharing a unique key', async () => {
  const first = clientCompanyDetails({ name: 'Foreign company', country: ' de ' });
  const second = clientCompanyDetails({ name: 'Another company', country: 'DE', taxNumber: '  ' });
  assert.equal(first.country, 'DE');
  assert.equal(first.taxNumber, '');
  assert.notEqual(first.normalizedTaxNumber, second.normalizedTaxNumber);
  assert.notEqual(normalizeTaxNumber(first.normalizedTaxNumber), first.normalizedTaxNumber);
  await new ClientCompany(first).validate();
  for (const country of [undefined, '', ' hu ']) {
    assert.throws(() => clientCompanyDetails({ name: 'Hungarian company', country }), { field: 'taxNumber' });
  }
  await assert.rejects(new ClientCompany({ ...first, country: 'HU' }).validate(), /taxNumber/);
});

test('client templates and imports support tenant-scoped edits and reject the entire file on an invalid row', async (t) => {
  const db = require('../src/postgres');
  const id = '507f1f77bcf86cd799439011';
  const existing = {
    id, name: 'Original', country: 'DE', tax_number: '', normalized_tax_number: 'no-tax:current',
    postal_code: '01234', city: '', address: '', email: '', phone: '', updated_at: new Date('2026-11-18T10:00:00Z'), link_count: 1
  };
  const writes = [];
  let transactions = 0;
  t.mock.method(db, 'databaseEngine', () => 'postgresql');
  t.mock.method(db, 'query', async (sql) => ({ rows: sql.includes('link_count') ? [existing] : [] }));
  t.mock.method(db, 'withTransaction', async (fn) => {
    transactions++;
    return fn({ query: async (sql, params) => {
      if (sql.includes('link_count')) return { rows: [existing] };
      if (/^(INSERT|UPDATE)/.test(sql)) writes.push({ sql, params });
      return { rows: [] };
    } });
  });
  const { exportClients, importClients } = require('../src/services/clientTransfer');
  const download = (template) => exportClients('tenant', template);
  const template = await readWorkbook(await download(true), 'Clients');
  assert.equal(template.sheet.rowCount, 1);
  assert.equal(template.sheet.getCell('A1').value, 'ID');
  const { workbook, sheet } = await readWorkbook(await download(false), 'Clients');
  assert.equal(sheet.getCell('A2').value, id);
  assert.equal(sheet.getCell('E2').value, '01234');
  assert.equal(sheet.getColumn(sheet.columnCount).hidden, true);
  sheet.getCell('C2').value = 'Updated';
  sheet.getCell('C3').value = 'New company';
  sheet.getCell('D3').value = 'HU';
  const job = { result: {} };
  const reject = async (_job, book, tab, issues) => { job.report = await errorWorkbook(book, tab, issues); };
  const run = async () => importClients({ scope: { tenantId: 'tenant' }, actorId: 'admin', excel: await workbook.xlsx.writeBuffer(), job, reject });
  await run();
  assert.equal(transactions, 0);
  const report = await readWorkbook(job.report, 'Clients');
  assert.match(report.sheet.getCell('B3').note, /required for Hungarian/);
  assert.equal(report.sheet.getCell('C3').fill.fgColor.argb, 'FFFFE6E6');

  sheet.getCell('D3').value = 'AT';
  await run();
  assert.equal(transactions, 1);
  assert.equal(job.result.created, 1);
  assert.equal(job.result.updated, 1);
  assert.deepEqual(writes[0].params.slice(0, 5), [id, 'admin', 'no-tax:current', '', 'Updated']);
  assert.equal(writes[1].params[3], '');
  assert.deepEqual(writes[2].params, [writes[1].params[0], 'tenant']);

  existing.link_count = 2;
  await run();
  assert.equal(transactions, 1);
  const sharedReport = await readWorkbook(job.report, 'Clients');
  assert.match(sharedReport.sheet.getCell('A2').note, /shared with another tenant/);

  existing.link_count = 1;
  sheet.getCell('A2').value = '507f1f77bcf86cd799439012';
  await run();
  assert.equal(transactions, 1);
  const unauthorizedReport = await readWorkbook(job.report, 'Clients');
  assert.match(unauthorizedReport.sheet.getCell('A2').note, /linked to this tenant/);
});
