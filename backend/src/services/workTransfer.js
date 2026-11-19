const { recordImportedFinancialChanges } = require('./securityAudit');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const { databaseEngine, query, withTransaction } = require('../postgres');
const postgres = require('../repositories/postgres/workBoardRepository');
const { WorkItem } = require('../models/workItem');
const Tenant = require('../models/tenant');
const User = require('../models/user');
const ClientCompany = require('../models/clientCompany');
const WorkSequence = require('../models/workSequence');
const storage = require('./fileStorageService');
const { settings } = require('./workFields');
const { getDefaultCurrency } = require('./tenantCurrency');
const { markMongoDashboardDirty } = require('./workDashboardSnapshots');
const { createWorkbook, readWorkbook, readAttachments, errorWorkbook, invalid } = require('./workTransferWorkbook');
const { columnsFor, formatWork, prepareRows, markConflicts, revisionOf } = require('./workTransferFields');
const { importClients } = require('./clientTransfer');
const { lockWorkRates } = require('./workExchangeRates');

const isPostgres = () => databaseEngine() === 'postgresql';
const mongoWork = (work) => ({ ...work, id: String(work._id) });

async function contextFor(tenantId) {
  const clients = isPostgres()
    ? query(`SELECT c.id, c.name FROM client_companies c JOIN client_company_tenants t
      ON t.client_company_id=c.id WHERE t.tenant_id=$1 ORDER BY c.name, c.id`, [tenantId]).then((result) => result.rows)
    : ClientCompany.find({ tenantIds: tenantId }).select('name').sort({ name: 1, _id: 1 }).lean();
  const users = isPostgres()
    ? query(`SELECT id, first_name AS "firstName", last_name AS "lastName", email FROM users
      WHERE tenant_id=$1 OR additional_tenant_ids @> ARRAY[$1]::varchar(24)[]
      ORDER BY last_name, first_name, id`, [tenantId]).then((result) => result.rows)
    : User.find({ $or: [{ tenantId }, { additionalTenantIds: tenantId }] }).select('firstName lastName email').sort({ lastName: 1, firstName: 1, _id: 1 }).lean();
  const [config, currency, clientList, userList] = await Promise.all([settings(tenantId), getDefaultCurrency(tenantId), clients, users]);
  return { tenantId, config, currency, clients: clientList, users: userList };
}

async function tenantWorks(tenantId, activeOnly = false) {
  if (isPostgres()) {
    const { rows } = await query(`SELECT * FROM work_items WHERE tenant_id=$1 ${activeOnly ? 'AND archived_at IS NULL' : ''}
      ORDER BY year DESC, sequence_number DESC`, [tenantId]);
    return rows.map(postgres.mapWork);
  }
  const filter = activeOnly ? { tenantId, archivedAt: null } : { tenantId };
  return (await WorkItem.find(filter).sort({ year: -1, sequenceNumber: -1 }).lean()).map(mongoWork);
}

async function exportWorks(tenantId, template, language) {
  const context = await contextFor(tenantId);
  const works = template ? [] : await tenantWorks(tenantId, true);
  const columns = columnsFor(context);
  return createWorkbook(columns, works, (work) => formatWork(work, columns, context.config), { language });
}

function verifyLatest(rows, works, context, version, currency) {
  const issues = [];
  if (version !== context.config.version || currency !== context.currency) {
    return [{ row: 1, col: 1, message: 'Tenant settings changed during validation. Upload the workbook again.' }];
  }
  const byId = new Map(works.map((work) => [work.id, work]));
  for (const row of rows) {
    if (!row.id) continue;
    const current = byId.get(row.id);
    if (!current || current.archivedAt || revisionOf(current) !== revisionOf(row.previous)) {
      issues.push({ row: row.row, col: 1, message: 'This work changed during import. Download a fresh export.' });
    }
  }
  markConflicts(rows, works, issues);
  return issues;
}

