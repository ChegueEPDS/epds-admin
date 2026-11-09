const { createHash } = require('node:crypto');
const { databaseEngine } = require('../postgres');
const { createTrackerImportWork } = require('../controllers/workBoardController');
const pg = require('../repositories/postgres/workBoardRepository');
const repo = require('./projectTrackerStore');
const board = require('./projectTrackerWorks');
const { fail, url, cents } = require('./projectTrackerDomain');

const normalized = (value) => String(value || '').trim().toLowerCase();
const fingerprint = (...parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24);
function uniqueByName(items, value) {
  if (!value) return null;
  const found = items.filter((item) => normalized(item.name) === normalized(value) && !item.archived);
  return found.length === 1 ? found[0] : null;
}

async function preview(tenantId, workbook, source) {
  const [works, records, users, clients] = await Promise.all([
    board.works(tenantId), repo.list(tenantId, 'work', null, { summary: true }), board.users(tenantId), board.clients(tenantId)
  ]);
  const byWork = new Map(records.map((record) => [record.id, record]));
  const candidates = works.filter((work) => !work.archivedAt);
  return workbook.rows.map((row) => {
    const matches = candidates.filter((work) => {
      const data = byWork.get(work.id)?.data;
      return (row.po && normalized(data?.po) === normalized(row.po) && normalized(work.customer || data?.sourceClient) === normalized(row.client)) ||
        (normalized(work.name) === normalized(row.name) && normalized(work.customer || data?.sourceClient) === normalized(row.client));
    });
    const existing = records.find((record) => record.data.importKeys?.includes(fingerprint(tenantId, source, row.no)));
    const checks = [...row.checks];
    if (row.owner && !uniqueByName(users, row.owner)) checks.push('Owner could not be matched to a tenant user');
    if (row.client && !uniqueByName(clients, row.client)) checks.push('Client will be retained as source text until matched');
    if (existing) checks.push('Already imported');
    return { ...row, importedId: existing?.id, matches: matches.map((work) => ({ id: work.id, name: work.name, workNumber: work.workNumber })), checks };
  });
}

