const assert = require('node:assert/strict');
const { test } = require('node:test');
const { buildDashboard, dashboardDrilldown, workReporting } = require('../src/services/workDashboard');
const { workPeriodStart, alignedWorkYear, workTurnoverError } = require('../src/services/workTurnover');

const config = { projectSizeGrouping: true, entities: [{ id: 'eu', label: 'EU' }], serviceTypes: [{ id: 'training', label: 'Training' }] };
const fx = { snapshot: { date: '2026-11-09', rates: { EUR: { quote: '400', unit: 1 } } } };
const work = { name: 'Work', currency: 'EUR', customer: 'Client', responsible: 'Owner', ownerId: 'owner',
  entityId: 'eu', serviceTypeId: 'training', createdAt: '2026-01-01' };

test('workbook dashboard scopes, next-action checks and payment amounts use the work records', () => {
  const dashboard = buildDashboard([
    { ...work, status: 'in_progress', totalAmount: 5000, deadline: '2026-11-08', updatedAt: '2026-10-25',
      reporting: { projectSize: 'Large', invoicedAmount: 3000, paidAmount: 1000, paymentStatus: 'partially_paid' } },
    { ...work, status: 'completed_billable', totalAmount: 20000, subPaid: '100', reporting: { invoicedAmount: 500, paymentStatus: 'partially_paid' } },
    { ...work, status: 'offer', totalAmount: 750, reporting: { nextAction: 'Confirm quote', actionDue: '2026-11-08' } },
    { ...work, status: 'on_hold', totalAmount: 999, currency: 'AED' },
    { ...work, status: 'paid', totalAmount: 400 },
    { ...work, status: 'lost', totalAmount: 1000 }
  ], config, 'HUF', fx, '2026-11-09');

  assert.equal(dashboard.summary.active, 1);
  assert.equal(dashboard.summary.leads, 1);
  assert.equal(dashboard.summary.overdue, 1);
  assert.equal(dashboard.summary.activeValue.amount, 2000000);
  assert.equal(dashboard.summary.pipelineValue.amount, 300000);
  assert.equal(dashboard.summary.receivable.amount, 960000);
  assert.deepEqual(dashboard.entityTotal.counts, [1, 1, 1, 2, 0, 1]);
  assert.equal(dashboard.services[0].completed, 2);
  assert.equal(dashboard.sizes.find((row) => row.label === 'Large').count, 2);
  assert.equal(dashboard.sizes.find((row) => row.label === 'Small').count, 1);
  assert.equal(dashboard.checks.find((row) => row.label === 'Action overdue').count, 1);
  assert.equal(dashboard.paymentGaps, 1);
  assert.equal(dashboard.payments.find((row) => row.currency === 'EUR').paid, 1100);
  assert.equal(dashboard.payments.find((row) => row.currency === 'AED').unbilled, 999);
});

test('project size switches off without discarding the assigned size and keeps Excel boundaries', async () => {
  const rows = [4999.99, 5000, 19999.99, 20000].map((totalAmount) => ({ ...work, status: 'in_progress', totalAmount }));
  assert.deepEqual(buildDashboard(rows, config, 'EUR', fx, '2026-11-09').sizes.map((row) => row.count), [1, 2, 1, 0]);
  assert.equal(buildDashboard(rows, { ...config, projectSizeGrouping: false }, 'EUR', fx, '2026-11-09').sizes, null);
  const req = { scope: { tenantType: 'company' }, body: { reporting: { nextAction: 'Review' } } };
  assert.deepEqual(await workReporting(req, { projectSize: 'Large' }, false), { projectSize: 'Large', nextAction: 'Review' });
  await assert.rejects(workReporting({ ...req, body: { reporting: { projectSize: 'Large' } } }, {}, false), /disabled/);
});

test('sub-work invoice evidence flags missing totals without treating allocation as invoice value', () => {
  const dashboard = buildDashboard([{ ...work, status: 'in_progress', totalAmount: 12000, subInvoice: true }],
    config, 'EUR', fx, '2026-11-09');
  assert.equal(dashboard.payments[0].invoiced, null);
  assert.equal(dashboard.payments[0].unbilled, null);
  assert.equal(dashboard.paymentGaps, 1);
});