function yearlyMax(rows) {
  const maxima = new Map();
  for (const row of rows) maxima.set(row.year, Math.max(maxima.get(row.year) || 0, row.sequenceNumber));
  return [...maxima].sort(([a], [b]) => a - b);
}

async function commitPostgres(context, actorId, rows) {
  const { tenantId } = context;
  return withTransaction(async (client) => {
    // Ordinary work creation takes a share lock on the tenant before allocating numbers.
    const tenant = (await client.query(`SELECT work_field_settings, default_currency FROM tenants
      WHERE id=$1 FOR NO KEY UPDATE`, [tenantId])).rows[0];
    const locked = (await client.query('SELECT * FROM work_items WHERE tenant_id=$1 ORDER BY id FOR UPDATE', [tenantId])).rows;
    const issues = verifyLatest(rows, locked.map(postgres.mapWork), context, tenant?.work_field_settings?.version ?? 0, tenant?.default_currency || 'HUF');
    if (issues.length) return issues;
    for (const row of rows.filter(({ modified }) => modified)) {
      if (row.id) {
        const applied = await postgres.updateWork(tenantId, row.id, actorId, row.changes, row.previous.fieldRevision, client);
        if (!applied) throw new Error('Locked work was not updated.');
      } else {
        await postgres.insertWork(client, tenantId, actorId, row.changes);
      }
    }
    for (const [year, maximum] of yearlyMax(rows)) {
      await client.query(`INSERT INTO work_sequences(id,tenant_id,key,value,created_at,updated_at)
        VALUES($1,$2,$3,$4,now(),now()) ON CONFLICT (tenant_id,key)
        DO UPDATE SET value=GREATEST(work_sequences.value,EXCLUDED.value),updated_at=now()`,
      [String(new mongoose.Types.ObjectId()), tenantId, 'work:' + year, maximum]);
    }
    return [];
  });
}

async function commitMongo(context, actorId, rows) {
  const { tenantId } = context;
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(async () => {
      const tenant = await Tenant.findById(tenantId).select('workFieldSettings defaultCurrency').session(session).lean();
      const works = (await WorkItem.find({ tenantId }).session(session).lean()).map(mongoWork);
      const issues = verifyLatest(rows, works, context, tenant?.workFieldSettings?.version ?? 0, tenant?.defaultCurrency || 'HUF');
      if (issues.length) return issues;
      for (const row of rows.filter(({ modified }) => modified)) {
        const work = row.id ? await WorkItem.findOne({ _id: row.id, tenantId }).session(session)
          : new WorkItem({ tenantId, createdBy: actorId });
        work.set({ ...row.changes, updatedBy: actorId });
        await work.save({ session });
      }
      for (const [year, maximum] of yearlyMax(rows)) {
        await WorkSequence.updateOne({ tenantId, key: 'work:' + year }, { $max: { value: maximum } }, { session, upsert: true });
      }
      return [];
    });
  } finally {
    await session.endSession();
  }
}

async function deleteFiles(paths) {
  for (const path of paths) {
    try { await storage.deleteFile(path); } catch (error) {
      console.error('[work-transfer] Attachment cleanup failed', error.code);
    }
  }
}

