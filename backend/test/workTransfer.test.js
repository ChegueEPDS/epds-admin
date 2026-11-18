const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createWorkbook, readWorkbook, errorWorkbook } = require('../src/services/workTransferWorkbook');
const { columnsFor, formatWork, prepareRows } = require('../src/services/workTransferFields');

const id = '123456789012345678901234';
const oldId = '234567890123456789012345';
const fileId = 'a5696128-63a7-445f-bc63-983030ee7831';
const context = {
  tenantId: 'tenant', currency: 'EUR', clients: [], users: [],
  config: {
    version: 2, entities: [], serviceTypes: [{ id: 'inspection', code: 'INSP', label: 'Inspection' }],
    addServiceTypeCodeToWorkNumber: true,
    fields: [{ id: fileId, label: 'Certificate', card: 'basic', type: 'file' }]
  }
};
const columns = columnsFor(context);
const existing = {
  id, year: 2026, sequenceNumber: 3, workNumber: 'INSP26-0003',
  updatedAt: new Date('2026-01-01T10:20:30Z'), fieldRevision: 4,
  name: 'Previous work', status: 'inquiry', currency: 'EUR', serviceTypeId: 'inspection',
  customFields: { [fileId]: { id: fileId, name: 'original.pdf', size: 100 } }
};

async function open(works = []) {
  const bytes = await createWorkbook(columns, works, (work) => formatWork(work, columns, context.config));
  return readWorkbook(bytes);
}

function validate(sheet, works, files = new Map()) {
  return prepareRows({ sheet, columns, context, works, files, progress: () => {} });
}

test('tenant export uses A for ID and supports unchanged, updated and new rows in the same workbook', async () => {
  const { sheet } = await open([existing]);
  assert.equal(sheet.getCell('A1').value, 'ID');
  assert.equal(sheet.getCell('A2').value, id);
  assert.equal(sheet.getColumn(sheet.columnCount).hidden, true);
  const same = await validate(sheet, [existing]);
  assert.deepEqual(same.issues, []);
  assert.equal(same.rows[0].modified, false);

  sheet.getCell('C2').value = 12;
  sheet.getCell('D2').value = 'Renamed';
  sheet.getCell('B3').value = 2025;
  sheet.getCell('C3').value = 7;
  sheet.getCell('D3').value = 'New work';
  sheet.getCell('G3').value = 'INSP -- Inspection';
  const fileColumn = columns.findIndex((column) => column.type === 'file') + 1;
  sheet.getCell(3, fileColumn).value = 'reports/report.pdf';
  const result = await validate(sheet, [existing], new Map([['reports/report.pdf', Buffer.from('test')]]));
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.rows.map(({ id, workNumber, modified }) => [id, workNumber, modified]),
    [[id, 'INSP26-0012', true], ['', 'INSP25-0007', true]]);
  assert.equal(result.rows[1].changes.customFields[fileId].name, 'report.pdf');
  assert.equal(result.rows[1].uploads.length, 1);
});

test('an invalid import workbook reports stale IDs, invalid fields and archived number conflicts in the original cells', async () => {
  const { workbook, sheet } = await open([existing]);
  sheet.getCell('J2').value = 'Unknown status';
  sheet.getCell('C2').value = 8;
  sheet.getCell('A3').value = 'ab12ab12ab12ab12ab12ab12';
  sheet.getCell('B3').value = 2026;
  sheet.getCell('C3').value = 8;
  sheet.getCell('D3').value = 'Another work';
  sheet.getCell('G3').value = 'inspection';
  const archived = { ...existing, id: oldId, name: 'Archived project', sequenceNumber: 8, workNumber: 'OLD26-0008', archivedAt: new Date() };
  const { issues } = await validate(sheet, [{ ...existing, fieldRevision: 5 }, archived]);
  assert.ok(issues.some((issue) => issue.row === 2 && issue.col === 1 && /changed/.test(issue.message)));
  assert.ok(issues.some((issue) => issue.row === 3 && issue.col === 1 && /current tenant/.test(issue.message)));
  for (const row of [2, 3]) {
    assert.ok(issues.some((issue) => issue.row === row && issue.col === 3 &&
      /Year 2026, sequence 8 is already used by "Archived project".*OLD26-0008.*filter to Deleted/.test(issue.message)));
    assert.ok(issues.some((issue) => issue.row === row && issue.col === 3 && /more than once/.test(issue.message)));
  }
  const report = await readWorkbook(await errorWorkbook(workbook, sheet, issues));
  assert.equal(report.sheet.getCell('J2').value, 'Unknown status');
  assert.equal(report.sheet.getCell('J2').fill.fgColor.argb, 'FFFF7070');
  assert.equal(report.sheet.getCell('D2').fill.fgColor.argb, 'FFFFE6E6');
  assert.match(report.sheet.getCell('J2').note, /Select an available value/);
});

