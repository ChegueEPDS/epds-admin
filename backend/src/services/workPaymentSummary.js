const Decimal = require('decimal.js');

const date = (value) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10);

function subWorkBilling(sub) {
  const billed = ['invoiced', 'paid'].includes(sub.status) ||
    (sub.status === 'closed' && Boolean(sub.invoiceNumber || sub.invoiceDate || sub.paidAt || Number(sub.paidAmount)));
  const amount = new Decimal(sub.amount || 0);
  return { billed, amount, received: new Decimal(Number(sub.paidAmount) > 0 ? sub.paidAmount : sub.status === 'paid' ? amount : 0) };
}

function workPaymentSummary(subWorks) {
  let invoiced = new Decimal(0);
  let paid = new Decimal(0);
  let pending = false;
  let hasInvoice = false;
  const invoices = [];
  const payments = [];

  for (const sub of subWorks) {
    if (sub.archivedAt || ['cancelled', 'lost'].includes(sub.status)) continue;
    const { billed, amount, received } = subWorkBilling(sub);
    if (!billed) {
      pending ||= Number(sub.amount) > 0;
      continue;
    }
    hasInvoice = true;
    invoiced = invoiced.plus(amount);
    paid = paid.plus(received);
    pending ||= received.lt(amount);
    const id = String(sub.id ?? sub._id);
    if (amount.gt(0)) invoices.push({ id, amount: amount.toNumber(), date: date(sub.invoiceDate),
      reference: sub.invoiceNumber || '', rate: sub.exchangeRates?.invoices });
    if (received.gt(0)) payments.push({ id, amount: received.toNumber(), date: date(sub.paidAt), rate: sub.exchangeRates?.payments });
  }

  return {
    invoicedAmount: invoiced.toNumber(), paidAmount: paid.toNumber(),
    paymentStatus: !hasInvoice ? 'not_invoiced' : paid.isZero() ? 'invoiced' : pending ? 'partially_paid' : 'paid',
    invoices, payments
  };
}

function calculatedReporting(reporting, subWorks) {
  return { ...reporting, ...workPaymentSummary(subWorks) };
}

module.exports = { subWorkBilling, workPaymentSummary, calculatedReporting };
