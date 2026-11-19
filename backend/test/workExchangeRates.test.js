const assert = require('node:assert/strict');
const { test } = require('node:test');
const { lockWorkRates, lockSubWorkRates, validateFinancialReporting } = require('../src/services/workExchangeRates');
const { buildDashboard, workReporting } = require('../src/services/workDashboard');
const { parseHistoricalRates, withAedRate, convertTotals } = require('../src/services/mnbExchangeRates');

const snapshot = (date, eur = '400', usd = '360') => withAedRate({ date, rates: {
  EUR: { quote: eur, unit: 1 }, USD: { quote: usd, unit: 1 }
} });
const rate = (date, eur, usd) => ({ currency: 'USD', requestedDate: date, rateDate: date,
  fixedAt: date + 'T12:00:00Z', estimated: false, snapshot: snapshot(date, eur, usd) });
const config = { entities: [], serviceTypes: [], projectSizeGrouping: false };
const now = new Date('2026-11-19T12:00:00Z');
const base = { currency: 'USD', status: 'in_progress', totalAmount: 1000, createdAt: '2026-01-01' };

test('acceptance fixes one snapshot, persists a zero-value acceptance date, and ordinary edits never reprice it', async () => {
  const calls = [];
  const lookup = async (date) => { calls.push(date); return snapshot(date); };
  const previous = { ...base, status: 'offer' };
  const next = { ...base, reporting: {} };
  next.reporting = await lockWorkRates(previous, next, { lookup, now });
  assert.equal(next.reporting.contractDate, '2026-11-19');
  assert.equal(next.reporting.exchangeRates.contract.estimated, false);
  const edited = await lockWorkRates(next, { ...next, totalAmount: 2000 }, { lookup, now });
  assert.deepEqual(edited.exchangeRates.contract, next.reporting.exchangeRates.contract);
  assert.deepEqual(calls, ['2026-11-19']);
  const zero = await lockWorkRates(previous, { ...next, totalAmount: 0, reporting: {} }, { lookup, now });
  assert.equal(zero.contractDate, '2026-11-19');
  assert.equal(zero.exchangeRates.contract, undefined);
});

test('legacy baselines are explicit, a corrected date refixes them, and a missing quote fails without changing existing data', async () => {
  const next = { ...base, reporting: {} };
  const result = await lockWorkRates(base, next, { lookup: async (date) => snapshot(date), now });
  assert.equal(result.exchangeRates.contract.estimated, true);
  const previous = { ...base, reporting: result };
  const fixed = await lockWorkRates(previous, { ...previous, reporting: { ...result, contractDate: '2026-10-01' } }, {
    lookup: async (date) => snapshot(date), now
  });
  assert.equal(fixed.exchangeRates.contract.estimated, false);
  assert.equal(fixed.exchangeRates.contract.rateDate, '2026-10-01');
  await assert.rejects(lockWorkRates(previous, { ...previous, reporting: { ...result, contractDate: '2026-09-01' } }, {
    lookup: async () => { throw new Error('Unavailable'); }, now
  }), /Unavailable/);
  assert.equal(previous.reporting.exchangeRates.contract.rateDate, '2026-11-19');
});

test('financial dates reject invalid/future values and transaction totals cannot be overridden or forged', async () => {
  const entry = { id: '00000000-0000-4000-8000-000000000001', date: '2026-01-02', amount: 50.25, reference: 'Invoice 1', rate: { forged: true } };
  const result = validateFinancialReporting({ invoices: [entry], invoicedAmount: 900 }, {}, {});
  assert.equal(result.invoicedAmount, 50.25);
  assert.equal(result.invoices[0].rate, undefined);
  assert.throws(() => validateFinancialReporting({ invoices: [entry, entry] }, {}, {}), /unique/);
  assert.throws(() => validateFinancialReporting({ payments: [{ ...entry, date: '2099-01-01' }] }, {}, {}), /date/);
  assert.throws(() => validateFinancialReporting({ contractDate: '2026-02-30' }, {}, {}), /valid acceptance/);
  const req = { scope: { tenantType: 'company' }, body: { reporting: { invoicedAmount: 100 } } };
  assert.deepEqual(await workReporting(req, result, false), result);
  assert.deepEqual(await workReporting(req, {}, false), {});
});

