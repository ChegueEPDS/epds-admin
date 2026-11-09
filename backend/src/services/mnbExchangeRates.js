const axios = require('axios');
const Decimal = require('decimal.js').clone({ precision: 40 });
const { XMLParser, XMLValidator } = require('fast-xml-parser');
const mongoose = require('mongoose');
const { databaseEngine, query } = require('../postgres');
const { withJobLease } = require('./scheduledJobLeaseService');

const url = 'https://www.mnb.hu/arfolyamok.asmx';
const dailyPage = 'https://www.mnb.hu/arfolyamok';
const namespace = 'http://www.mnb.hu/webservices/';
const action = namespace + 'MNBArfolyamServiceSoap/GetCurrentExchangeRates';
const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false });
const collection = () => mongoose.connection.db.collection('mnb_exchange_rate_snapshots');
const format = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Budapest', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', hourCycle: 'h23'
});
const tickMs = 15 * 60 * 1000;

function parseXml(value) {
  if (typeof value !== 'string' || /<!DOCTYPE|<!ENTITY/i.test(value) || XMLValidator.validate(value) !== true) {
    throw new Error('Invalid MNB XML');
  }
  return parser.parse(value);
}

function parseMnbRates(xml) {
  const result = parseXml(xml).Envelope?.Body?.GetCurrentExchangeRatesResponse?.GetCurrentExchangeRatesResult;
  const day = parseXml(result).MNBCurrentExchangeRates?.Day;
  return normalizeRates(day?.['@_date'], [].concat(day?.Rate || []).map((row) => ({
    currency: row?.['@_curr'], unit: row?.['@_unit'], quote: row?.['#text']
  })));
}

function normalizeRates(date, rows) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
    throw new Error('Invalid MNB rate date');
  }
  const rates = {};
  for (const row of rows) {
    const { currency } = row;
    const unit = Number(row.unit);
    const quote = String(row.quote || '').replace(',', '.');
    if (!/^[A-Z]{3}$/.test(currency) || currency === 'HUF' || Object.hasOwn(rates, currency) ||
        !Number.isSafeInteger(unit) || unit < 1 || !/^\d{1,14}(\.\d{1,10})?$/.test(quote) || !new Decimal(quote).gt(0)) {
      throw new Error('Invalid MNB rate');
    }
    rates[currency] = { quote, unit };
  }
  if (!Object.keys(rates).length) throw new Error('Empty MNB rate table');
  return { date, rates };
}

function parseMnbDailyPage(html) {
  const xmlText = (value) => typeof value === 'string' ? value : value?.['#text'];
  const tables = Array.from(html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi), ([table]) => table);
  const index = tables.findIndex((table) => /<caption\b[^>]*>\s*Napi árfolyamok:/i.test(table));
  if (index < 0) throw new Error('MNB daily rate table not found');
  const first = parseXml(tables[index]).table;
  const caption = /^Napi árfolyamok:\s*(\d{4})\.\s+(\S+)\s+(\d{1,2})\./.exec(xmlText(first?.caption) || '');
  const months = ['január', 'február', 'március', 'április', 'május', 'június', 'július', 'augusztus', 'szeptember', 'október', 'november', 'december'];
  const month = caption ? months.indexOf(caption[2]) + 1 : 0;
  if (!month) throw new Error('Invalid MNB daily rate caption');
  const date = `${caption[1]}-${String(month).padStart(2, '0')}-${caption[3].padStart(2, '0')}`;
  const expectedHeaders = ['Pénznem', 'Devizanév', 'Egység', 'Forintban kifejezett érték'];
  const rows = [];
  for (const [offset, table] of tables.slice(index, index + 2).entries()) {
    const parsed = offset === 0 ? first : parseXml(table).table;
    const headers = [].concat(parsed?.thead?.tr?.th || []).map(xmlText);
    if (headers.length !== expectedHeaders.length || !expectedHeaders.every((header, i) => headers[i] === header)) break;
    for (const row of [].concat(parsed.tbody?.tr || [])) {
      if (!Array.isArray(row?.td) || row.td.length !== 4) throw new Error('Invalid MNB daily rate row');
      const [currency, , unit, quote] = row.td.map(xmlText);
      rows.push({ currency, unit, quote });
    }
  }
  if (rows.length <= 3) throw new Error('Incomplete MNB daily rate table');
  return normalizeRates(date, rows);
}

async function fetchMnbRates() {
  const body = `<?xml version="1.0" encoding="utf-8"?>
    <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
      <soap:Body><GetCurrentExchangeRates xmlns="${namespace}"/></soap:Body>
    </soap:Envelope>`;
  const options = { timeout: 10000, maxContentLength: 512 * 1024, maxRedirects: 0, responseType: 'text' };
  try {
    const response = await axios.post(url, body, { ...options,
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `"${action}"` } });
    return { ...parseMnbRates(response.data), source: 'soap' };
  } catch {
    const response = await axios.get(dailyPage, options);
    return { ...parseMnbDailyPage(response.data), source: 'daily-page' };
  }
}

