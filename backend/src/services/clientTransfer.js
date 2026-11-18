const mongoose = require('mongoose');
const { databaseEngine, query, withTransaction } = require('../postgres');
const ClientCompany = require('../models/clientCompany');
const { fields, clientCompanyDetails } = require('./clientCompanyDetails');
const { createWorkbook, readWorkbook, revisionKey, invalid } = require('./workTransferWorkbook');

const sheetName = 'Clients';
const labels = ['Tax number', 'Company name', 'Country', 'Postal code', 'City', 'Address', 'Email', 'Phone'];
const columns = [{ key: 'id', label: 'ID', numFmt: '@' }, ...fields.map((key, index) => ({ key, label: labels[index], numFmt: '@' }))];
const sqlFields = ['tax_number', 'name', 'country', 'postal_code', 'city', 'address', 'email', 'phone'];
const isPg = () => databaseEngine() === 'postgresql';
const version = (company) => new Date(company.updatedAt).toISOString();
const newId = () => new mongoose.Types.ObjectId().toString();
const blank = (value) => value == null || (typeof value === 'string' && !value.trim());

async function scopedClients(tenantId, transaction) {
  if (isPg()) {
    const run = transaction ? transaction.query.bind(transaction) : query;
    if (transaction) await run(`SELECT c.id FROM client_companies c JOIN client_company_tenants t ON t.client_company_id=c.id
      WHERE t.tenant_id=$1 ORDER BY c.id FOR UPDATE OF c`, [tenantId]);
    const { rows } = await run(`SELECT c.*,
      (SELECT count(*) FROM client_company_tenants links WHERE links.client_company_id=c.id) AS link_count
      FROM client_companies c JOIN client_company_tenants t ON t.client_company_id=c.id
      WHERE t.tenant_id=$1 ORDER BY c.name,c.id`, [tenantId]);
    return rows.map((row) => ({
      ...Object.fromEntries(fields.map((key, index) => [key, row[sqlFields[index]]])),
      id: row.id, normalizedTaxNumber: row.normalized_tax_number, updatedAt: row.updated_at, shared: Number(row.link_count) > 1
    }));
  }
  const data = await ClientCompany.find({ tenantIds: tenantId }).sort({ name: 1, _id: 1 }).session(transaction || null).lean();
  return data.map((row) => ({ ...row, id: String(row._id), shared: row.tenantIds.length > 1 }));
}

async function exportClients(tenantId, template) {
  const clients = template ? [] : await scopedClients(tenantId);
  return createWorkbook(columns, clients, (client) => ({
    ...Object.fromEntries(columns.map(({ key }) => [key, String(client[key] ?? '')])),
    revision: version(client)
  }), { sheetName, instructions: [
    'Keep the ID and hidden export version for existing clients. Leave both empty for a new client.',
    'Enter a company name. Leave Country blank if unknown. Tax number is required only when Country is HU.',
    'Format tax numbers and postal codes as text to preserve leading zeros.',
    'Omitted columns preserve existing values. Empty cells in included optional columns clear their values.',
    'Clients shared with other tenants cannot be changed through this import.'
  ] });
}

async function prepareClients(sheet, clients, onProgress) {
  const positions = new Map();
  const names = new Map([...columns, { key: 'revision', label: revisionKey }].map(({ key, label }) => [label, key]));
  const issues = [];
  const rows = [];
  const add = (row, key, message) => issues.push({ row, col: positions.get(key) || 1, message });
  for (let col = 1; col <= sheet.columnCount; col++) {
    const header = sheet.getCell(1, col).value;
    const key = typeof header === 'string' && names.get(header.trim());
    if (key && !positions.has(key)) positions.set(key, col);
    else if (!blank(header) || sheet.getColumn(col).values.some((value, index) => index > 1 && !blank(value))) {
      issues.push({ row: 1, col, message: 'Unknown or duplicate column. Use the current Clients template.' });
    }
  }
  if (positions.get('id') !== 1) add(1, 'id', 'Keep the ID column in A.');
  if (issues.length) return { rows, issues };
  const dataRows = [];
  sheet.eachRow((row, index) => {
    if (index > 1 && row.values.some((value, col) => col !== positions.get('revision') && !blank(value))) dataRows.push(row);
  });
  if (!dataRows.length) add(1, 'id', 'There are no client rows to import.');
  const existing = new Map(clients.map((company) => [company.id, company]));
  const seen = new Map();
  onProgress(0, dataRows.length);
  for (const [index, row] of dataRows.entries()) {
    const value = (key) => positions.has(key) ? row.getCell(positions.get(key)).value : undefined;
    const raw = value('id');
    const id = blank(raw) ? '' : typeof raw === 'string' ? raw.trim().toLowerCase() : '?';
    const previous = existing.get(id);
    if (id) {
      if (!previous) add(row.number, 'id', 'This ID does not identify a client linked to this tenant.');
      else if (value('revision') !== version(previous)) add(row.number, 'id', 'This client changed or its export version is missing. Download a fresh export.');
      if (seen.has(id)) {
        add(row.number, 'id', 'This ID occurs more than once in the file.');
        add(seen.get(id), 'id', 'This ID occurs more than once in the file.');
      } else seen.set(id, row.number);
    } else if (!blank(value('revision'))) add(row.number, 'id', 'Keep the exported ID or use an empty template row.');
    const input = {};
    for (const key of fields) {
      const cell = value(key);
      if (cell != null && typeof cell !== 'string' && typeof cell !== 'number') {
        add(row.number, key, 'Enter a literal value without a formula.');
      } else input[key] = positions.has(key) ? cell : previous?.[key];
    }
    try {
      const details = clientCompanyDetails(input);
      if (!details.taxNumber && previous && !previous.taxNumber) details.normalizedTaxNumber = previous.normalizedTaxNumber;
      const modified = !previous || fields.some((key) => details[key] !== (previous[key] ?? ''));
      if (modified && previous?.shared) add(row.number, 'id', 'This client is shared with another tenant and cannot be edited here.');
      rows.push({ id, row: row.number, taxColumn: positions.get('taxNumber') || 1, previous, details, modified });
    } catch (error) {
      if (!error.field) throw error;
      add(row.number, error.field, error.message);
    }
    if ((index + 1) % 25 === 0 || index + 1 === dataRows.length) {
      onProgress(index + 1, dataRows.length);
      await new Promise(setImmediate);
    }
  }
  return { rows, issues };
}