test('each dated entry keeps its own quote; editing an amount retains its quote and changing its date fetches the new date', async () => {
  const entries = [1, 2].map((n) => ({ id: `00000000-0000-4000-8000-00000000000${n}`,
    date: `2026-01-0${n}`, amount: 100, reference: `Invoice ${n}` }));
  const calls = [];
  const lookup = async (date) => { calls.push(date); return snapshot(date); };
  const next = { ...base, reporting: { invoices: entries, invoicedAmount: 200 } };
  next.reporting = await lockWorkRates({}, next, { lookup, now });
  const after = await lockWorkRates(next, { ...next, reporting: { ...next.reporting,
    invoices: next.reporting.invoices.map((entry) => ({ ...entry, amount: 150 })) } }, { lookup, now });
  assert.deepEqual(calls, ['2026-11-19', '2026-01-01', '2026-01-02']);
  after.invoices[0] = { ...after.invoices[0], date: '2026-01-03' };
  await lockWorkRates(next, { ...next, reporting: after }, { lookup, now });
  assert.equal(calls.at(-1), '2026-01-03');
  await assert.rejects(lockWorkRates(next, { ...next, currency: 'EUR' }, { lookup, now }), /currency cannot change/);
});

test('dashboard mixes daily pipeline, acceptance rates, invoice rates and payment rates without residual debt on full payment', () => {
  const contract = rate('2026-01-01', '400', '320'); // USD = .8 EUR
  const invoice1 = rate('2026-02-01', '400', '360'); // USD = .9 EUR
  const invoice2 = rate('2026-03-01', '400', '400'); // USD = 1 EUR
  const payment = rate('2026-04-01', '400', '440'); // USD = 1.1 EUR
  const row = { ...base, reporting: { invoicedAmount: 600, paidAmount: 400,
    exchangeRates: { contract }, invoices: [
      { id: 'i1', date: '2026-02-01', amount: 300, rate: invoice1 },
      { id: 'i2', date: '2026-03-01', amount: 300, rate: invoice2 }
    ], payments: [{ id: 'p1', date: '2026-04-01', amount: 400, rate: payment }] } };
  const fx = { snapshot: snapshot('2026-11-19', '400', '480') }; // USD = 1.2 EUR
  const dashboard = buildDashboard([row, { ...base, status: 'offer' }], config, 'EUR', fx, '2026-11-19');
  assert.equal(dashboard.summary.activeValue.amount, 800);
  assert.equal(dashboard.summary.pipelineValue.amount, 1200);
  assert.equal(dashboard.summary.receivable.amount, 200);
  assert.equal(dashboard.summary.unbilled.amount, 320);
  assert.equal(dashboard.finance.find((entry) => entry.key === 'paid').value.amount, 440);
  const fullyPaid = { ...row, reporting: { ...row.reporting, paidAmount: 600,
    payments: [{ id: 'p1', date: '2026-04-01', amount: 600, rate: payment }] } };
  assert.equal(buildDashboard([fullyPaid], config, 'EUR', fx, '2026-11-19').summary.receivable.amount, 0);
  assert.equal(buildDashboard([row], config, 'HUF', fx, '2026-11-19').summary.activeValue.amount, 320000);
});

test('sub-work receipts use their own payment dates when the parent has no manually entered received total', async () => {
  const sub = { currency: 'USD', paidAmount: 50, paidAt: '2026-02-01', status: 'paid' };
  const fixed = await lockSubWorkRates({}, sub, { lookup: async (date) => snapshot(date, '400', '360'), now });
  assert.equal(fixed.payments.requestedDate, sub.paidAt);
  const fx = { snapshot: snapshot('2026-11-19', '400', '480') };
  const dashboard = buildDashboard([{ ...base, subPaid: 50, subPaymentEntries: [{ amount: 50, currency: 'USD', rate: fixed.payments }] }], config, 'EUR', fx, '2026-11-19');
  assert.equal(dashboard.finance.find((entry) => entry.key === 'paid').value.amount, 45);
});

test('historical SOAP chooses the preceding publication and conversion rounds only after summing historical parts', () => {
  const data = '<MNBExchangeRates><Day date="2026-01-02"><Rate unit="1" curr="EUR">400,00</Rate><Rate unit="1" curr="USD">360,00</Rate></Day><Day date="2026-01-05"><Rate unit="1" curr="EUR">410,00</Rate></Day></MNBExchangeRates>';
  const envelope = `<s:Envelope xmlns:s="urn:soap"><s:Body><GetExchangeRatesResponse><GetExchangeRatesResult>${data.replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</GetExchangeRatesResult></GetExchangeRatesResponse></s:Body></s:Envelope>`;
  assert.equal(parseHistoricalRates(envelope, '2026-01-04').date, '2026-01-02');
  const parts = [1, 2, 3].map(() => ({ currency: 'USD', amount: '.01', snapshot: snapshot('2026-01-02', '400', '360') }));
  assert.equal(convertTotals(parts, 'EUR', { snapshot: snapshot('2026-11-19') }).amount, .03);
});