async function ensureUnit(tenantId, name, config, settingsId) {
  if (!name) return '';
  for (let attempt = 0; attempt < 4; attempt++) {
    const settings = await config(tenantId);
    const match = uniqueByName(settings.data.units, name);
    if (match) return match.id;
    if (settings.data.units.length >= 200) fail('Business unit limit reached', 422);
    const unit = { id: fingerprint(tenantId, 'unit', normalized(name)), name, code: '', archived: false };
    if (settings.data.units.some((item) => item.id === unit.id || normalized(item.name) === normalized(name))) fail('Restore the archived business unit before importing', 409);
    try {
      await repo.save(tenantId, 'config', settingsId, settings.version, { ...settings.data, units: [...settings.data.units, unit] });
      return unit.id;
    } catch (error) {
      if (error.statusCode !== 409) throw error;
    }
  }
  fail('Business units changed during import. Retry the affected row.', 409);
}
async function ensureGroup(tenantId, name) {
  if (!name) return '';
  const groups = await repo.list(tenantId, 'group');
  const named = groups.filter((group) => normalized(group.data.name) === normalized(name));
  if (named.length === 1 && !named[0].data.archived) return named[0].id;
  if (named.length) fail('Resolve the matching project group before importing', 409);
  const id = fingerprint(tenantId, 'group', normalized(name));
  try { await repo.save(tenantId, 'group', id, 0, { name, archived: false }); }
  catch (error) { if (error.statusCode !== 409) throw error; }
  return id;
}
async function applyRow(tenantId, actor, source, row, decision, dependencies) {
  const importKey = fingerprint(tenantId, source, row.no);
  const deterministicId = fingerprint(tenantId, 'work-import', importKey);
  const requestedWorkId = decision.workId || deterministicId;
  const currentLink = await repo.get(tenantId, 'importLink', importKey);
  if (currentLink && currentLink.data.workId !== requestedWorkId) fail('This source row is already assigned to a different work', 409);
  const [existing, refs, existingRecord] = await Promise.all([
    board.work(tenantId, requestedWorkId), dependencies.references(), repo.get(tenantId, 'work', requestedWorkId)
  ]);
  if (existingRecord?.data.importKeys?.includes(importKey)) return requestedWorkId;
  if (decision.workId && (!existing || existing.archivedAt)) fail('Selected work is unavailable', 404);
  if (!decision.workId && !row.currency && [row.amount, row.invoiced, row.paid].some((value) => value != null)) fail('Assign a currency in Excel before importing this amount');
  if (row.sharepoint) url(row.sharepoint);
  if (existing && row.currency && row.currency !== existing.currency &&
      [row.amount, row.invoiced, row.paid].some((value) => value != null)) fail('Selected work uses a different currency', 409);
  if (!currentLink) {
    try { await repo.save(tenantId, 'importLink', importKey, 0, { workId: requestedWorkId }); }
    catch (error) {
      if (error.statusCode !== 409) throw error;
      const winner = await repo.get(tenantId, 'importLink', importKey);
      if (winner?.data.workId !== requestedWorkId) fail('Another import assigned this source row to a different work', 409);
    }
  }
  const owner = uniqueByName(refs.users, row.owner);
  const client = uniqueByName(refs.clients, row.client);
  const backup = uniqueByName(refs.users, row.backup);
  const actionOwner = uniqueByName(refs.users, row.actionOwner);
  const unitId = await ensureUnit(tenantId, row.unit, dependencies.config, 'settings');
  const groupId = await ensureGroup(tenantId, row.group);
  const serviceId = uniqueByName(refs.settings.data.services, row.service)?.id || '';
  if (!existing) {
    const input = { name: row.name, customer: client?.name || row.client, clientId: client?.id, responsible: owner?.name || '',
      responsibleUserId: owner?.id, status: row.status, statusReason: ['cancelled', 'lost'].includes(row.status) ? row.remarks.slice(0, 1000) : '', deadline: row.deadline, currency: row.currency || 'EUR',
      totalAmount: row.amount ?? 0, description: row.remarks };
    try {
      if (databaseEngine() === 'postgresql') await pg.createWork(tenantId, actor, input, { workId: deterministicId });
      else await createTrackerImportWork(tenantId, actor, deterministicId, input);
    } catch (error) {
      if (!['23505', 11000].includes(error.code) || !await board.work(tenantId, deterministicId)) throw error;
    }
  }
  const old = existingRecord?.data || {};
  const taskId = fingerprint(tenantId, 'import-action', importKey);
  const sourceNotes = [row.remarks, row.owner && !owner ? `Source owner: ${row.owner}` : '',
    row.backup && !backup ? `Source backup: ${row.backup}` : '',
    row.actionOwner && !actionOwner ? `Source action owner: ${row.actionOwner}` : '',
    row.service && !serviceId ? `Source service: ${row.service}` : ''].filter(Boolean).join('\n');
  const data = { ...old,
    unitId: old.unitId || unitId, groupId: old.groupId || groupId, serviceId: old.serviceId || serviceId,
    backupId: old.backupId || (backup?.id !== (existing?.responsibleUserId || owner?.id) ? backup?.id : '') || '',
    po: old.po || row.po, priority: old.priority || (['High', 'Medium', 'Low'].includes(row.priority) ? row.priority : ''),
    sourceClient: old.sourceClient || row.client, start: old.start || row.start, reviewedOn: old.reviewedOn || row.reviewed,
    sharepoint: old.sharepoint || row.sharepoint, remarks: old.remarks || sourceNotes,
    contractUnknown: old.contractUnknown ?? (!decision.workId && row.amount == null),
    amountConfirmed: old.amountConfirmed ?? (!decision.workId && row.amount != null),
    importKeys: [...(old.importKeys || []), importKey],
    audit: [...(old.audit || []).slice(-199), { at: new Date().toISOString(), actor, action: 'Excel import', details: row.no }]
  };
  if (row.action) {
    data.tasks = [...(old.tasks || []), { id: taskId, title: row.action, ownerId: actionOwner?.id || '', due: row.actionDue, done: false }];
    data.nextTaskId ||= taskId;
  }
  if ((row.invoiced != null || row.paid != null || row.paymentStatus) && !old.opening) {
    const zeroPaid = row.paid == null && ['Not Invoiced', 'Invoiced'].includes(row.paymentStatus);
    data.opening = { invoicedCents: row.invoiced == null ? (row.paymentStatus === 'Not Invoiced' ? 0 : null) : cents(row.invoiced),
      paidCents: zeroPaid ? 0 : row.paid == null ? null : cents(row.paid), due: row.paymentDue,
      issued: row.invoiceDate, sourceStatus: row.paymentStatus, confirmed: false };
  }
  try { await repo.save(tenantId, 'work', requestedWorkId, existingRecord?.version || 0, data); }
  catch (error) {
    if (error.statusCode !== 409 || !(await repo.get(tenantId, 'work', requestedWorkId))?.data.importKeys?.includes(importKey)) throw error;
  }
  return requestedWorkId;
}

async function applyIssues(tenantId, actor, source, workbook, users) {
  const sourceKeys = workbook.rows.map((row) => fingerprint(tenantId, source, row.no));
  const links = await repo.list(tenantId, 'importLink', sourceKeys);
  const records = await repo.list(tenantId, 'work', [...new Set(links.map((link) => link.data.workId))], { summary: true });
  const importedKeys = new Set(records.flatMap((record) => record.data.importKeys || []));
  if (sourceKeys.some((key) => !importedKeys.has(key))) fail('Import or link all source rows before importing the open questions', 409);
  const entries = new Map(links.map((link) => [link.id, link.data.workId]));
  let imported = 0;
  for (const issue of workbook.issues) {
    const id = fingerprint(tenantId, source, 'question', issue.no);
    const matched = workbook.rows.filter((row) => normalized(row.name) === normalized(issue.project) ||
      normalized(row.client) === normalized(issue.project));
    const workId = matched.length === 1 ? entries.get(fingerprint(tenantId, source, matched[0].no)) || '' : '';
    const data = { workId, title: issue.project || `Imported question ${issue.no}`,
      description: [issue.finding, issue.action, issue.ask && `Source assignee: ${issue.ask}`].filter(Boolean).join('\n'),
      ownerId: uniqueByName(users, issue.ask)?.id || '', closed: issue.closed,
      source: `${source} / ${issue.no}`, updatedAt: new Date().toISOString(), updatedBy: actor };
    try { await repo.save(tenantId, 'issue', id, 0, data); imported++; }
    catch (error) { if (error.statusCode !== 409) throw error; }
  }
  return imported;
}
module.exports = { preview, applyRow, applyIssues, normalized };
