const { subWorkBilling } = require('./workPaymentSummary');
const { randomUUID } = require('node:crypto');
const Decimal = require('decimal.js').clone({ precision: 40 });
const { ratesOn } = require('./mnbExchangeRates');
const calendar = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Budapest' });
const lead = new Set(['inquiry', 'offer', 'cancelled', 'lost']);
const fail = (message) => Object.assign(new Error(message), { statusCode: 400 });
const dateOf = (value) => {
  if (!value) return null;
  if (!Number.isFinite(new Date(value).getTime())) throw fail('Select a valid financial event date.');
  return calendar.format(new Date(value));
};

function validDate(value, today = calendar.format(new Date())) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value && value <= today;
}

function transactions(input, previous = []) {
  if (!Array.isArray(input) || input.length > 500) throw fail('Enter at most 500 financial entries.');
  const ids = new Set();
  return input.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || !validDate(item.date) ||
        typeof item.amount !== 'number' || !Number.isFinite(item.amount) || item.amount <= 0 ||
        item.amount > 999999999999 || new Decimal(item.amount).decimalPlaces() > 2 ||
        (item.reference != null && (typeof item.reference !== 'string' || item.reference.length > 150))) {
      throw fail('Each financial entry needs a date, a positive amount with up to two decimals and a reference of at most 150 characters.');
    }
    const id = item.id || randomUUID();
    if (typeof id !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id) || ids.has(id)) throw fail('Financial entry identifiers must be unique.');
    ids.add(id);
    const old = previous.find((entry) => entry.id === id);
    // Quotes supplied by a browser/import are never trusted.
    return { id, date: item.date, amount: item.amount, reference: (item.reference || '').trim(),
      ...(old?.rate ? { rate: old.rate } : {}) };
  });
}

function validateFinancialReporting(input, result, previous) {
  if (Object.hasOwn(input, 'contractDate')) {
    if (input.contractDate && !validDate(input.contractDate)) throw fail('Select a valid acceptance date that is not in the future.');
    if (input.contractDate) result.contractDate = input.contractDate;
    else delete result.contractDate;
  }
  for (const [key, amountKey] of [['invoices', 'invoicedAmount'], ['payments', 'paidAmount']]) {
    if (Object.hasOwn(input, key)) result[key] = transactions(input[key], previous[key]);
    if (Array.isArray(result[key])) {
      const sum = result[key].reduce((sum, entry) => sum.plus(entry.amount), new Decimal(0)).toNumber();
      if (sum > 999999999999) throw fail('The financial total exceeds the maximum amount.');
      if (!Object.hasOwn(input, key) && Object.hasOwn(input, amountKey) && Number(input[amountKey]) !== sum) {
        throw fail('Edit the financial entries to change an itemized total.');
      }
      result[amountKey] = sum;
    }
  }
  return result;
}

async function lockWorkRates(previous, next, { lookup = ratesOn, now = new Date() } = {}) {
  const today = calendar.format(now);
  const reporting = { ...next.reporting };
  const prior = previous.reporting || {};
  const currency = String(next.currency || previous.currency || 'HUF').toUpperCase();
  const changedCurrency = previous.currency && previous.currency !== currency;
  if (changedCurrency && ((prior.invoicedAmount || 0) > 0 || (prior.paidAmount || 0) > 0)) {
    throw fail('The currency cannot change after invoicing or payment.');
  }
  const quote = async (date, old, estimated = false) => {
    if (old && old.currency === currency && old.requestedDate === date) {
      return old.estimated && !estimated ? { ...old, estimated: false } : old;
    }
    if (!validDate(date, today)) throw fail('Select an exchange-rate date that is not in the future.');
    const snapshot = await lookup(date);
    if (!snapshot?.date || !snapshot.rates || snapshot.date > date || !snapshot.rates.EUR || !snapshot.rates.USD ||
        (currency !== 'HUF' && !snapshot.rates[currency])) {
      throw Object.assign(new Error('The required historical exchange rate is unavailable. No rate was fixed.'), { statusCode: 503 });
    }
    return { currency, requestedDate: date, rateDate: snapshot.date, fixedAt: now.toISOString(),
      estimated, source: 'MNB', snapshot };
  };
  const locks = { ...prior.exchangeRates };
  const accepted = !lead.has(next.status) || (next.contractSigned && !['cancelled', 'lost'].includes(next.status));
  if (accepted && !reporting.contractDate && (!previous.createdAt ||
      (lead.has(previous.status) && !prior.exchangeRates?.contract) || (!previous.contractSigned && next.contractSigned))) {
    reporting.contractDate = today;
  }
  if (accepted && Number(next.totalAmount) > 0) {
    const date = reporting.contractDate || locks.contract?.requestedDate || today;
    locks.contract = await quote(date, locks.contract, !reporting.contractDate && Boolean(previous.createdAt));
  }
  for (const [key, amountKey, dateKey] of [['invoices', 'invoicedAmount', 'invoiceDate'], ['payments', 'paidAmount', 'paidAt']]) {
    if (Array.isArray(reporting[key])) {
      delete locks[key];
      const entries = reporting[key];
      const fixed = new Array(entries.length);
      let cursor = 0;
      await Promise.all(Array.from({ length: Math.min(4, entries.length) }, async () => {
        while (cursor < entries.length) {
          const index = cursor++;
          const entry = entries[index];
          const old = (prior[key] || []).find((item) => item.id === entry.id);
          fixed[index] = { ...entry, rate: await quote(entry.date, old?.rate) };
        }
      }));
      reporting[key] = fixed;
    } else if (Number(reporting[amountKey]) > 0) {
      const explicit = dateOf(next[dateKey]);
      const date = explicit || locks[key]?.requestedDate || today;
      locks[key] = await quote(date, locks[key], !explicit);
    }
  }
  reporting.exchangeRates = locks;
  return reporting;
}

