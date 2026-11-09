const { randomUUID } = require('node:crypto');

const statuses = {
  inquiry: 'Lead', offer: 'Lead', to_start: 'Active', in_progress: 'Active', on_hold: 'On hold',
  completed_billable: 'Completed', invoiced: 'Completed', paid: 'Completed', closed: 'Completed',
  cancelled: 'Cancelled', lost: 'Lost'
};
const trackerStatuses = ['inquiry', 'offer', 'to_start', 'in_progress', 'on_hold', 'completed_billable', 'cancelled', 'lost'];
const extendedStatuses = ['to_start', 'on_hold', 'lost'];
const fieldTypes = ['text', 'longText', 'number', 'date', 'boolean', 'select', 'multiSelect', 'user', 'url'];
const placements = {
  work: ['boardEditor', 'boardDetails', 'boardList', 'trackerEditor', 'trackerDetails', 'trackerList'],
  subWork: ['subWorkEditor', 'subWorkDetails'],
  client: ['clientEditor', 'clientDetails'],
  group: ['groupEditor', 'groupDetails'],
  task: ['taskEditor', 'taskDetails']
};
const serviceNames = [
  'CoPC Training', 'CoPC Certification / Renewal', 'Awareness Training', 'HAC', 'Inspection',
  'Product Certification', 'Consultancy', 'Engineering / Design', 'R&D', 'Other'
];
const initial = () => ({
  units: [], fields: [], services: serviceNames.map((name, i) => ({ id: `service-${i}`, name })),
  rates: [], smallLimit: 5000, mediumLimit: 20000, dueDays: 14, staleDays: 14,
  timezone: 'Europe/Budapest', reviewDay: 1, reminders: false,
  stageByStatus: Object.fromEntries(trackerStatuses.map((status) => [status, statuses[status]]))
});

