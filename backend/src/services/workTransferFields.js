const { randomUUID } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { WORK_STATUSES } = require('../models/workItem');
const { workNumberPrefix, planValues, relevant } = require('./workFields');
const { workNumberBase } = require('./workNumbers');
const { workBillingDates } = require('./workBillingDates');
const { workReporting } = require('./workDashboard');
const { currencyOptions } = require('./tenantCurrency');
const { revisionKey } = require('./workTransferWorkbook');

const workId = /^[0-9a-f]{24}$/i;
const asId = (value) => value == null ? '' : String(value);
const isBlank = (value) => value == null || (typeof value === 'string' && !value.trim());
const optionalDefaults = { status: 'inquiry', totalAmount: 0, costAmount: 0, paymentDeadlineDays: 30,
  contractSigned: false, performanceCertificate: false, contributors: [], description: '', subcontractor: '', invoiceNumber: '' };
const revisionOf = (work) => new Date(work.updatedAt || 0).toISOString() + '/' + (work.fieldRevision ?? work.__v ?? 0);
const pathFor = (tenantId, id) => 'work-fields/' + tenantId + '/' + id;
const money = (value) => Number.isFinite(value) && Math.abs(value) <= 999999999999 &&
  Math.abs(Math.round(value * 100) / 100 - value) < 1e-8;
const dateText = (value) => {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : '';
};

function optionLookup(items, label) {
  const values = new Map(items.map((item) => [asId(item.id ?? item._id), item]));
  const key = (id) => values.has(id) ? label(values.get(id)) + ' [' + id + ']' : id;
  return {
    choices: [...values].filter(([, item]) => !item.archived).map(([id]) => key(id)),
    key,
    find(value, prior) {
      if (!values.has(value) && asId(prior) === value) return value;
      const matches = [...values].filter(([id, item]) => (!item.archived || asId(prior) === id || (Array.isArray(prior) && prior.includes(id))) &&
        [id, key(id), label(item)].includes(value));
      if (matches.length !== 1) throw new Error('Select an available value from the tenant list.');
      return matches[0][0];
    }
  };
}

