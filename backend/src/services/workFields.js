const { randomUUID } = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { databaseEngine, query } = require('../postgres');
const Tenant = require('../models/tenant');
const storage = require('./fileStorageService');
const { workReporting } = require('./workDashboard');

const cards = { basic: 0, description: 0, offer: 1, execution: 2, completion: 3, invoice: 4, documents: 0 };
const ranks = { inquiry: 0, offer: 1, to_start: 2, in_progress: 2, on_hold: 2,
  completed_billable: 3, invoiced: 4, paid: 5, closed: 6, cancelled: 6, lost: 1 };
const types = ['text', 'longText', 'integer', 'decimal', 'date', 'amount', 'list', 'boolean', 'file'];
const uid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const empty = { version: 0, fields: [], entities: [], serviceTypes: [], projectSizeGrouping: false };
const workCatalogs = [
  { key: 'entities', reference: 'entityId', label: 'Entity' },
  { key: 'serviceTypes', reference: 'serviceTypeId', label: 'Service type' }
];
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const storageKey = (tenantId, id) => `work-fields/${tenantId}/${id}`;
const relevant = (field, status) => Object.hasOwn(cards, field.card) && Object.hasOwn(ranks, status) && ranks[status] >= cards[field.card];
const missing = (value) => value == null || value === '' || (Array.isArray(value) && !value.length);
const text = (value, max) => typeof value === 'string' && value.trim().length <= max ? value.trim() : null;

async function settings(tenantId) {
  if (databaseEngine() === 'postgresql') {
    const { rows } = await query('SELECT work_field_settings FROM tenants WHERE id=$1', [tenantId]);
    return { ...empty, ...rows[0]?.work_field_settings };
  }
  const tenant = await Tenant.findById(tenantId).select('workFieldSettings').lean();
  return { ...empty, ...tenant?.workFieldSettings };
}

function updateCatalog(current, input) {
  const catalog = workCatalogs.find((entry) => entry.key === input.catalog);
  if (!catalog || !object(input.entry)) throw fail('Enter a catalog and name.');
  const options = current[catalog.key] || [];
  const draft = input.entry;
  const previous = options.find((item) => item.id === draft.id);
  if (draft.id && !previous) throw fail('Catalog entry not found.', 404);
  if (!previous && options.length >= 200) throw fail('A catalog can have up to 200 entries.');
  const label = text(draft.label, 100);
  if (!label) throw fail('Enter a name of up to 100 characters.');
  const archived = draft.archived === true;
  if (!archived && options.some((item) => item.id !== previous?.id && !item.archived &&
      item.label.toLowerCase() === label.toLowerCase())) throw fail('An active entry with this name already exists.');
  const entry = { id: previous?.id || randomUUID(), label, archived };
  return { ...current, version: current.version + 1, [catalog.key]: previous
    ? options.map((item) => item.id === entry.id ? entry : item)
    : [...options, entry] };
}

