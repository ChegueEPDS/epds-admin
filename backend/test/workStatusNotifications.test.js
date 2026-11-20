const assert = require('node:assert/strict');
const { test } = require('node:test');
const { statusRecipients, weeklyPeriod, weeklyJob } = require('../src/services/workStatusNotifications');
const { weeklyWorkMail } = require('../src/services/mailTemplates');

test('work status recipients are deduplicated and legacy names must resolve unambiguously', () => {
  const users = [
    { id: '1', email: 'lead@example.com', firstName: 'Work', lastName: 'Lead' },
    { id: '2', email: 'viewer@example.com', firstName: 'Common', lastName: 'Name' },
    { id: '3', email: 'other@example.com', firstName: 'Common', lastName: 'Name' }
  ];
  assert.deepEqual(statusRecipients(users, {
    responsibleUserId: '1', contributors: ['1', 'Work Lead', 'Common Name', 'VIEWER@example.com', 'stranger@example.com']
  }), ['lead@example.com', 'viewer@example.com']);
});

test('weekly report closes at 23:59 Budapest time and retains contiguous windows over the DST transition', () => {
  assert.equal(weeklyPeriod(new Date('2026-03-29T21:58:59Z')).to.toISOString(), '2026-03-22T22:59:00.000Z');
  const period = weeklyPeriod(new Date('2026-03-29T21:59:00Z'));
  assert.equal(period.from.toISOString(), '2026-03-22T22:59:00.000Z');
  assert.equal(period.to.toISOString(), '2026-03-29T21:59:00.000Z');
  assert.deepEqual(weeklyPeriod(new Date('2026-03-30T12:00:00Z')), period);
});

test('weekly jobs have stable delivery IDs and the summary shows the recorded transition', () => {
  const period = weeklyPeriod(new Date('2026-11-22T22:59:00Z'));
  const tenant = { id: 'tenant-1', name: 'EPDS' };
  const admin = { email: 'admin@example.com' };
  const job = weeklyJob(tenant, admin, period, [{
    workNumber: '2026-0042', name: 'Inspection', previousStatus: 'in_progress', status: 'completed_billable',
    changedAt: new Date(+period.to - 60_000)
  }]);
  assert.equal(job.id, weeklyJob(tenant, { email: 'ADMIN@example.com' }, period, []).id);
  assert.notEqual(job.id, weeklyJob({ ...tenant, id: 'tenant-2' }, admin, period, []).id);
  assert.match(weeklyWorkMail(job.payload, () => 'https://example.com/work').html, /Folyamatban → Teljesítve, számlázható/);
});