function columnsFor({ config, clients, users, currency }) {
  const nameOf = (user) => [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email;
  const userOptions = optionLookup(users, nameOf);
  const currencies = [...new Set([...currencyOptions(), currency])];
  const catalog = (entries) => optionLookup(entries, ({ label, code }) => code ? code + ' -- ' + label : label);
  const fields = [
    ['id', 'ID'], ['year', 'Year', 'year'], ['sequenceNumber', 'Sequence number', 'sequence'],
    ['name', 'Name', 'text'], ['clientId', 'Client', 'reference', optionLookup(clients, (client) => client.name)],
    ['entityId', 'Entity', 'reference', catalog(config.entities)], ['serviceTypeId', 'Service type', 'reference', catalog(config.serviceTypes)],
    ['responsibleUserId', 'Responsible', 'reference', userOptions], ['contributors', 'Contributors', 'multiText'],
    ['status', 'Status', 'choice', WORK_STATUSES], ['description', 'Description', 'text'],
    ['deadline', 'Deadline', 'date'], ['currency', 'Currency', 'choice', currencies],
    ['totalAmount', 'Total amount', 'money'], ['costAmount', 'Cost', 'money'], ['subcontractor', 'Subcontractor', 'text'],
    ['paymentDeadlineDays', 'Payment days', 'days'], ['offerDate', 'Offer date', 'date'],
    ['completionDate', 'Completion date', 'date'], ['invoiceDate', 'Invoice date', 'date'],
    ['invoicePaymentDeadline', 'Invoice payment deadline', 'date'], ['paidAt', 'Paid at', 'date'],
    ['invoiceNumber', 'Invoice number', 'text'], ['contractSigned', 'Contract signed', 'boolean'],
    ['performanceCertificate', 'Performance certificate', 'boolean'],
    ['reporting.backupId', 'Backup', 'reference', userOptions], ['reporting.nextAction', 'Next action', 'text'],
    ['reporting.actionDue', 'Action due', 'date'], ['reporting.contractDate', 'Order acceptance date', 'date']
  ];
  if (config.projectSizeGrouping) fields.push(['reporting.projectSize', 'Project size', 'choice', ['Small', 'Medium', 'Large']]);
  for (const field of config.fields.filter((field) => !field.archived)) {
    const key = 'custom.' + field.id;
    const label = 'Custom · ' + field.label + ' [' + field.id + ']';
    const type = field.type === 'list' ? (field.multiple ? 'multiReference' : 'reference') : field.type;
    if (type === 'amount') {
      fields.push([key, label, 'signedMoney'], [key + '.currency', label + ' currency', 'currency']);
    } else {
      fields.push([key, label, type, field.type === 'list' ? optionLookup(field.options, (option) => option.label) : undefined]);
    }
  }
  return fields.map(([key, label, type = 'text', options]) => ({
    key, label, type, options, choices: type === 'boolean' ? ['Yes', 'No'] :
      Array.isArray(options) ? options : type === 'reference' ? options.choices : undefined
  }));
}

function formatWork(work, columns, config) {
  const result = { revision: revisionOf(work) };
  for (const col of columns) {
    const [group, fieldId, part] = col.key.split('.');
    const field = group === 'custom' ? config.fields.find(({ id }) => id === fieldId) : undefined;
    if (field && !relevant(field, work.status)) continue;
    let value = field ? work.customFields?.[fieldId] : group === 'reporting' ? work.reporting?.[fieldId] : work[col.key];
    if (field?.type === 'amount') value = value?.[part || 'amount'];
    if (value == null || value === '') continue;
    if (col.type === 'reference') value = col.options.key(asId(value));
    if (col.type === 'multiReference') value = JSON.stringify(value.map((id) => col.options.key(id)));
    if (col.type === 'multiText') value = value.length ? JSON.stringify(value) : '';
    if (col.type === 'date') value = dateText(value);
    if (col.type === 'file') value = value.name;
    if (col.type === 'boolean') value = value ? 'Yes' : 'No';
    result[col.key] = value;
  }
  return result;
}

function parseCell(col, raw, prior) {
  if (isBlank(raw)) return undefined;
  if (raw instanceof Date && col.type === 'date') return dateText(raw);
  if (typeof raw === 'object' || !['string', 'number', 'boolean'].includes(typeof raw)) {
    throw new Error('Enter a literal value without a formula.');
  }
  const text = String(raw).trim().normalize('NFC');
  if (col.type === 'reference') return col.options.find(text, prior);
  if (col.type === 'multiText' || col.type === 'multiReference') {
    const list = text.startsWith('[') ? JSON.parse(text) : text.split(';').map((value) => value.trim());
    if (!Array.isArray(list) || list.some((value) => typeof value !== 'string' || !value.trim()) || list.length > 100) {
      throw new Error('Enter a list of up to 100 values.');
    }
    return col.type === 'multiReference' ? list.map((value) => col.options.find(value, prior)) : list;
  }
  if (col.type === 'boolean') {
    if (/^(yes|true|igen|1)$/i.test(text)) return true;
    if (/^(no|false|nem|0)$/i.test(text)) return false;
    throw new Error('Enter Yes or No.');
  }
  if (col.type === 'choice' && !col.choices.includes(text) && text !== prior) throw new Error('Select an available value.');
  if (col.type === 'currency' && !/^[A-Z]{3}$/.test(text)) throw new Error('Enter a three-letter currency code.');
  if (col.type === 'date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || text.slice(0, 4) === '0000' || dateText(text) !== text) {
      throw new Error('Enter a valid date in YYYY-MM-DD format.');
    }
    return text;
  }
  if (['year', 'sequence', 'days', 'money', 'signedMoney', 'integer', 'decimal'].includes(col.type)) {
    const number = /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(text) ? Number(text) : NaN;
    if (col.type === 'year' && Number.isInteger(number) && number >= 2000 && number <= 9999) return number;
    if (col.type === 'sequence' && Number.isInteger(number) && number > 0 && number <= 2147483647) return number;
    if (col.type === 'days' && Number.isInteger(number) && number >= 0 && number <= 2147483647) return number;
    if (col.type === 'money' && money(number) && number >= 0) return number;
    if (col.type === 'signedMoney' && money(number)) return number;
    if (col.type === 'integer' && Number.isSafeInteger(number)) return number;
    if (col.type === 'decimal' && Number.isFinite(number) && Math.abs(number) <= Number.MAX_SAFE_INTEGER) return number;
    throw new Error('Enter a valid ' + (col.type.includes('oney') ? 'amount with up to two decimals' : col.type) + '.');
  }
  return text;
}