function partsFor(row, key) {
  const reporting = row.reporting || {};
  const locks = reporting.exchangeRates || {};
  const part = (amount, rate) => ({ currency: row.currency, amount: String(amount), ...(rate?.snapshot ? { snapshot: rate.snapshot } : {}) });
  const entries = (type, amountKey) => Array.isArray(reporting[type])
    ? reporting[type].map((entry) => ({ amount: new Decimal(entry.amount), rate: entry.rate, date: entry.date }))
    : [{ amount: row[amountKey] || new Decimal(0), rate: locks[type], date: '' }];
  if (key === 'contract') return [part(row.contract, row.lead ? null : locks.contract)];
  if (key === 'unbilled') return [part(row.unbilled, locks.contract)];
  if (key === 'paid') {
    if (reporting.paidAmount == null && Array.isArray(row.subPaymentEntries)) {
      return row.subPaymentEntries.filter((entry) => Number(entry.amount) > 0)
        .map((entry) => ({ ...part(entry.amount, entry.rate), currency: entry.currency || row.currency }));
    }
    return entries('payments', 'paid').map((entry) => part(entry.amount, entry.rate));
  }
  if (key === 'receivable') {
    // Settle oldest invoices first, in the original currency. A fully paid invoice
    // has no receivable; exchange gains/losses must not become fictitious debt.
    let paid = row.paid || new Decimal(0);
    const invoices = entries('invoices', 'invoiced').sort((a, b) => a.date.localeCompare(b.date));
    const parts = invoices.map((entry) => {
      const settled = Decimal.min(paid, entry.amount);
      paid = paid.minus(settled);
      return part(entry.amount.minus(settled), entry.rate);
    });
    if (paid.gt(0)) parts.push(part(paid.negated(), locks.invoices || invoices.at(-1)?.rate));
    return parts;
  }
  return [part(row[key], null)];
}

async function lockSubWorkRates(previous, next, options) {
  const before = subWorkBilling(previous);
  const after = subWorkBilling(next);
  const reporting = await lockWorkRates({ ...previous, reporting: {
    invoicedAmount: before.billed ? before.amount.toNumber() : 0,
    paidAmount: before.received.toNumber(), exchangeRates: previous.exchangeRates
  } }, { ...next, totalAmount: 0, reporting: {
    invoicedAmount: after.billed ? after.amount.toNumber() : 0,
    paidAmount: after.received.toNumber()
  } }, options);
  return reporting.exchangeRates;
}

function rateHealth(row) {
  const reporting = row.reporting || {};
  const locks = reporting.exchangeRates || {};
  const relevant = [];
  if (!row.lead && row.contract.gt(0)) relevant.push(locks.contract);
  if (row.invoiced?.gt(0)) {
    relevant.push(...(Array.isArray(reporting.invoices) ? reporting.invoices.map((entry) => entry.rate) : [locks.invoices]));
  }
  if (row.paid?.gt(0)) {
    relevant.push(...(Array.isArray(reporting.payments) ? reporting.payments.map((entry) => entry.rate)
      : reporting.paidAmount == null && Array.isArray(row.subPaymentEntries)
        ? row.subPaymentEntries.filter((entry) => Number(entry.amount) > 0).map((entry) => entry.rate) : [locks.payments]));
  }
  return { floating: relevant.some((rate) => !rate?.snapshot), estimated: relevant.some((rate) => rate?.estimated) };
}

module.exports = { validDate, transactions, validateFinancialReporting, lockWorkRates, lockSubWorkRates, partsFor, rateHealth };
