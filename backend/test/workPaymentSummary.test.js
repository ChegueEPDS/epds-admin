const assert = require('node:assert/strict');
const { test } = require('node:test');
const { calculatedReporting } = require('../src/services/workPaymentSummary');

test('work payments are calculated from billable sub-work states and replace manual reporting totals', () => {
  const summary = calculatedReporting({ invoicedAmount: 900, paidAmount: 900,
    paymentStatus: 'paid', backupId: 'backup' }, [
    { id: 'a', status: 'paid', amount: 30 },
    { id: 'b', status: 'invoiced', amount: 50, paidAmount: 12.25 },
    { id: 'c', status: 'completed_billable', amount: 80 },
    { id: 'd', status: 'closed', amount: 20, invoiceNumber: 'INV-1', paidAmount: 20 },
    { id: 'e', status: 'closed', amount: 100 },
    { id: 'f', status: 'paid', amount: 100, archivedAt: '2026-11-19' },
    { id: 'g', status: 'cancelled', amount: 100, paidAmount: 100 },
    { id: 'h', status: 'lost', amount: 100, paidAmount: 100 }
  ]);
  assert.equal(summary.backupId, 'backup');
  assert.equal(summary.invoicedAmount, 100);
  assert.equal(summary.paidAmount, 62.25);
  assert.equal(summary.paymentStatus, 'partially_paid');
  assert.deepEqual(summary.payments.map(({ id }) => id), ['a', 'b', 'd']);
});
