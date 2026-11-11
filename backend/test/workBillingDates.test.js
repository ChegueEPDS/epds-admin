const test = require('node:test');
const assert = require('node:assert/strict');
const { workBillingDates } = require('../src/services/workBillingDates');

test('billing milestones default to the current Budapest date on entry', () => {
  const now = new Date('2026-03-28T23:30:00Z');
  assert.deepEqual(workBillingDates({ status: 'completed_billable', paymentDeadlineDays: 2 }, {}, now), {
    completionDate: new Date('2026-03-29'),
    invoicePaymentDeadline: new Date('2026-03-31')
  });
  const completed = { status: 'completed_billable', completionDate: '2026-03-29', paymentDeadlineDays: 0 };
  assert.deepEqual(workBillingDates({ status: 'invoiced' }, completed, now), {
    invoiceDate: new Date('2026-03-29'),
    invoicePaymentDeadline: new Date('2026-03-29')
  });
  assert.deepEqual(workBillingDates({ status: 'paid' }, { status: 'invoiced' }, now), {
    paidAt: new Date('2026-03-29')
  });
  assert.deepEqual(workBillingDates({ status: 'paid' }, { status: 'paid' }, now), {});
  assert.deepEqual(workBillingDates({ status: 'paid', paidAt: '2026-03-26' }, { status: 'invoiced' }, now), {});
});

test('automatic due dates follow completion and payment-term edits while manual dates take precedence', () => {
  const work = { completionDate: new Date('2026-10-24T22:00:00Z'), paymentDeadlineDays: 10,
    invoicePaymentDeadline: '2026-11-04' };
  assert.deepEqual(workBillingDates({ completionDate: '2026-10-26', paymentDeadlineDays: 15 }, work), {
    invoicePaymentDeadline: new Date('2026-11-10')
  });
  assert.deepEqual(workBillingDates({ completionDate: null }, work), { invoicePaymentDeadline: null });
  assert.deepEqual(workBillingDates({ paymentDeadlineDays: 15, invoicePaymentDeadline: '2026-11-20' }, work), {});
  assert.deepEqual(workBillingDates({ paymentDeadlineDays: 15 }, { ...work, invoicePaymentDeadline: '2026-11-20' }), {});
});
