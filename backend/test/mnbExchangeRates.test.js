const assert = require('node:assert/strict');
const { test } = require('node:test');
const { parseMnbRates, parseMnbDailyPage, convertTotals, isRefreshDue } = require('../src/services/mnbExchangeRates');

const rates = { EUR: { quote: '363.18', unit: 1 }, JPY: { quote: '205.30', unit: 100 } };
const snapshot = { date: '2026-11-09', rates };

test('MNB SOAP response keeps the published date, decimal values and quotation units', () => {
  const data = `<MNBCurrentExchangeRates><Day date="${snapshot.date}"><Rate unit="1" curr="EUR">363,18</Rate>
    <Rate unit="100" curr="JPY">205,30</Rate></Day></MNBCurrentExchangeRates>`;
  const result = data.replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const envelope = `<s:Envelope xmlns:s="urn:soap"><s:Body><GetCurrentExchangeRatesResponse><GetCurrentExchangeRatesResult>${result}</GetCurrentExchangeRatesResult></GetCurrentExchangeRatesResponse></s:Body></s:Envelope>`;
  assert.deepEqual(parseMnbRates(envelope), snapshot);
  assert.throws(() => parseMnbRates(envelope.replace('205,30', '0,00')), /Invalid MNB rate/);
});

test('official daily page fallback reads both tables and rejects incomplete quotes', () => {
  const headers = '<thead><tr><th>Pénznem</th><th>Devizanév</th><th>Egység</th><th>Forintban kifejezett érték</th></tr></thead>';
  const row = (currency, unit, amount) => `<tr><td class="fw-b">${currency}</td><td>name</td><td>${unit}</td><td>${amount}</td></tr>`;
  const primary = `<table><caption>Napi árfolyamok: 2026. november 9., hétfő</caption>${headers}
    <tbody>${row('EUR', 1, '363,18')}${row('CHF', 1, '396,71')}${row('USD', 1, '324,47')}</tbody></table>`;
  const secondary = `<table>${headers}<tbody>${row('JPY', 100, '205,30')}</tbody></table>`;
  const result = parseMnbDailyPage(primary + secondary);
  assert.equal(result.date, snapshot.date);
  assert.deepEqual(result.rates.JPY, rates.JPY);
  assert.throws(() => parseMnbDailyPage(primary), /Incomplete/);
});

test('active amounts use one snapshot, round once and mark missing quotes', () => {
  const inputs = [
    { currency: 'HUF', amount: '400000' }, { currency: 'EUR', amount: '1000' }, { currency: 'JPY', amount: '100' }
  ];
  assert.equal(convertTotals(inputs, 'HUF', { snapshot }).amount, 763385);
  assert.equal(convertTotals(inputs, 'EUR', { snapshot }).amount, 2101.95);
  const partial = convertTotals([...inputs, { currency: 'AED', amount: '150' }], 'HUF', { snapshot, refresh: { failed: true } });
  assert.equal(partial.amount, 763385);
  assert.deepEqual(partial.missingCurrencies, ['AED']);
  assert.equal(partial.refreshFailed, true);
  assert.equal(convertTotals(inputs.slice(1), 'HUF', {}).amount, null);
  assert.equal(convertTotals([{ currency: 'EUR', amount: '2' }], 'EUR', {}).amount, 2);
});

test('scheduler bootstraps missing data and uses Budapest time for subsequent refreshes', () => {
  const prior = { snapshot: { ...snapshot, date: '2026-11-06' } };
  assert.equal(isRefreshDue(prior, new Date('2026-11-09T09:59:00Z')), false);
  assert.equal(isRefreshDue(prior, new Date('2026-11-09T10:00:00Z')), true);
  assert.equal(isRefreshDue(prior, new Date('2026-11-07T12:00:00Z')), false);
  assert.equal(isRefreshDue({}, new Date('2026-11-07T12:00:00Z')), true);
  assert.equal(isRefreshDue({ ...prior, refresh: { at: '2026-11-09T10:01:00Z', failed: true } }, new Date('2026-11-09T10:10:00Z')), false);
});
