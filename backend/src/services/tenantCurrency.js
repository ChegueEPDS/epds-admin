const Tenant = require('../models/tenant');
const { databaseEngine, query } = require('../postgres');
const { latestRates, convertTotals } = require('./mnbExchangeRates');

const DEFAULT_CURRENCY = 'HUF';
const defaultCurrencies = ['HUF', 'EUR', 'USD', 'AED'];

async function getDefaultCurrency(tenantId) {
  if (databaseEngine() === 'postgresql') {
    const { rows } = await query('SELECT default_currency FROM tenants WHERE id=$1', [tenantId]);
    return rows[0]?.default_currency || DEFAULT_CURRENCY;
  }
  return (await Tenant.findById(tenantId).select('defaultCurrency').lean())?.defaultCurrency || DEFAULT_CURRENCY;
}

function currencyOptions() {
  return [...defaultCurrencies];
}

function validateDefaultCurrency(value, current) {
  if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) return null;
  return value === current || defaultCurrencies.includes(value) ? value : null;
}

async function preference(tenantId) {
  const defaultCurrency = await getDefaultCurrency(tenantId);
  return { defaultCurrency, currencies: currencyOptions() };
}

async function setPreference(tenantId, value) {
  const current = await getDefaultCurrency(tenantId);
  const currency = validateDefaultCurrency(value, current);
  if (!currency) throw Object.assign(new Error('Select an available default currency.'), { statusCode: 400 });
  if (currency !== current) {
    if (databaseEngine() === 'postgresql') {
      await query('UPDATE tenants SET default_currency=$2, updated_at=now() WHERE id=$1', [tenantId, currency]);
    } else {
      await Tenant.updateOne({ _id: tenantId }, { $set: { defaultCurrency: currency } });
    }
  }
  return { defaultCurrency: currency, currencies: currencyOptions() };
}

async function summarizeActiveValue(tenantId, amounts) {
  const currency = await getDefaultCurrency(tenantId);
  const rates = amounts.some((row) => row.currency !== currency && Number(row.amount) !== 0)
    ? await latestRates() : {};
  return convertTotals(amounts, currency, rates);
}

module.exports = { DEFAULT_CURRENCY, getDefaultCurrency, currencyOptions, validateDefaultCurrency, preference, setPreference, summarizeActiveValue };
