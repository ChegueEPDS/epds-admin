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
// The CBUAE midpoint is 3.6725 AED per USD, exactly 1469 / 400.
// https://centralbank.ae/en/forex-eibor/exchange-rates/
function withAedRate(snapshot) {
  const usd = snapshot?.rates?.USD;
  if (!usd || snapshot.rates.AED) return snapshot;
  return { ...snapshot, rates: { ...snapshot.rates, AED: {
    quote: new Decimal(usd.quote).times(400).toFixed(),
    unit: usd.unit * 1469,
    source: 'cbuae-usd-peg'
  } } };
}

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

function parseHistoricalRates(xml, requestedDate) {
  const result = parseXml(xml).Envelope?.Body?.GetExchangeRatesResponse?.GetExchangeRatesResult;
  const days = [].concat(parseXml(result).MNBExchangeRates?.Day || []);
  const day = days.filter((item) => item['@_date'] <= requestedDate)
    .sort((a, b) => b['@_date'].localeCompare(a['@_date']))[0];
  if (!day) throw new Error('MNB historical rate unavailable');
  return normalizeRates(day['@_date'], [].concat(day.Rate || []).map((row) => ({
    currency: row['@_curr'], unit: row['@_unit'], quote: row['#text']
  })));
}

const historicalRequests = new Map();
async function ratesOn(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date || date > budapestTime(new Date()).date) {
    throw Object.assign(new Error('Select a valid exchange-rate date that is not in the future.'), { statusCode: 400 });
  }
  if (historicalRequests.has(date)) return historicalRequests.get(date);
  const pending = (async () => {
    const isToday = date === budapestTime(new Date()).date;
    if (isToday) {
      const current = (await latestRates()).snapshot;
      if (current?.date === date && current.rates.EUR && current.rates.USD) return current;
    }
    // Historical lookups have their own key. They must never become the latest daily quote.
    const key = `history:${date}`;
    const cached = databaseEngine() === 'postgresql'
      ? (await query('SELECT data FROM mnb_exchange_rate_snapshots WHERE id=$1', [key])).rows[0]?.data
      : (await collection().findOne({ _id: key }))?.data;
    if (cached && (!isToday || cached.date === date)) return withAedRate(cached);
    const start = new Date(date); start.setUTCDate(start.getUTCDate() - 14);
    const body = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><GetExchangeRates xmlns="${namespace}"><startDate>${start.toISOString().slice(0, 10)}</startDate><endDate>${date}</endDate><currencyNames>EUR,USD,CHF,GBP,AUD,BRL,CAD,CNY,CZK,DKK,HKD,IDR,ILS,INR,ISK,JPY,KRW,MXN,MYR,NOK,NZD,PHP,PLN,RON,RSD,RUB,SEK,SGD,THB,TRY,UAH,ZAR</currencyNames></GetExchangeRates></soap:Body></soap:Envelope>`;
    let snapshot;
    try {
      const options = { timeout: 10000, maxContentLength: 512 * 1024,
        maxRedirects: 0, responseType: 'text', headers: { 'Content-Type': 'text/xml; charset=utf-8',
          SOAPAction: `${namespace}MNBArfolyamServiceSoap/GetExchangeRates` } };
      // MNB's published WSDL advertises HTTP; its HTTPS SOAP route can return
      // 404 although the HTTPS information page is available. Only public dates
      // and currency codes are sent to the official fallback endpoint.
      let response;
      try { response = await axios.post(url, body, options); }
      catch { response = await axios.post('http://www.mnb.hu/arfolyamok.asmx', body, options); }
      snapshot = parseHistoricalRates(response.data, date);
      if (!snapshot.rates.EUR || !snapshot.rates.USD) throw new Error('Incomplete historical rates');
    } catch {
      throw Object.assign(new Error('The MNB exchange rate for this date is unavailable. No rate was fixed. Please try again.'), { statusCode: 503 });
    }
    if (databaseEngine() === 'postgresql') {
      await query(`INSERT INTO mnb_exchange_rate_snapshots(id,data) VALUES($1,$2)
        ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data
        WHERE mnb_exchange_rate_snapshots.data->>'date' < EXCLUDED.data->>'date'`, [key, snapshot]);
      return withAedRate((await query('SELECT data FROM mnb_exchange_rate_snapshots WHERE id=$1', [key])).rows[0].data);
    }
    await collection().updateOne({ _id: key }, { $setOnInsert: { data: snapshot } }, { upsert: true });
    await collection().updateOne({ _id: key, 'data.date': { $lt: snapshot.date } }, { $set: { data: snapshot } });
    return withAedRate((await collection().findOne({ _id: key })).data);
  })().finally(() => historicalRequests.delete(date));
  historicalRequests.set(date, pending);
  return pending;
}

async function latestRates() {
  if (databaseEngine() === 'postgresql') {
    const { rows: [row] } = await query(`SELECT
      (SELECT data FROM mnb_exchange_rate_snapshots WHERE id ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' ORDER BY id DESC LIMIT 1) AS snapshot,
      (SELECT data FROM mnb_exchange_rate_snapshots WHERE id = 'refresh') AS refresh`);
    return { ...row, snapshot: withAedRate(row.snapshot) };
  }
  const [latest, metadata] = await Promise.all([
    collection().findOne({ _id: { $regex: /^\d{4}-\d{2}-\d{2}$/ } }, { sort: { _id: -1 } }),
    collection().findOne({ _id: 'refresh' })
  ]);
  return { snapshot: withAedRate(latest?.data || null), refresh: metadata?.data || null };
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

function convertTotals(rows, currency, { snapshot, refresh }) {
  const rate = (code, sourceSnapshot) => {
    if (code === 'HUF') return new Decimal(1);
    const entry = sourceSnapshot?.rates[code];
    return entry ? new Decimal(entry.quote).div(entry.unit) : null;
  };
  const missing = new Set();
  let amount = new Decimal(0);
  let included = false;
  let converted = false;
  let usesCurrentRate = false;
  const dates = new Set();
  for (const row of rows) {
    const value = new Decimal(row.amount);
    if (value.isZero()) continue;
    if (row.currency === currency) {
      amount = amount.plus(value);
    } else {
      const sourceSnapshot = row.snapshot || snapshot;
      if (!row.snapshot) usesCurrentRate = true;
      if (sourceSnapshot?.date) dates.add(sourceSnapshot.date);
      const target = rate(currency, sourceSnapshot);
      const source = rate(row.currency, sourceSnapshot);
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
    currency, rateDate: (converted || missing.size) && dates.size === 1 ? [...dates][0] : null,
    missingCurrencies: [...missing].sort(), refreshFailed: usesCurrentRate && refresh?.failed === true
  };
}

module.exports = { parseMnbRates, parseMnbDailyPage, parseHistoricalRates, ratesOn, fetchMnbRates, latestRates, startMnbExchangeRates, convertTotals, withAedRate, isRefreshDue };