test('background imports reject the whole batch on a save-time conflict and enforce tenant job access', async (t) => {
  const db = require('../src/postgres');
  const settings = require('../src/services/workFields');
  const currency = require('../src/services/tenantCurrency');
  const repository = require('../src/repositories/postgres/workBoardRepository');
  const tenantId = 'tenant';
  const actorId = 'administrator';
  const existingRow = {
    id, year: 2026, sequence_number: 3, work_number: 'INSP26-0003',
    name: existing.name, status: 'inquiry', currency: 'EUR', service_type_id: 'inspection',
    updated_at: existing.updatedAt, field_revision: 4, total_amount: 0, cost_amount: 0,
    payment_deadline_days: 30, contract_signed: false, performance_certificate: false,
    custom_fields: existing.customFields
  };
  t.mock.method(db, 'databaseEngine', () => 'postgresql');
  t.mock.method(settings, 'settings', async () => context.config);
  t.mock.method(currency, 'getDefaultCurrency', async () => context.currency);
  t.mock.method(db, 'query', async (sql) => ({ rows: sql.includes('FROM work_items') ? [existingRow] : [] }));
  let concurrentConflict = true;
  const counters = [];
  t.mock.method(db, 'withTransaction', async (run) => run({ query: async (sql, params) => {
    if (sql.includes('FROM tenants')) return { rows: [{ work_field_settings: context.config, default_currency: 'EUR' }] };
    if (sql.includes('FROM work_items')) return { rows: concurrentConflict ? [existingRow, { ...existingRow, id: oldId,
      sequence_number: 7, work_number: 'INSP26-0007', archived_at: new Date() }] : [existingRow] };
    if (!concurrentConflict && sql.includes('INSERT INTO work_sequences')) {
      counters.push(params.slice(1));
      return { rows: [] };
    }
    throw new Error('No SQL write should be issued after a conflict.');
  } }));
  const insert = t.mock.method(repository, 'insertWork', async () => ({}));
  const update = t.mock.method(repository, 'updateWork', async () => ({}));
  const { startImport, importJob } = require('../src/services/workTransfer');

  const { workbook, sheet } = await open([existing]);
  sheet.getCell('D2').value = 'Attempted edit';
  sheet.getCell('B3').value = 2026;
  sheet.getCell('C3').value = 7;
  sheet.getCell('D3').value = 'Conflicting work';
  sheet.getCell('G3').value = 'inspection';
  const excel = await workbook.xlsx.writeBuffer();
  const submit = () => startImport({ scope: { tenantId }, actorId, excel });
  const job = submit();
  assert.throws(() => importJob(job.id, 'another tenant', actorId), { statusCode: 404 });
  assert.throws(() => importJob(job.id, tenantId, 'another administrator'), { statusCode: 404 });

  const { setTimeout: wait } = require('node:timers/promises');
  async function finish(status) {
    for (let attempt = 0; attempt < 100 && !importJob(status.id, tenantId, actorId).finishedAt; attempt++) await wait(20);
  }
  await finish(job);
  assert.equal(job.state, 'rejected', job.message);
  assert.equal(insert.mock.callCount(), 0);
  assert.equal(update.mock.callCount(), 0);
  const report = await readWorkbook(importJob(job.id, tenantId, actorId).report);
  assert.match(report.sheet.getCell('C3').note, /already used/);

  concurrentConflict = false;
  const retry = submit();
  await finish(retry);
  assert.equal(retry.state, 'succeeded', retry.message);
  assert.equal(retry.created, 1);
  assert.equal(retry.updated, 1);
  assert.equal(update.mock.calls[0].arguments[1], id);
  assert.equal(update.mock.calls[0].arguments[3].name, 'Attempted edit');
  assert.equal(insert.mock.calls[0].arguments[3].workNumber, 'INSP26-0007');
  assert.deepEqual(counters, [[tenantId, 'work:2026', 7]]);
});
