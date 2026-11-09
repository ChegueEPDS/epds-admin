const assert = require('node:assert/strict');
const { test } = require('node:test');
const Excel = require('exceljs');
const tracker = require('../src/services/projectTrackerDomain');
const { readWorkbook } = require('../src/services/projectTrackerWorkbook');
const { requireTenantFeature } = require('../src/middlewares/authMiddleware');

test('business units and typed fields preserve stable selections while blocking cross-catalog values', () => {
  const original = tracker.initial();
  const config = tracker.settings({
    ...original,
    units: [{ id: 'uae', name: 'UAE' }],
    fields: [{ id: 'scheme', target: 'work', type: 'select', label: 'Scheme',
      locations: ['boardEditor', 'trackerList'], options: [{ id: 'iec', name: 'IEC' }], required: true }]
  }, original);
  assert.deepEqual(tracker.customValues(config, 'work', { scheme: 'iec' }, {}, [], 'boardEditor'), { scheme: 'iec' });
  assert.throws(() => tracker.customValues(config, 'work', { scheme: 'foreign' }, {}, [], 'boardEditor'), /tenant/);
  assert.throws(() => tracker.customValues(config, 'work', { scheme: 'iec' }, {}, [], 'trackerEditor'), /unavailable/);
  assert.throws(() => tracker.settings({ ...config, units: [] }, config), /Archive/);
  assert.throws(() => tracker.settings({ ...config, fields: [{ ...config.fields[0], type: 'text' }] }, config), /new field/);
});

test('delivery status is independent of billing and unresolved opening amounts stay unknown', () => {
  const work = { status: 'completed_billable', currency: 'AED', totalAmount: 1000, customer: 'Client', responsibleUserId: 'user' };
  const config = tracker.initial();
  const invoice = { cents: 80000, due: '2026-11-01', payments: [{ cents: 30000 }], adjustments: [{ cents: 5000 }] };
  const row = tracker.summarize(work, { invoices: [invoice] }, config, '2026-11-09');
  assert.equal(row.stage, 'Completed');
  assert.equal(row.payment.status, 'Partially paid');
  assert.equal(row.payment.receivable, 450);
  assert.equal(row.payment.unbilled, 200);
  assert.equal(row.payment.overdue, true);
  assert.equal(row.eur, null);
  const uncertain = tracker.finances(work, { opening: { invoicedCents: 80000, paidCents: null } }, '2026-11-09');
  assert.equal(uncertain.receivable, null);
  assert.equal(uncertain.status, 'Needs reconciliation');
});

test('tenant context cannot borrow another tenant feature, and clients cannot access either module', () => {
  const check = (feature, scope) => {
    let outcome;
    const res = { status(code) { outcome = code; return this; }, json() {} };
    requireTenantFeature(feature)({ role: 'SuperAdmin', scope: { tenantId: 'a', ...scope },
      user: { tenantFeatures: { workBoard: { enabled: true }, projectTracker: { enabled: true } } } }, res, () => { outcome = 200; });
    return outcome;
  };
  const enabled = { workBoard: { enabled: true }, projectTracker: { enabled: true } };
  assert.equal(check('workBoard', { tenantType: 'client', tenantFeatures: enabled }), 403);
  assert.equal(check('projectTracker', { tenantType: 'client', tenantFeatures: enabled }), 403);
  assert.equal(check('projectTracker', { tenantType: 'company', tenantFeatures: { projectTracker: enabled.projectTracker } }), 403);
  assert.equal(check('projectTracker', { tenantType: 'company', tenantFeatures: { workBoard: enabled.workBoard } }), 403);
  assert.equal(check('projectTracker', { tenantType: 'company', tenantFeatures: enabled }), 200);
});

test('xlsx reader keeps leading PO zeroes, ignores formula cells and flags conflicting payment claims', async () => {
  const workbook = new Excel.Workbook();
  const sheet = workbook.addWorksheet('Tracker');
  sheet.getCell('C4').value = 'Project / Scope';
  sheet.getCell('L4').value = 'PO No.';
  sheet.getCell('A5').value = 1;
  sheet.getCell('C5').value = 'Package';
  sheet.getCell('G5').value = 'ongoing';
  sheet.getCell('L5').value = '00001';
  sheet.getCell('M5').value = 100;
  sheet.getCell('N5').value = 'AED';
  sheet.getCell('O5').value = 'Paid';
  sheet.getCell('P5').value = 100;
  sheet.getCell('S5').value = { formula: 'P5', result: 100 };
  const result = await readWorkbook(await workbook.xlsx.writeBuffer());
  assert.equal(result.rows[0].po, '00001');
  assert.equal(result.rows[0].paid, null);
  assert.ok(result.rows[0].checks.includes('Reported payment has no paid amount'));
  assert.ok(result.rows[0].checks.includes('Missing delivery deadline'));
});


test('delivery dates from the old board preserve the tenant calendar day', () => {
  const work = { status: 'in_progress', currency: 'EUR', totalAmount: 100, deadline: '2026-11-08T23:00:00.000Z' };
  const config = { ...tracker.initial(), reminders: true };
  const row = tracker.summarize(work, {}, config, '2026-11-09');
  assert.equal(row.deadline, '2026-11-09');
  assert.equal(row.overdue, false);
  assert.equal(row.reviewDue, true);
});