function fail(message, statusCode = 400) {
  throw Object.assign(new Error(message), { statusCode });
}
function string(value, max = 250, required = false) {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail('Invalid text value');
  return value.trim();
}
function date(value) {
  if (!value) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('A date must use YYYY-MM-DD');
  const parsed = new Date(value);
  if (!Number.isFinite(+parsed) || parsed.toISOString().slice(0, 10) !== value) fail('Invalid calendar date');
  return value;
}
function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Invalid record');
  return value;
}
function numeric(value, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail('Number is outside the permitted range');
  return value;
}
function integer(value, min, max) {
  if (!Number.isInteger(value)) fail('Enter a whole number');
  return numeric(value, min, max);
}
function cents(value, negative = false) {
  const scaled = numeric(value, negative ? -100000000000 : 0, 100000000000) * 100;
  const result = Math.round(scaled);
  if (Math.abs(result - scaled) > 0.002) fail('Money must have at most two decimal places');
  return result;
}
function url(value) {
  const text = string(value, 2000);
  if (!text) return '';
  let parsed;
  try { parsed = new URL(text); } catch { fail('Enter a valid HTTPS link'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) fail('Enter a valid HTTPS link');
  return text;
}
function choice(value, values) {
  if (!values.includes(value)) fail('Invalid selection');
  return value;
}
function array(value, max) {
  if (!Array.isArray(value) || value.length > max) fail('Invalid list or list limit exceeded');
  return value;
}
function identifier(value) {
  const result = string(value, 80, true);
  if (!/^[a-zA-Z0-9_-]+$/.test(result) || ['__proto__', 'prototype', 'constructor'].includes(result)) fail('Invalid identifier');
  return result;
}
function optionalRef(value, items, old) {
  if (!value) return '';
  if (!items.some((item) => item.id === value && (!item.archived || item.id === old))) fail('Selection is unavailable in this tenant');
  return value;
}
function settings(input, previous) {
  const catalog = (items, max) => {
    const seen = new Set();
    const codes = new Set();
    const ids = new Set();
    return array(items, max).map((item) => {
      object(item);
      const name = string(item.name, 120, true);
      const id = item.id ? identifier(item.id) : randomUUID();
      if (ids.has(id) || (!item.archived && seen.has(name.toLowerCase()))) fail('Names and identifiers must be unique');
      const code = string(item.code, 32);
      if (!item.archived) {
        seen.add(name.toLowerCase());
        if (code && codes.has(code.toLowerCase())) fail('Active catalog codes must be unique');
        if (code) codes.add(code.toLowerCase());
      }
      ids.add(id);
      return { id, name, code, archived: item.archived === true };
    });
  };
  const preserve = (items, old) => {
    if (old.some((item) => !items.some((entry) => entry.id === item.id))) fail('Archive existing entries instead of removing them');
    return items;
  };
  const units = preserve(catalog(input.units, 200), previous.units);
  const services = preserve(catalog(input.services, 200), previous.services);
  const fields = preserve(array(input.fields, 100).map((field) => {
    object(field);
    const id = field.id ? identifier(field.id) : randomUUID();
    const target = choice(field.target, Object.keys(placements));
    const type = choice(field.type, fieldTypes);
    const old = previous.fields.find((entry) => entry.id === id);
    if (old && (old.target !== target || old.type !== type)) fail('Create a new field when changing its type or object');
    const locations = [...new Set(array(field.locations, 10).map((location) => choice(location, placements[target])))];
    if (!locations.length) fail('Select at least one location');
    if (!locations.some((location) => location.endsWith('Editor'))) {
      const editor = target === 'work'
        ? (locations.some((location) => location.startsWith('board')) ? 'boardEditor' : 'trackerEditor')
        : placements[target][0];
      locations.push(editor);
    }
    const options = ['select', 'multiSelect'].includes(type)
      ? preserve(catalog(field.options, 100), old?.options || []) : [];
    if (['select', 'multiSelect'].includes(type) && !options.some((option) => !option.archived) && !field.archived) fail('A list field needs an active option');
    return { id, target, type, locations, options, label: string(field.label, 120, true), archived: field.archived === true, required: field.required === true };
  }), previous.fields);
  if (new Set(fields.map((field) => field.id)).size !== fields.length) fail('Duplicate field identifier');
  const rates = array(input.rates, 500).map((rate) => {
    object(rate);
    return { currency: choice(string(rate.currency, 3, true), currencies), effective: date(rate.effective) || fail('Rate date is required'),
      unitsPerEur: numeric(rate.unitsPerEur, 0.000001, 10000000) };
  });
  if (rates.some((rate) => rate.currency === 'EUR' && rate.unitsPerEur !== 1)) fail('EUR must use a rate of one');
  if (new Set(rates.map((rate) => `${rate.currency}:${rate.effective}`)).size !== rates.length) fail('Duplicate rate');
  const timezone = string(input.timezone, 80, true);
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }); } catch { fail('Invalid time zone'); }
  const smallLimit = numeric(input.smallLimit, 0, 1e12);
  const stageByStatus = Object.fromEntries(trackerStatuses.map((status) => [status,
    choice(input.stageByStatus?.[status] ?? statuses[status], [...new Set(Object.values(statuses))])]));
  return { units, services, fields, rates, timezone, smallLimit, stageByStatus, mediumLimit: numeric(input.mediumLimit, smallLimit + 0.01, 1e12),
    dueDays: integer(input.dueDays, 1, 90), staleDays: integer(input.staleDays, 1, 90),
    reviewDay: integer(input.reviewDay, 0, 6), reminders: input.reminders === true };
}

const currencies = Intl.supportedValuesOf('currency');
function customValues(config, target, input, old, users, location) {
  const result = { ...old };
  for (const [id, value] of Object.entries(input == null ? {} : object(input))) {
    const field = config.fields.find((entry) => entry.id === id && entry.target === target && !entry.archived &&
      (!location || entry.locations.includes(location)));
    if (!field) fail('Custom field is unavailable');
    if (value === null || value === '' || (Array.isArray(value) && !value.length)) {
      if (field.required) fail(`${field.label} is required`);
      delete result[id];
      continue;
    }
    switch (field.type) {
      case 'text': result[id] = string(value, 250); break;
      case 'longText': result[id] = string(value, 5000); break;
      case 'number': result[id] = numeric(value, -1e15, 1e15); break;
      case 'date': result[id] = date(value); break;
      case 'boolean': result[id] = choice(value, [true, false]); break;
      case 'url': result[id] = url(value); break;
      case 'user': result[id] = optionalRef(value, users, old?.[id]); break;
      case 'select': result[id] = optionalRef(value, field.options, old?.[id]); break;
      case 'multiSelect': result[id] = [...new Set(array(value, 100).map((option) =>
        optionalRef(option, field.options, old?.[id]?.includes(option) ? option : '')))]; break;
    }
  }
  return result;
}