async function taxConflicts(rows, issues, transaction) {
  const seen = new Map();
  for (const row of rows) {
    if (!row.details.taxNumber) continue;
    const key = row.details.normalizedTaxNumber;
    if (seen.has(key)) {
      for (const duplicate of [seen.get(key), row]) issues.push({ row: duplicate.row, col: duplicate.taxColumn, message: 'This tax number occurs more than once in the file.' });
    } else seen.set(key, row);
  }
  if (!seen.size) return;
  const keys = [...seen.keys()];
  const registered = isPg()
    ? (await (transaction ? transaction.query.bind(transaction) : query)(`SELECT id, normalized_tax_number AS "normalizedTaxNumber"
        FROM client_companies WHERE normalized_tax_number=ANY($1::text[])`, [keys])).rows
    : (await ClientCompany.find({ normalizedTaxNumber: { $in: keys } }).select('normalizedTaxNumber').session(transaction || null).lean())
        .map((company) => ({ id: String(company._id), normalizedTaxNumber: company.normalizedTaxNumber }));
  const byTax = new Map(registered.map((company) => [company.normalizedTaxNumber, company.id]));
  for (const row of rows) {
    const found = row.details.taxNumber && byTax.get(row.details.normalizedTaxNumber);
    if (found && found !== row.id) issues.push({ row: row.row, col: row.taxColumn, message: 'This tax number belongs to another client.' });
  }
}

async function commitClients(tenantId, actorId, rows, transaction) {
  const byId = new Map((await scopedClients(tenantId, transaction)).map((company) => [company.id, company]));
  const issues = [];
  for (const row of rows) {
    if (!row.id) continue;
    const current = byId.get(row.id);
    if (!current || version(current) !== version(row.previous) || (row.modified && current.shared)) {
      issues.push({ row: row.row, col: 1, message: 'This client changed or is no longer editable. Download a fresh export.' });
    }
  }
  await taxConflicts(rows, issues, transaction);
  if (issues.length) return issues;

  for (const row of rows.filter(({ modified }) => modified)) {
    const details = row.details;
    if (isPg()) {
      const id = row.id || newId();
      const params = [id, actorId, details.normalizedTaxNumber, ...fields.map((key) => details[key])];
      if (row.id) {
        const assignments = sqlFields.map((column, i) => column + '=$' + (i + 4));
        await transaction.query(`UPDATE client_companies SET updated_by=$2, updated_at=now(), normalized_tax_number=$3,
          ${assignments.join(', ')} WHERE id=$1`, params);
      } else {
        await transaction.query(`INSERT INTO client_companies (id,created_by,updated_by,normalized_tax_number,${sqlFields.join(',')},created_at,updated_at)
          VALUES($1,$2,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now(),now())`, params);
        await transaction.query('INSERT INTO client_company_tenants(client_company_id,tenant_id) VALUES($1,$2)', [id, tenantId]);
      }
    } else {
      const client = row.id ? ClientCompany.hydrate(byId.get(row.id)) : new ClientCompany({ tenantIds: [tenantId], createdBy: actorId });
      client.set({ ...details, updatedBy: actorId });
      await client.save({ session: transaction });
    }
  }
  return [];
}

async function importClients({ scope, actorId, excel, job, reject }) {
  const { tenantId } = scope;
  const { workbook, sheet } = await readWorkbook(excel, sheetName);
  const clients = await scopedClients(tenantId);
  const { rows, issues } = await prepareClients(sheet, clients, (processed, total) => Object.assign(job.result, { state: 'validating', processed, total }));
  await taxConflicts(rows, issues);
  if (issues.length) return reject(job, workbook, sheet, issues);
  job.result.state = 'saving';
  const commit = (transaction) => commitClients(tenantId, actorId, rows, transaction);
  let conflicts;
  try {
    if (isPg()) conflicts = await withTransaction(commit);
    else {
      const topology = await mongoose.connection.db.admin().command({ hello: 1 });
      if (!topology.setName && topology.msg !== 'isdbgrid') throw invalid('Atomic import requires a MongoDB replica set or sharded cluster.');
      const session = await mongoose.startSession();
      try { conflicts = await session.withTransaction(() => commit(session)); }
      finally { await session.endSession(); }
    }
  } catch (error) {
    if (error.code !== 11000 && error.code !== '23505') throw error;
    conflicts = [];
    await taxConflicts(rows, conflicts);
    if (!conflicts.length) conflicts.push({ row: 1, col: 1, message: 'A client was added concurrently. Upload the workbook again.' });
  }
  if (conflicts.length) return reject(job, workbook, sheet, conflicts);
  const created = rows.filter((row) => !row.id).length;
  const updated = rows.filter((row) => row.id && row.modified).length;
  Object.assign(job.result, { state: 'succeeded', created, updated, unchanged: rows.length - created - updated });
}

module.exports = { exportClients, importClients, prepareClients };