function table(sheet, columns, issues) {
  const keys = new Map();
  const byLabel = new Map([...columns, { key: 'revision', label: revisionKey }].map((column) => [column.label, column]));
  for (let index = 1; index <= sheet.columnCount; index++) {
    const header = sheet.getCell(1, index).value;
    const col = typeof header === 'string' && byLabel.get(header.trim());
    if (col && !keys.has(col.key)) keys.set(col.key, { ...col, index });
    else if (header != null || sheet.getColumn(index).values.some((value, row) => row > 1 && !isBlank(value))) {
      issues.push({ row: 1, col: index, message: 'Unknown or duplicate column. Use the current template.' });
    }
  }
  for (const [index, key] of ['id', 'year', 'sequenceNumber'].entries()) {
    if (keys.get(key)?.index !== index + 1) issues.push({ row: 1, col: index + 1, message: 'Keep the ID, Year and Sequence number columns in A, B and C.' });
  }
  return keys;
}

function markConflicts(rows, works, issues) {
  const bySequence = new Map();
  const byNumber = new Map();
  const sequenceKey = (work) => work.year + ':' + work.sequenceNumber;
  for (const work of works) {
    bySequence.set(sequenceKey(work), work);
    if (!byNumber.has(work.workNumber)) byNumber.set(work.workNumber, []);
    byNumber.get(work.workNumber).push(work);
  }
  const describe = (work) => {
    const status = work.archivedAt ? 'Deleted' : (work.status || 'Unknown status').replace(/_/g, ' ');
    const filter = work.archivedAt ? 'Deleted' : 'All';
    return `"${work.name}" (work number ${work.workNumber}, status: ${status}). Set the work table filter to ${filter} and search for ${work.workNumber}.`;
  };
  const seen = new Map();
  for (const item of rows) {
    if (!item.year || !item.sequenceNumber) continue;
    const key = sequenceKey(item);
    const conflicting = bySequence.get(key);
    if (conflicting && conflicting.id !== item.id) {
      issues.push({ row: item.row, col: 3,
        message: `Year ${item.year}, sequence ${item.sequenceNumber} is already used by ${describe(conflicting)}` });
    }
    if (item.workNumber) {
      for (const work of byNumber.get(item.workNumber) || []) {
        if (work.id === item.id || work.id === conflicting?.id) continue;
        issues.push({ row: item.row, col: 3,
          message: `Work number ${item.workNumber} is already used by ${describe(work)}` });
      }
    }
    const identifiers = ['sequence:' + key];
    if (item.workNumber) identifiers.push('number:' + item.workNumber);
    for (const unique of identifiers) {
      if (seen.has(unique)) {
        for (const row of [seen.get(unique), item.row]) issues.push({ row, col: 3, message: 'This work number occurs more than once in the file.' });
      } else seen.set(unique, item.row);
    }
  }
}

function unchanged(key, value, previous) {
  const stored = previous[key];
  if (stored == null && (value == null || value === '' || isDeepStrictEqual(value, optionalDefaults[key]))) return true;
  if (key === 'clientId' || key === 'responsibleUserId') return asId(value) === asId(stored);
  if (stored instanceof Date) return dateText(value) === dateText(stored);
  return isDeepStrictEqual(value, stored);
}

