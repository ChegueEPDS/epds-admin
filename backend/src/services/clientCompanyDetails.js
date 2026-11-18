const { randomUUID } = require('node:crypto');

const clean = (value) => String(value ?? '').trim().replace(/\s+/g, ' ');
const normalizeTaxNumber = (value) => clean(value).toUpperCase().replace(/[^0-9A-Z]/g, '');
const invalid = (field, message) => Object.assign(new Error(message), { statusCode: 400, field });
const fields = ['taxNumber', 'name', 'country', 'postalCode', 'city', 'address', 'email', 'phone'];

function clientCompanyDetails(input = {}) {
  const details = Object.fromEntries(fields.map((field) => [field, clean(input?.[field])]));
  details.country = details.country.toUpperCase();
  details.email = details.email.toLowerCase();
  const taxKey = normalizeTaxNumber(details.taxNumber);
  if (details.country === 'HU' && !details.taxNumber) throw invalid('taxNumber', 'Tax number is required for Hungarian clients.');
  if (details.taxNumber && !taxKey) throw invalid('taxNumber', 'Enter a valid tax number.');
  if (!details.name) throw invalid('name', 'Company name is required.');
  // Missing numbers need distinct keys under the existing global unique index.
  // The normalizer cannot produce this namespace from a supplied tax number.
  return { ...details, normalizedTaxNumber: taxKey || 'no-tax:' + randomUUID() };
}

module.exports = { fields, clientCompanyDetails, normalizeTaxNumber };