function buildSettings(current, input) {
  if (!object(input) || input.version !== current.version) throw fail('Settings changed. Reload and try again.', 409);
  if (typeof input.projectSizeGrouping === 'boolean') {
    return { ...current, version: current.version + 1, projectSizeGrouping: input.projectSizeGrouping };
  }
  if (Object.hasOwn(input, 'catalog')) return updateCatalog(current, input);
  if (!object(input.field)) throw fail('Field details are required.');
  const draft = input.field;
  const previous = current.fields.find((field) => field.id === draft.id);
  if (draft.id && !previous) throw fail('Field not found.', 404);
  if (!previous && current.fields.length >= 50) throw fail('A tenant can have up to 50 custom fields.');
  const label = text(draft.label, 100);
  if (!label || !types.includes(draft.type) || typeof draft.card !== 'string' || !Object.hasOwn(cards, draft.card)) {
    throw fail('Enter a field name, type and card.');
  }
  const multiple = draft.type === 'list' && draft.multiple === true;
  if (previous && (previous.type !== draft.type || previous.multiple !== multiple)) {
    throw fail('The field type and selection mode are fixed after creation.');
  }
  if (current.fields.some((field) => field.id !== previous?.id && !field.archived && draft.archived !== true &&
      field.label.toLowerCase() === label.toLowerCase())) throw fail('A field with this name already exists.');
  const options = [];
  if (draft.type === 'list') {
    if (!Array.isArray(draft.options) || draft.options.length > 100) throw fail('A list can have up to 100 options.');
    const seen = new Set();
    for (const option of draft.options) {
      const name = text(option?.label, 100);
      if (!name) throw fail('Each list option needs a name.');
      const existing = previous?.options.find((item) => item.id === option.id);
      if (option.id && !existing) throw fail('Unknown list option.');
      const id = existing?.id || randomUUID();
      if (seen.has(id)) throw fail('A list option appears more than once.');
      seen.add(id);
      options.push({ id, label: name, archived: option.archived === true });
    }
    for (const option of previous?.options || []) {
      if (!seen.has(option.id)) options.push({ ...option, archived: true });
    }
    const active = options.filter((option) => !option.archived);
    if (options.length > 100 || (!active.length && draft.archived !== true)) throw fail('Keep at least one active option and up to 100 total.');
    if (new Set(active.map((option) => option.label.toLowerCase())).size !== active.length) throw fail('List option names must be unique.');
  }
  const field = { id: previous?.id || randomUUID(), label, type: draft.type, card: draft.card, multiple, options,
    required: draft.required === true, showInList: draft.showInList === true, archived: draft.archived === true };
  if (field.type === 'file' && !field.archived &&
      current.fields.filter((item) => item.id !== field.id && item.type === 'file' && !item.archived).length >= 8) {
    throw fail('A tenant can have up to 8 active file fields.');
  }
  return { ...current, version: current.version + 1, fields: previous
    ? current.fields.map((item) => item.id === field.id ? field : item)
    : [...current.fields, field] };
}

function catalogSelections(config, work, input) {
  return Object.fromEntries(workCatalogs.map(({ key, reference, label }) => {
    const previous = work[reference] || null;
    if (!Object.hasOwn(input, reference)) return [reference, previous];
    const selected = input[reference];
    if (selected === null || selected === '') return [reference, null];
    if (!(config[key] || []).some((entry) => entry.id === selected && (!entry.archived || entry.id === previous))) {
      throw fail(`${label}: select an available option for this tenant.`);
    }
    return [reference, selected];
  }));
}

async function saveSettings(tenantId, input) {
  const current = await settings(tenantId);
  const next = buildSettings(current, input);
  let matched;
  if (databaseEngine() === 'postgresql') {
    matched = (await query("UPDATE tenants SET work_field_settings=$2::jsonb WHERE id=$1 AND (work_field_settings->>'version')::int=$3",
      [tenantId, JSON.stringify(next), current.version])).rowCount;
  } else {
    const version = current.version ? { 'workFieldSettings.version': current.version }
      : { 'workFieldSettings.version': { $in: [null, 0] } };
    matched = (await Tenant.updateOne({ _id: tenantId, ...version }, { $set: { workFieldSettings: next } })).matchedCount;
  }
  if (!matched) throw fail('Settings changed. Reload and try again.', 409);
  return next;
}