async function prepareRows({ sheet, columns, context, works, files, progress }) {
  const { config, currency, clients, users, tenantId } = context;
  const issues = [];
  const keys = table(sheet, columns, issues);
  const rows = [];
  const existing = new Map(works.map((work) => [work.id, work]));
  const byClient = new Map(clients.map((client) => [asId(client.id ?? client._id), client]));
  const byUser = new Map(users.map((user) => [asId(user.id ?? user._id), user]));
  const seenIds = new Map();
  const picked = [];
  for (let row = 2; row <= sheet.rowCount; row++) {
    const cells = sheet.getRow(row);
    if (cells.values.some((value, col) => col !== keys.get('revision')?.index && !isBlank(value))) picked.push(row);
  }
  progress(0, picked.length);
  if (!issues.length) {
    for (const [offset, row] of picked.entries()) {
      const issue = (key, message) => issues.push({ row, col: keys.get(key)?.index ?? 1, message });
      const valueAt = (key) => keys.has(key) ? sheet.getCell(row, keys.get(key).index).value : undefined;
      const rawId = valueAt('id');
      const id = isBlank(rawId) ? '' : typeof rawId === 'string' ? rawId.trim().toLowerCase() : '?';
      const previous = existing.get(id);
      const changes = {};
      const reporting = { ...previous?.reporting };
      const customFields = { ...previous?.customFields };
      const target = { row, id, previous, changes, uploads: [], retired: [] };
      rows.push(target);
      if (id) {
        if (!workId.test(id) || !previous || previous.archivedAt) issue('id', 'This ID does not identify an editable work in the current tenant.');
        else if (valueAt('revision') !== revisionOf(previous)) issue('id', 'The export version is missing or the work changed. Download a fresh export.');
        if (seenIds.has(id)) {
          issue('id', 'This ID occurs more than once in the file.');
          issues.push({ row: seenIds.get(id), col: 1, message: 'This ID occurs more than once in the file.' });
        } else seenIds.set(id, row);
      } else if (!isBlank(valueAt('revision'))) issue('id', 'Keep the exported ID for an existing work. For new works, use an empty template row.');

      for (const [key, col] of keys) {
        if (key === 'id' || key === 'revision' || key.startsWith('custom.')) continue;
        const isReporting = key.startsWith('reporting.');
        const property = isReporting ? key.split('.')[1] : key;
        try {
          const value = parseCell(col, valueAt(key), isReporting ? reporting[property] : previous?.[key]);
          if (isReporting) {
            const req = { scope: { tenantId, tenantType: 'company' }, body: { reporting: { [property]: value ?? null } } };
            const result = await workReporting(req, reporting, config.projectSizeGrouping, (id) => byUser.has(id));
            if (Object.hasOwn(result, property)) reporting[property] = result[property]; else delete reporting[property];
          } else changes[key] = value ?? (key === 'currency' ? currency : optionalDefaults[key] ?? null);
        } catch (error) { issue(key, error.message); }
      }
      target.year = changes.year;
      target.sequenceNumber = changes.sequenceNumber;
      for (const key of ['year', 'sequenceNumber']) if (isBlank(valueAt(key))) issue(key, 'This value is required.');
      const name = changes.name ?? (keys.has('name') ? '' : previous?.name);
      if (!name) issue('name', 'Work name is required.');
      const status = changes.status ?? previous?.status ?? 'inquiry';
      changes.status = status;
      if (Object.hasOwn(changes, 'clientId') && asId(changes.clientId) !== asId(previous?.clientId)) changes.customer = byClient.get(changes.clientId)?.name || '';
      if (Object.hasOwn(changes, 'responsibleUserId') && asId(changes.responsibleUserId) !== asId(previous?.responsibleUserId)) {
        const user = byUser.get(changes.responsibleUserId);
        changes.responsible = user ? [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email : '';
      }
      const serviceTypeId = changes.serviceTypeId === undefined ? previous?.serviceTypeId : changes.serviceTypeId;
      if (target.year && target.sequenceNumber) {
        try {
          target.workNumber = previous && previous.year === target.year && previous.sequenceNumber === target.sequenceNumber &&
            asId(previous.serviceTypeId) === asId(serviceTypeId) ? previous.workNumber :
            workNumberPrefix(config, serviceTypeId) + workNumberBase(target.year, target.sequenceNumber);
          changes.workNumber = target.workNumber;
        } catch (error) { issue('serviceTypeId', error.message); }
      }
      for (const field of config.fields.filter((field) => !field.archived)) {
        const key = 'custom.' + field.id;
        const currencyKey = key + '.currency';
        if (!keys.has(key) && !keys.has(currencyKey)) {
          if (field.required && relevant(field, status) && isBlank(customFields[field.id])) issue(key, field.label + ' is required.');
          continue;
        }
        const currencyValue = valueAt(currencyKey);
        if (!relevant(field, status)) {
          if (!isBlank(valueAt(key)) || !isBlank(currencyValue)) issue(key, 'This field is unavailable for the selected status.');
          continue;
        }
        const prior = customFields[field.id];
        let errorKey = key;
        try {
          let value = keys.has(key) ? parseCell(keys.get(key), valueAt(key), prior) : prior?.amount;
          const attachments = [];
          if (field.type === 'amount') {
            errorKey = currencyKey;
            const unit = keys.has(currencyKey) ? parseCell(keys.get(currencyKey), currencyValue) : prior?.currency;
            if ((value === undefined) !== (unit === undefined)) {
              if (value === undefined) errorKey = key;
              throw new Error('Enter both an amount and a currency.');
            }
            value = unit ? { amount: value, currency: unit } : undefined;
            errorKey = key;
          }
          if (field.type === 'file' && value !== undefined) {
            const buffer = files.get(value);
            if (!buffer && value !== prior?.name) throw new Error('File not found in the attachments ZIP.');
            if (!buffer) continue;
            attachments.push({ fieldname: 'file.' + field.id, originalname: value.split('/').pop(), size: buffer.length, buffer });
            value = undefined;
          }
          const input = attachments.length ? undefined : { [field.id]: value ?? null };
          const plan = planValues([field], status, customFields, input, attachments);
          if (Object.hasOwn(plan.values, field.id)) customFields[field.id] = plan.values[field.id];
          else delete customFields[field.id];
          for (const [fieldId, buffer] of plan.uploads) target.uploads.push({ path: pathFor(tenantId, plan.values[fieldId].id), buffer });
          if (field.type === 'file' && prior?.id && prior.id !== customFields[field.id]?.id) target.retired.push(pathFor(tenantId, prior.id));
        } catch (error) { issue(errorKey, error.message); }
      }
      const defaults = { name, currency, totalAmount: 0, costAmount: 0, paymentDeadlineDays: 30, contributors: [] };
      if (!id) Object.assign(changes, { ...defaults, ...changes });
      Object.assign(changes, { customFields, reporting });
      if (previous) {
        for (const key of Object.keys(changes)) {
          if (unchanged(key, changes[key], previous) ||
              ((key === 'reporting' || key === 'customFields') && previous[key] == null && !Object.keys(changes[key]).length)) delete changes[key];
        }
      }
      const billingInputs = ['status', 'paymentDeadlineDays', 'completionDate', 'invoicePaymentDeadline', 'invoiceDate', 'paidAt'];
      if (!previous || billingInputs.some((key) => Object.hasOwn(changes, key))) {
        Object.assign(changes, workBillingDates({ ...changes, status }, previous));
      }
      target.modified = Object.keys(changes).length > 0;
      Object.assign(changes, { year: target.year, sequenceNumber: target.sequenceNumber, workNumber: target.workNumber });
      if ((offset + 1) % 25 === 0 || offset + 1 === picked.length) {
        progress(offset + 1, picked.length);
        await new Promise(setImmediate);
      }
    }
  }
  if (!picked.length && !issues.length) issues.push({ row: 1, col: 1, message: 'There are no work rows to import.' });
  markConflicts(rows, works, issues);
  return { rows, issues };
}

module.exports = { columnsFor, formatWork, prepareRows, markConflicts, revisionOf };