test('each chart and its drilldown use the same work scope and report missing financial data', () => {
  const rows = [
    { ...work, id: 'active', status: 'in_progress', totalAmount: 1000, deadline: '2026-11-08',
      reporting: { invoicedAmount: 400, paidAmount: 250, paymentStatus: 'partially_paid' } },
    { ...work, id: 'lead', status: 'offer', deadline: '2026-11-08', totalAmount: 1000 },
    { ...work, id: 'unassigned', entityId: null, status: 'on_hold', totalAmount: 2000 },
    { ...work, id: 'overpaid', status: 'paid', totalAmount: 500, currency: 'AED',
      reporting: { invoicedAmount: 400, paidAmount: 450, paymentStatus: 'paid' } },
    { ...work, id: 'missing', status: 'paid', totalAmount: 500 }
  ];
  const date = '2026-11-09';
  const dashboard = buildDashboard(rows, config, 'HUF', fx, date);
  const drill = (filter) => dashboardDrilldown(rows, config, 'HUF', fx, filter, date);
  assert.equal(dashboard.deadlines[0].count, 1);
  assert.deepEqual(drill({ kind: 'deadline', value: 'Overdue' }).works.map((row) => row.id), ['active']);
  assert.deepEqual(drill({ kind: 'entity', value: 'On Hold', entityId: '' }).works.map((row) => row.id), ['unassigned']);
  const paid = dashboard.finance.find((item) => item.key === 'paid');
  const paidWorks = drill({ kind: 'finance', value: 'paid' });
  assert.equal(paid.count, paidWorks.total);
  assert.equal(paid.value.amount, 100000);
  assert.deepEqual(paid.value.missingCurrencies, ['AED']);
  assert.equal(paid.incomplete, 1);
  assert.equal(paidWorks.works.find((row) => row.id === 'overpaid').missingRate, true);
  assert.equal(paidWorks.works.find((row) => row.id === 'missing').incomplete, true);
  assert.throws(() => drill({ kind: 'finance', value: 'other' }), /valid dashboard segment/);
});

test('the dashboard and drilldown start at the same inclusive Budapest turnover day', () => {
  const dates = {
    before: '2025-12-31T22:59:59Z', january: '2025-12-31T23:00:00Z',
    turnover: '2026-03-31T22:00:00Z', today: '2026-11-10T22:59:59Z', future: '2026-11-10T23:00:00Z'
  };
  const rows = Object.entries(dates).map(([id, createdAt]) => ({ ...work, id, createdAt, status: 'in_progress', totalAmount: 1 }));
  const asOf = '2026-11-10';
  const defaultDashboard = buildDashboard(rows, config, 'EUR', fx, asOf);
  assert.equal(defaultDashboard.periodStart, '2026-01-01');
  assert.equal(defaultDashboard.summary.active, 3);

  const start = workPeriodStart(asOf, '04-01');
  const dashboard = buildDashboard(rows, config, 'EUR', fx, asOf, start);
  const drilldown = dashboardDrilldown(rows, config, 'EUR', fx, { kind: 'entity', value: 'Active', entityId: 'eu' }, asOf, start);
  assert.equal(dashboard.periodStart, '2026-04-01');
  assert.equal(dashboard.summary.activeValue.amount, 2);
  assert.deepEqual(drilldown.works.map(({ id }) => id), ['turnover', 'today']);
});

test('the aligned sequence year advances on the local turnover and handles leap days', () => {
  assert.equal(alignedWorkYear(new Date('2026-03-31T21:59:59Z'), '04-01'), 2025);
  assert.equal(alignedWorkYear(new Date('2026-03-31T22:00:00Z'), '04-01'), 2026);
  assert.equal(alignedWorkYear(new Date('2025-12-31T23:00:00Z')), 2026);
  assert.equal(workPeriodStart('2026-02-27', '02-29'), '2025-02-28');
  assert.equal(workPeriodStart('2026-02-28', '02-29'), '2026-02-28');
  assert.equal(workPeriodStart('2028-02-28', '02-29'), '2027-02-28');
  assert.equal(workPeriodStart('2028-02-29', '02-29'), '2028-02-29');
  assert.equal(workTurnoverError({ workTurnoverDay: '02-29', alignWorkSequence: false }), null);
  assert.ok(workTurnoverError({ workTurnoverDay: '04-31' }));
  assert.ok(workTurnoverError({ alignWorkSequence: 'false' }));
});