function validDate(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{3}-\d\d-\d\d$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function normalize(field, value, prior) {
  const invalid = () => { throw fail(`${field.label}: invalid value.`); };
  if (value === null) return undefined;
  switch (field.type) {
    case 'text':
    case 'longText': {
      const cleaned = text(value, field.type === 'text' ? 300 : 6000);
      if (cleaned === null) return invalid();
      return cleaned || undefined;
    }
    case 'integer':
      if (Number.isSafeInteger(value)) return value;
      break;
    case 'decimal':
      if (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER) return value;
      break;
    case 'date':
      if (validDate(value)) return value;
      break;
    case 'amount':
      if (object(value) && typeof value.amount === 'number' && Number.isFinite(value.amount) &&
          Math.abs(value.amount) <= 999999999999 && Math.abs(Math.round(value.amount * 100) / 100 - value.amount) < 1e-8 &&
          typeof value.currency === 'string' && /^[A-Z]{3}$/.test(value.currency)) return { amount: value.amount, currency: value.currency };
      break;
    case 'boolean':
      if (typeof value === 'boolean') return value;
      break;
    case 'list': {
      const selected = field.multiple ? value : [value];
      if (!Array.isArray(selected) || selected.length > 100 || new Set(selected).size !== selected.length) return invalid();
      const old = new Set(Array.isArray(prior) ? prior : [prior]);
      if (!selected.every((id) => field.options.some((option) => option.id === id && (!option.archived || old.has(id))))) return invalid();
      return selected.length ? value : undefined;
    }
  }
  return invalid();
}

function planValues(fields, status, previous, input, files = []) {
  if (input !== undefined && !object(input)) throw fail('Custom field values must be an object.');
  const active = new Map(fields.filter((field) => !field.archived).map((field) => [field.id, field]));
  const values = { ...previous };
  const uploads = new Map();
  for (const [id, value] of Object.entries(input || {})) {
    const field = active.get(id);
    if (!field) throw fail('A custom field is unavailable. Reload the work.');
    if (!relevant(field, status)) throw fail(`${field.label}: the card is unavailable for this status.`);
    const normalized = normalize(field, value, values[id]);
    if (normalized === undefined) delete values[id];
    else values[id] = normalized;
  }
  for (const file of files) {
    const id = /^file\.([0-9a-f-]+)$/.exec(file.fieldname)?.[1];
    const field = active.get(id);
    if (!field || field.type !== 'file' || !relevant(field, status) || uploads.has(id) || Object.hasOwn(input || {}, id) || !file.size) {
      throw fail('Invalid or empty custom field attachment.');
    }
    const name = String(file.originalname).replace(/[\\/\u0000-\u001f\u007f]+/g, '_').slice(0, 180).trim() || 'attachment';
    values[id] = { id: randomUUID(), name, size: file.size };
    uploads.set(id, file.buffer);
  }
  for (const field of active.values()) {
    if (field.required && relevant(field, status) && missing(values[field.id])) throw fail(`${field.label} is required.`, 422);
  }
  return { values, uploads };
}

async function saveValues(req, status, work, save) {
  const tenantId = req.scope.tenantId;
  const config = req.scope.tenantType === 'client' ? empty : await settings(tenantId);
  const previous = work.customFields || {};
  const selections = catalogSelections(config, work, req.body || {});
  const reporting = await workReporting(req, work.reporting || {}, config.projectSizeGrouping);
  const { values, uploads } = planValues(config.fields, status, previous, req.body?.customFields, req.files);
  const uploaded = [];
  let result;
  try {
    for (const [id, buffer] of uploads) {
      const key = storageKey(tenantId, values[id].id);
      await storage.uploadBuffer(key, buffer);
      uploaded.push(key);
    }
    result = await save(values, { ...selections, reporting });
  } catch (error) {
    await Promise.allSettled(uploaded.map((key) => storage.deleteFile(key)));
    if (error.name === 'VersionError' || error.code === '40001') throw fail('The work changed. Reload and try again.', 409);
    throw error;
  }
  const retired = config.fields.filter((field) => field.type === 'file' && uid.test(previous[field.id]?.id || '') &&
    previous[field.id].id !== values[field.id]?.id);
  for (const field of retired) {
    await storage.deleteFile(storageKey(tenantId, previous[field.id].id)).catch((error) => {
      console.error('[work-fields] Retired attachment cleanup failed', error.code);
    });
  }
  return result;
}

async function download(req, res, work) {
  const field = (await settings(req.scope.tenantId)).fields.find((item) => item.id === req.params.fieldId && !item.archived && item.type === 'file');
  const file = work.customFields?.[field?.id];
  if (!field || !relevant(field, work.status) || !uid.test(file?.id || '')) throw fail('File not found.', 404);
  const key = storageKey(req.scope.tenantId, file.id);
  const result = await storage.openDownloadStream(key).catch((error) => {
    if (error.code === 'ENOENT') throw fail('File not found.', 404);
    throw error;
  });
  res.attachment(file.name);
  res.type('application/octet-stream');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Cache-Control', 'private, no-store');
  res.set('Content-Length', String(result.size));
  await pipeline(result.stream, res);
}

module.exports = { settings, saveSettings, saveValues, download, buildSettings, planValues, relevant, catalogSelections };