async function importWorks({ scope, actorId, excel, archive, job }) {
  const { tenantId } = scope;
  const { workbook, sheet } = await readWorkbook(excel);
  let files;
  try {
    files = await readAttachments(archive);
  } catch (error) {
    return rejected(job, workbook, sheet, [{ row: 1, col: 1, message: error.message }]);
  }
  const [context, works] = await Promise.all([contextFor(tenantId), tenantWorks(tenantId)]);
  const { rows, issues } = await prepareRows({
    sheet, columns: columnsFor(context), context, works, files,
    progress: (processed, total) => Object.assign(job.result, { state: 'validating', processed, total })
  });
  if (issues.length) return rejected(job, workbook, sheet, issues);
  for (const row of rows.filter(({ modified }) => modified)) {
    row.changes.reporting = await lockWorkRates(row.previous || {}, { ...row.previous, ...row.changes });
  }
  if (!isPostgres()) {
    const topology = await mongoose.connection.db.admin().command({ hello: 1 });
    if (!topology.setName && topology.msg !== 'isdbgrid') {
      throw invalid('Atomic import requires a MongoDB replica set or sharded cluster.');
    }
  }
  job.result.state = 'saving';
  const uploaded = [];
  let conflicts;
  try {
    for (const row of rows) {
      for (const file of row.uploads) {
        uploaded.push(file.path);
        await storage.uploadBuffer(file.path, file.buffer);
      }
    }
    conflicts = await (isPostgres() ? commitPostgres(context, actorId, rows) : commitMongo(context, actorId, rows));
  } catch (error) {
    // An ambiguous commit must not remove attachments that the committed works may reference.
    if (!error.hasErrorLabel?.('UnknownTransactionCommitResult') &&
        !(isPostgres() && (!error.code || String(error.code).startsWith('08')))) await deleteFiles(uploaded);
    if (error.code !== 11000 && error.code !== '23505') throw error;
    const fresh = await tenantWorks(tenantId);
    conflicts = [];
    markConflicts(rows, fresh, conflicts);
    if (!conflicts.length) conflicts.push({ row: 1, col: 3, message: 'A work number was assigned concurrently. Upload the file again.' });
  }
  if (conflicts.length) {
    await deleteFiles(uploaded);
    return rejected(job, workbook, sheet, conflicts);
  }
  await recordImportedFinancialChanges(scope, actorId, rows);
  await deleteFiles(rows.flatMap((row) => row.retired));
  if (!isPostgres()) await markMongoDashboardDirty(scope);
  const created = rows.filter((row) => !row.id).length;
  const updated = rows.filter((row) => row.id && row.modified).length;
  Object.assign(job.result, { state: 'succeeded', created, updated, unchanged: rows.length - created - updated });
}

async function rejected(job, workbook, sheet, issues) {
  job.report = await errorWorkbook(workbook, sheet, issues, job.language);
  Object.assign(job.result, { state: 'rejected', errors: issues.length, canDownload: true });
}

const jobs = new Map();
const jobRetention = 20 * 60 * 1000;
function startImport({ scope, actorId, excel, archive, kind = 'works', language = 'en' }) {
  const active = [...jobs.values()].filter((job) => !job.finishedAt);
  if (active.some((job) => job.tenantId === scope.tenantId) || active.length >= 2) {
    throw Object.assign(new Error('An import is already running. Try again shortly.'), { statusCode: 409 });
  }
  if (jobs.size >= 20) {
    const oldest = [...jobs].find(([, job]) => job.finishedAt);
    if (oldest) jobs.delete(oldest[0]);
  }
  const id = randomUUID();
  const job = { tenantId: scope.tenantId, actorId, kind, language, result: { id, state: 'reading', processed: 0, total: 0 } };
  jobs.set(id, job);
  setImmediate(() => {
    const importer = kind === 'clients' ? importClients : importWorks;
    importer({ scope, actorId, excel, archive, job, reject: rejected }).catch((error) => {
      if (!error.statusCode) console.error('[work-transfer] Import failed', error.code || error.name);
      Object.assign(job.result, { state: 'failed', message: error.statusCode ? error.message : 'The import could not be completed. Check the list before retrying.' });
    }).finally(() => {
      job.finishedAt = Date.now();
      setTimeout(() => jobs.delete(id), jobRetention).unref();
    });
  });
  return job.result;
}

function importJob(id, tenantId, actorId, kind = 'works') {
  const job = jobs.get(id);
  if (job?.tenantId === tenantId && job.actorId === actorId && job.kind === kind &&
      (!job.finishedAt || Date.now() - job.finishedAt <= jobRetention)) return job;
  throw Object.assign(new Error('Import job not found or expired.'), { statusCode: 404 });
}

module.exports = { exportWorks, startImport, importJob };