async function latestRates() {
  if (databaseEngine() === 'postgresql') {
    const { rows: [row] } = await query(`SELECT
      (SELECT data FROM mnb_exchange_rate_snapshots WHERE id <> 'refresh' ORDER BY id DESC LIMIT 1) AS snapshot,
      (SELECT data FROM mnb_exchange_rate_snapshots WHERE id = 'refresh') AS refresh`);
    return row;
  }
  const [latest, metadata] = await Promise.all([
    collection().findOne({ _id: { $ne: 'refresh' } }, { sort: { _id: -1 } }),
    collection().findOne({ _id: 'refresh' })
  ]);
  return { snapshot: latest?.data || null, refresh: metadata?.data || null };
}

async function storeRates(snapshot, refresh) {
  if (databaseEngine() === 'postgresql') {
    if (snapshot) {
      await query(`INSERT INTO mnb_exchange_rate_snapshots(id,data) VALUES ($1,$2),('refresh',$3)
        ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data`, [snapshot.date, snapshot, refresh]);
    } else {
      await query(`INSERT INTO mnb_exchange_rate_snapshots(id,data) VALUES ('refresh',$1)
        ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data`, [refresh]);
    }
    return;
  }
  if (snapshot) await collection().updateOne({ _id: snapshot.date }, { $set: { data: snapshot } }, { upsert: true });
  await collection().updateOne({ _id: 'refresh' }, { $set: { data: refresh } }, { upsert: true });
}

function budapestTime(now) {
  const parts = Object.fromEntries(format.formatToParts(now).map(({ type, value }) => [type, value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), weekday: parts.weekday };
}

function isRefreshDue({ snapshot, refresh }, now) {
  const local = budapestTime(now);
  if (snapshot?.date === local.date && !refresh?.failed) return false;
  if (snapshot && (['Sat', 'Sun'].includes(local.weekday) || local.hour < 11)) return false;
  return !refresh || now.getTime() - Date.parse(refresh.at) >= tickMs;
}

async function refreshRates() {
  if (!isRefreshDue(await latestRates(), new Date())) return;
  await withJobLease('mnb-exchange-rates', 60000, async () => {
    const now = new Date();
    const previous = await latestRates();
    if (!isRefreshDue(previous, now)) return;
    let snapshot;
    try {
      snapshot = await fetchMnbRates();
      if (snapshot.date > budapestTime(now).date || snapshot.date < (previous.snapshot?.date || '')) {
        throw new Error('Unexpected MNB rate date');
      }
    } catch (error) {
      await storeRates(null, { at: now.toISOString(), failed: true });
      console.error('[mnb-rates] refresh failed:', error.message);
      return;
    }
    await storeRates(snapshot, { at: now.toISOString(), failed: false });
  });
}

let timer;
function startMnbExchangeRates() {
  if (timer) return;
  const run = () => void refreshRates().catch((error) => console.error('[mnb-rates]', error.message));
  run();
  timer = setInterval(run, tickMs);
  timer.unref?.();
}

function availableCurrencies(snapshot) {
  return snapshot ? ['HUF', ...Object.keys(snapshot.rates).sort()] : ['HUF', 'EUR', 'USD'];
}

function convertTotals(rows, currency, { snapshot, refresh }) {
  const rate = (code) => {
    if (code === 'HUF') return new Decimal(1);
    const entry = snapshot?.rates[code];
    return entry ? new Decimal(entry.quote).div(entry.unit) : null;
  };
  const target = rate(currency);
  const missing = new Set();
  let amount = new Decimal(0);
  let included = false;
  let converted = false;
  for (const row of rows) {
    const value = new Decimal(row.amount);
    if (value.isZero()) continue;
    if (row.currency === currency) {
      amount = amount.plus(value);
    } else {
      const source = rate(row.currency);
      if (!source || !target) {
        if (!source) missing.add(row.currency);
        if (!target) missing.add(currency);
        continue;
      }
      amount = amount.plus(value.times(source).div(target));
      converted = true;
    }
    included = true;
  }
  const digits = currency === 'HUF' ? 0 : new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
  return {
    amount: included || !missing.size ? amount.toDecimalPlaces(digits, Decimal.ROUND_HALF_UP).toNumber() : null,
    currency, rateDate: converted || missing.size ? snapshot?.date || null : null,
    missingCurrencies: [...missing].sort(), refreshFailed: (converted || missing.size > 0) && refresh?.failed === true
  };
}

module.exports = { parseMnbRates, parseMnbDailyPage, fetchMnbRates, latestRates, startMnbExchangeRates, convertTotals, availableCurrencies, isRefreshDue };
