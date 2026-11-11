const calendar = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Budapest' });
const statusDate = { completed_billable: 'completionDate', invoiced: 'invoiceDate', paid: 'paidAt' };

function day(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? calendar.format(date) : null;
}

function paymentDue(completion, paymentDays) {
  const days = Number(paymentDays);
  if (!completion || !Number.isSafeInteger(days) || days < 0) return null;
  const date = new Date(completion);
  date.setUTCDate(date.getUTCDate() + days);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}

function workBillingDates(input, existing = {}, now = new Date()) {
  const dates = {};
  const field = Object.hasOwn(statusDate, input.status) ? statusDate[input.status] : null;
  const value = (key) => Object.hasOwn(input, key) ? input[key] : existing[key];
  if (field && input.status !== existing.status && !value(field)) {
    dates[field] = new Date(day(now));
  }

  const previousCompletion = day(existing.completionDate);
  const completion = day(dates.completionDate ?? value('completionDate'));
  const previousDays = Number(existing.paymentDeadlineDays ?? 30);
  const days = Number(input.paymentDeadlineDays ?? previousDays);
  const due = paymentDue(completion, days);
  const previousDue = day(existing.invoicePaymentDeadline);
  const currentDue = day(value('invoicePaymentDeadline'));

  // Recalculate an existing automatic deadline when its inputs change.
  // A separately entered due date takes precedence.
  const inputsChanged = completion !== previousCompletion || days !== previousDays;
  if (inputsChanged && previousDue && currentDue === previousDue
      && previousDue === paymentDue(previousCompletion, previousDays)) {
    dates.invoicePaymentDeadline = due ? new Date(due) : null;
  } else if (due && !currentDue) {
    dates.invoicePaymentDeadline = new Date(due);
  }
  return dates;
}

module.exports = { workBillingDates };