function today(timezone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  return ['year', 'month', 'day'].map((part) => parts.find((entry) => entry.type === part).value).join('-');
}
const daysBetween = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
const dayPart = (value) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10) || null;
function calendarDate(value, timezone) {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(+parsed)) return null;
  const iso = parsed.toISOString();
  return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : today(timezone, parsed);
}
const amount = (value) => value / 100;
function finances(work, record, asOf, stage = statuses[work.status]) {
  const invoices = (record.invoices || []).filter((invoice) => !invoice.voidedAt);
  const opening = record.opening;
  const invoiced = invoices.reduce((sum, invoice) => sum + invoice.cents, opening?.invoicedCents ?? 0);
  const openingPaid = (opening?.paidCents ?? 0) + activeCents(opening?.payments);
  const openingCredits = activeCents(opening?.adjustments);
  const paid = invoices.reduce((sum, invoice) => sum + activeCents(invoice.payments), openingPaid);
  const appliedCredits = invoices.reduce((sum, invoice) => sum + activeCents(invoice.adjustments), openingCredits);
  const due = invoices.some((invoice) => invoice.due && invoice.due < asOf && invoiceBalance(invoice) > 0)
    || Boolean(opening?.due && opening.due < asOf && opening.invoicedCents > openingPaid + openingCredits);
  const known = !opening || (opening.confirmed === true && opening.invoicedCents != null && opening.paidCents != null);
  const status = !known ? 'Needs reconciliation' : !invoiced ? 'Not invoiced'
    : paid >= invoiced ? 'Paid' : paid + appliedCredits >= invoiced ? 'Settled' : paid ? 'Partially paid' : 'Invoiced';
  const contract = record.contractUnknown ? null : work.totalAmount;
  const lastInvoiceDate = [opening?.issued, ...invoices.map((invoice) => invoice.issued)].filter(Boolean).sort().at(-1) || null;
  const nextPaymentDue = [opening?.due && invoiceBalance(opening) > 0 ? opening.due : null,
    ...invoices.filter((invoice) => invoiceBalance(invoice) > 0).map((invoice) => invoice.due)].filter(Boolean).sort()[0] || null;
  return { status, invoiced: amount(invoiced), paid: amount(paid), credits: amount(appliedCredits), lastInvoiceDate, nextPaymentDue,
    receivable: known ? amount(Math.max(0, invoiced - paid - appliedCredits)) : null,
    unbilled: known && contract != null && ['Active', 'Completed', 'On hold'].includes(stage)
      ? Math.max(0, Math.round(contract * 100) - invoiced) / 100 : null, overdue: due };
}
const activeCents = (entries = []) => entries.filter((item) => !item.voidedAt).reduce((sum, item) => sum + item.cents, 0);
function invoiceBalance(invoice) {
  return (invoice.cents ?? invoice.invoicedCents ?? 0) - (invoice.paidCents ?? 0) -
    activeCents(invoice.payments) - activeCents(invoice.adjustments);
}

