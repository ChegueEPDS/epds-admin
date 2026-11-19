const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');

test('PostgreSQL work saves and sub-work receipts persist fixed quotes and invalidate the dashboard', {
  skip: !process.env.WORK_FX_TEST_DATABASE_URL
}, async (t) => {
  process.env.DATABASE_ENGINE = 'postgresql';
  process.env.DATABASE_URL = process.env.WORK_FX_TEST_DATABASE_URL;
  const { query, closePostgres } = require('../src/postgres');
  const { connectDb } = require('../src/db');
  const tenants = require('../src/repositories/postgres/tenantRepository');
  const works = require('../src/repositories/postgres/workBoardRepository');
  const fields = require('../src/services/workFields');
  const { dashboard } = require('../src/services/workDashboard');
  const { withAedRate, latestRates, ratesOn } = require('../src/services/mnbExchangeRates');
  const tenantIds = [];
  const originals = new Map();
  t.after(async () => {
    try {
      await query('DELETE FROM sub_work_items WHERE tenant_id=ANY($1::text[])', [tenantIds]);
      await query('DELETE FROM work_items WHERE tenant_id=ANY($1::text[])', [tenantIds]);
      await query('DELETE FROM tenants WHERE id=ANY($1::text[])', [tenantIds]);
      for (const [id, original] of originals) {
        if (original) await query('UPDATE mnb_exchange_rate_snapshots SET data=$2 WHERE id=$1', [id, original]);
        else await query('DELETE FROM mnb_exchange_rate_snapshots WHERE id=$1', [id]);
      }
    } finally { await closePostgres(); }
  });
  await query(await fs.readFile(path.join(__dirname, '../postgres/001_initial_schema.sql'), 'utf8'));
  await connectDb();
  const originalLatestDate = (await latestRates()).snapshot?.date;
  for (const [date, usd] of [['2026-01-02', '320'], ['2026-02-02', '360'], ['2026-03-02', '440']]) {
    const id = 'history:' + date;
    originals.set(id, (await query('SELECT data FROM mnb_exchange_rate_snapshots WHERE id=$1', [id])).rows[0]?.data);
    const snapshot = { date, rates: { EUR: { quote: '400', unit: 1 }, USD: { quote: usd, unit: 1 } } };
    await query('INSERT INTO mnb_exchange_rate_snapshots(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data', [id, snapshot]);
  }
  const tenant = await tenants.save({ name: 'fx-qa-' + Date.now(), type: 'company', defaultCurrency: 'EUR', features: { workBoard: { enabled: true, edit: true } } });
  tenantIds.push(tenant.id);
  const payload = { name: 'Fixed work', status: 'in_progress', currency: 'USD', totalAmount: 1000,
    reporting: { contractDate: '2026-01-02', invoices: [{ id: '00000000-0000-4000-8000-000000000001', date: '2026-02-02', amount: 400, reference: 'QA-1' }] } };
  const req = { scope: { tenantId: tenant.id, tenantType: 'company' }, body: payload };
  const created = await fields.saveValues(req, payload.status, {}, (customFields, selections) =>
    works.createWork(tenant.id, null, { ...payload, ...selections, customFields }));
  assert.equal(created.reporting.invoicedAmount, undefined);
  assert.equal(created.reporting.exchangeRates.contract.rateDate, '2026-01-02');
  const sub = await works.createSubWork(tenant.id, created.id, null, { name: 'Receipt', status: 'invoiced', currency: 'USD', amount: 400, invoiceDate: '2026-02-02', paidAmount: 100, paidAt: '2026-03-02' });
  assert.equal(sub.exchangeRates.payments.rateDate, '2026-03-02');
  assert.equal(sub.exchangeRates.invoices.rateDate, '2026-02-02');
  const config = await fields.settings(tenant.id);
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Budapest' }).format(new Date());
  const fx = { snapshot: withAedRate({ date, rates: { EUR: { quote: '400', unit: 1 }, USD: { quote: '480', unit: 1 } } }) };
  const result = await dashboard(tenant.id, config, 'EUR', fx, date);
  assert.equal(result.summary.activeValue.amount, 800);
  assert.equal(result.summary.receivable.amount, 270);
  assert.equal(result.summary.unbilled.amount, 480);
  assert.equal(result.finance.find((row) => row.key === 'paid').value.amount, 110);
  const prior = await works.findWork(tenant.id, created.id);
  const updateReq = { ...req, body: { name: 'Unrelated edit' } };
  await fields.saveValues(updateReq, prior.status, prior, (customFields, selections) =>
    works.updateWork(tenant.id, prior.id, null, { ...updateReq.body, ...selections, customFields }, prior.fieldRevision));
  assert.deepEqual((await works.findWork(tenant.id, prior.id)).reporting.exchangeRates.contract, prior.reporting.exchangeRates.contract);
  const savedSub = await works.updateSubWork(tenant.id, sub.id, null, { paidAmount: 200 });
  assert.deepEqual(savedSub.exchangeRates.payments, sub.exchangeRates.payments);
  assert.ok(Number((await query('SELECT revision FROM work_dashboard_snapshots WHERE tenant_id=$1', [tenant.id])).rows[0].revision) >= 4);
  assert.equal((await latestRates()).snapshot?.date, originalLatestDate);
  // An early-morning quote for today's request must not mask today's later
  // publication. Existing work snapshots still keep the quote already fixed.
  const cacheKey = 'history:' + date;
  originals.set(cacheKey, (await query('SELECT data FROM mnb_exchange_rate_snapshots WHERE id=$1', [cacheKey])).rows[0]?.data);
  const yesterday = new Date(date); yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const early = { ...fx.snapshot, date: yesterday.toISOString().slice(0, 10) };
  await query('INSERT INTO mnb_exchange_rate_snapshots(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data', [cacheKey, early]);
  const data = `<MNBExchangeRates><Day date="${date}"><Rate unit="1" curr="EUR">400,00</Rate><Rate unit="1" curr="USD">480,00</Rate></Day></MNBExchangeRates>`;
  const envelope = `<s:Envelope xmlns:s="urn:soap"><s:Body><GetExchangeRatesResponse><GetExchangeRatesResult>${data.replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</GetExchangeRatesResult></GetExchangeRatesResponse></s:Body></s:Envelope>`;
  const requestMock = t.mock.method(require('axios'), 'post', async () => ({ data: envelope }));
  assert.equal((await ratesOn(date)).date, date);
  assert.equal((await ratesOn(date)).date, date);
  assert.equal(requestMock.mock.callCount(), 1);
  assert.equal((await latestRates()).snapshot?.date, originalLatestDate);
});