function reviewCutoff(asOf, reviewDay) {
  const day = new Date(asOf);
  const elapsed = (day.getUTCDay() - reviewDay + 7) % 7;
  day.setUTCDate(day.getUTCDate() - elapsed);
  return day.toISOString().slice(0, 10);
}
function businessDays(from, to) {
  let count = 0;
  const day = new Date(from);
  const total = daysBetween(from, to);
  if (total <= 0) return 0;
  count += Math.floor(total / 7) * 5;
  for (let index = 0; index < total % 7; index++) {
    day.setUTCDate(day.getUTCDate() + 1);
    if (![0, 6].includes(day.getUTCDay())) count++;
  }
  return count;
}
function summarize(work, record, config, asOf) {
  const stage = config.stageByStatus?.[work.status] || statuses[work.status] || 'Unknown';
  const active = stage === 'Active';
  const open = ['Active', 'Lead', 'On hold'].includes(stage);
  const deadline = calendarDate(work.deadline, config.timezone);
  const action = (record.tasks || []).find((task) => task.id === record.nextTaskId && !task.done)
    || (record.tasks || []).find((task) => !task.done) || null;
  const reviewed = record.reviewedOn || null;
  const rate = work.currency === 'EUR' ? 1 : config.rates
    .filter((entry) => entry.currency === work.currency && entry.effective <= asOf)
    .sort((a, b) => b.effective.localeCompare(a.effective))[0]?.unitsPerEur;
  const value = record.contractUnknown ? null : work.totalAmount;
  const eur = value != null && rate ? value / rate : null;
  const payment = finances(work, record, asOf, stage);
  const updated = [work.updatedAt && today(config.timezone, new Date(work.updatedAt)), record.materialAt && today(config.timezone, new Date(record.materialAt))].filter(Boolean).sort().at(-1);
  const reviewDue = config.reminders && open && (!reviewed || reviewed < reviewCutoff(asOf, config.reviewDay));
  const overdue = active && Boolean(deadline && deadline < asOf);
  const actionOverdue = open && (record.tasks || []).some((task) => !task.done && task.due && task.due < asOf);
  const checks = [];
  if (!work.customer && !record.sourceClient) checks.push('No client');
  if (!work.responsibleUserId) checks.push('No owner');
  if (active && !record.backupId) checks.push('No backup');
  if (!record.serviceId) checks.push('No service type');
  if (active && (value == null || (!value && !record.amountConfirmed))) checks.push('No amount');
  if (active && !deadline) checks.push('No deadline');
  if (open && !action) checks.push('No next action');
  if (action && !action.ownerId) checks.push('No action owner');
  if (action && !action.due) checks.push('No action deadline');
  if (actionOverdue) checks.push('Action overdue');
  if (open && (!reviewed || daysBetween(reviewed, asOf) > config.staleDays)) checks.push('Review overdue');
  if (record.risk) checks.push('Risk flagged');
  if (open && updated && (!reviewed || updated > reviewed) && businessDays(updated, asOf) >= 2) checks.push('Change awaiting review');
  if (payment.overdue) checks.push('Payment overdue');
  if (payment.status === 'Needs reconciliation') checks.push('Payment needs reconciliation');
  if (value > 0 && !rate) checks.push('No approved FX rate');
  for (const field of config.fields) if (field.target === 'work' && field.required && !field.archived &&
    record.custom?.[field.id] == null) checks.push(`Missing: ${field.label}`);
  return { ...work, stage, value, eur, payment, deadline, action, actionOverdue, reviewed, overdue, reviewDue, fxRate: rate || null,
    daysSinceReview: reviewed ? daysBetween(reviewed, asOf) : null,
    deadlineState: !active ? '' : !deadline ? 'No deadline' : overdue ? 'Overdue' :
      daysBetween(asOf, deadline) <= config.dueDays ? 'Due soon' : 'On track',
    size: eur == null ? '' : eur < config.smallLimit ? 'Small' : eur < config.mediumLimit ? 'Medium' : 'Large',
    checks, unitId: record.unitId || '', serviceId: record.serviceId || '', groupId: record.groupId || '',
    priority: record.priority || '', backupId: record.backupId || '', po: record.po || '',
    custom: record.custom || {}, sourceClient: record.sourceClient || '', start: record.start || null };
}

module.exports = {
  statuses, trackerStatuses, extendedStatuses, placements, fieldTypes, currencies, initial, fail,
  string, date, numeric, cents, url, choice, array, object, identifier, optionalRef, settings, customValues,
  today, dayPart, invoiceBalance, finances, summarize
};
