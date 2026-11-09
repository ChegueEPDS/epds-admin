const express = require('express');
const multer = require('multer');
const { createHash } = require('node:crypto');
const spreadsheet = require('../services/projectTrackerWorkbook');
const importer = require('../services/projectTrackerImport');
const { randomUUID } = require('node:crypto');
const { requireAuth, requireTenantContext, requireTenantFeature } = require('../middlewares/authMiddleware');
const repo = require('../services/projectTrackerStore');
const board = require('../services/projectTrackerWorks');
const domain = require('../services/projectTrackerDomain');
const workController = require('../controllers/workBoardControllerFacade');
const { projectTrackerWorkPolicy } = require('../middlewares/projectTrackerWorkPolicy');
const { fail, string, date, choice, optionalRef, customValues, today, cents, url } = domain;

const router = express.Router();
const configId = 'settings';
const privileged = (req) => ['Admin', 'SuperAdmin'].includes(req.role);
const finance = (req) => ['Finance', 'SuperAdmin'].includes(req.role);
const scope = (req) => req.scope.tenantId;
const feature = (req, key, permission = 'enabled') => Boolean(req.scope.tenantFeatures?.[key]?.enabled &&
  (permission === 'enabled' || req.scope.tenantFeatures[key][permission]));
const editable = (req) => feature(req, 'projectTracker', 'edit');
const stamp = () => new Date().toISOString();
const wrap = (fn) => async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    await fn(req, res);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  }
};
const config = async (tenantId) => await repo.get(tenantId, 'config', configId) ||
  { id: configId, version: 0, data: domain.initial() };
const entry = async (tenantId, kind, id) => await repo.get(tenantId, kind, id) || { id, version: 0, data: {} };
const track = (req, res, next) => requireTenantFeature('projectTracker')(req, res, next);
const boardEdit = (req, res, next) => requireTenantFeature('workBoard', 'edit')(req, res, next);

router.use(['/work-fields', '/project-tracker'], requireAuth, requireTenantContext, requireTenantFeature('workBoard'));

function authorizedOperational(req, work, data) {
  return Boolean(work && (privileged(req) || work.responsibleUserId === req.userId || data.backupId === req.userId));
}
function appendAudit(data, req, action, details = '') {
  return [...(data.audit || []).slice(-199), { at: stamp(), actor: req.userId, action, details }];
}
function openingData(work, data) {
  if (data.opening || !['invoiced', 'paid'].includes(work.status) && !work.invoiceNumber && !work.invoiceDate && !work.legacyBilling) return data;
  return { ...data, opening: { invoicedCents: null, paidCents: work.legacyPaid ? cents(work.legacyPaid) : null,
    confirmed: false, sourceStatus: work.legacyBilling ? 'Legacy milestone billing' : work.status } };
}
async function references(req) {
  const tenantId = scope(req);
  const [settings, users, groups] = await Promise.all([config(tenantId), board.users(tenantId), repo.list(tenantId, 'group')]);
  return { settings, users, groups };
}
const publicConfig = (req, data) => {
  if (feature(req, 'projectTracker')) return data;
  return { ...data, fields: data.fields.filter((field) => ['work', 'subWork', 'client'].includes(field.target)),
    rates: [], services: [] };
};

router.get('/work-fields/settings', wrap(async (req, res) => {
  const { settings, users } = await references(req);
  res.json({ ...settings, data: publicConfig(req, settings.data), users, canConfigure: privileged(req) && feature(req, 'workBoard', 'edit'),
    tracker: feature(req, 'projectTracker'), canFinance: finance(req) && editable(req) });
}));
router.put('/work-fields/settings', boardEdit, wrap(async (req, res) => {
  if (!privileged(req)) fail('Tenant administration permission is required', 403);
  const tenantId = scope(req);
  const current = await config(tenantId);
  const supplied = domain.object(req.body.data);
  const allowed = feature(req, 'projectTracker') ? supplied : { ...current.data,
    units: supplied.units, fields: [...(supplied.fields || []).filter((field) => !['group', 'task'].includes(field.target)),
      ...current.data.fields.filter((field) => ['group', 'task'].includes(field.target))] };
  if (feature(req, 'projectTracker') && !finance(req) && JSON.stringify(current.data.rates) !== JSON.stringify(allowed.rates)) fail('Finance permission is required to edit FX rates', 403);
  const data = domain.settings(allowed, current.data);
  const saved = await repo.save(tenantId, 'config', configId, req.body.version, data);
  res.json({ ...saved, data: publicConfig(req, data) });
}));

router.get('/work-fields/works', wrap(async (req, res) => {
  const ids = String(req.query.ids || '').split(',').filter((id) => /^[a-f0-9]{24}$/i.test(id));
  domain.array(ids, 100);
  const [records, settings] = await Promise.all([repo.list(scope(req), 'work', ids), config(scope(req))]);
  const allowed = new Set(settings.data.fields.filter((field) => field.target === 'work' && field.locations.includes('boardList')).map((field) => field.id));
  res.json(records.map((record) => ({ id: record.id, version: record.version, data: { unitId: record.data.unitId || '',
    custom: Object.fromEntries(Object.entries(record.data.custom || {}).filter(([key]) => allowed.has(key))) } })));

}));
router.put('/project-tracker/rates', track, wrap(async (req, res) => {
  if (!editable(req) || !finance(req)) fail('Finance permission is required', 403);
  const tenantId = scope(req);
  const current = await config(tenantId);
  const data = domain.settings({ ...current.data, rates: req.body.rates }, current.data);
  res.json(await repo.save(tenantId, 'config', configId, req.body.version, data));
}));

router.get('/work-fields/:kind/:id', wrap(async (req, res) => {
  const { kind, id } = req.params;
  if (!await board.target(scope(req), kind, id)) fail('Record not found', 404);
  const [record, settings] = await Promise.all([entry(scope(req), kind, id), config(scope(req))]);
  const fields = settings.data.fields.filter((field) => field.target === kind &&
    field.locations.some((location) => !location.startsWith('tracker')));
  const allowed = new Set(fields.map((field) => field.id));
  const values = Object.fromEntries(Object.entries(record.data.custom || {}).filter(([key]) => allowed.has(key)));
  res.json({ id, version: record.version, data: { unitId: record.data.unitId || '', custom: values } });

}));
router.patch('/work-fields/:kind/:id', boardEdit, wrap(async (req, res) => {
  const tenantId = scope(req);
  const { kind, id } = req.params;
  const target = await board.target(tenantId, kind, id);
  if (!target || target.archivedAt) fail('Record not found', 404);
  const [settings, users, record] = await Promise.all([config(tenantId), board.users(tenantId), entry(tenantId, kind, id)]);
  if (feature(req, 'projectTracker') && kind !== 'client') {
    const work = kind === 'work' ? target : await board.work(tenantId, target.workItemId);
    const workRecord = kind === 'work' ? record : await entry(tenantId, 'work', target.workItemId);
    if (!authorizedOperational(req, work, workRecord.data)) fail('Work editor permission is required', 403);
  }
  const location = { work: 'boardEditor', subWork: 'subWorkEditor', client: 'clientEditor' }[kind];
  const data = { ...record.data, custom: customValues(settings.data, kind, req.body.custom, record.data.custom, users, location) };
  if (kind === 'work' && Object.hasOwn(req.body, 'unitId')) data.unitId = optionalRef(req.body.unitId, settings.data.units, record.data.unitId);
  data.audit = appendAudit(record.data, req, 'Work fields updated');
  const saved = await repo.save(tenantId, kind, id, req.body.version, data);
  res.json({ id, version: saved.version, data: { unitId: data.unitId || '', custom: data.custom } });
}));

router.get('/project-tracker/references', track, wrap(async (req, res) => {
  const { settings, users, groups } = await references(req);
  res.json({ settings, users, groups, actor: req.userId, canConfigure: privileged(req), canEdit: editable(req),
    canFinance: finance(req) && editable(req), canImport: privileged(req) && editable(req) && feature(req, 'workBoard', 'edit') });
}));

async function portfolio(req) {
  const tenantId = scope(req);
  const [settings, works, records] = await Promise.all([config(tenantId), board.works(tenantId), repo.list(tenantId, 'work', null, { summary: true })]);
  const map = new Map(records.map((record) => [record.id, record.data]));
  const legacy = await board.legacyBilling(tenantId, works.filter((work) => !map.get(work.id)?.opening).map((work) => work.id));
  const asOf = today(settings.data.timezone);
  return { asOf, rows: works.filter((work) => !work.archivedAt || map.has(work.id)).map((work) =>
    domain.summarize(work, openingData({ ...work, ...legacy.get(work.id) }, map.get(work.id) || {}), settings.data, asOf)) };
}
router.get('/project-tracker/works', track, wrap(async (req, res) => {
  const { asOf, rows } = await portfolio(req);
  res.json({ asOf, rows });
}));
router.get('/project-tracker/works/:id', track, wrap(async (req, res) => {
  const tenantId = scope(req);
  const [work, record, settings] = await Promise.all([
    board.work(tenantId, req.params.id), entry(tenantId, 'work', req.params.id), config(tenantId)
  ]);
  if (!work) fail('Work not found', 404);
  const [legacy, subWorks] = await Promise.all([board.legacyBilling(tenantId, [work.id]), board.subWorks(tenantId, work.id)]);
  const data = openingData({ ...work, ...legacy.get(work.id) }, record.data);
  const asOf = today(settings.data.timezone);
  res.json({ ...record, data, work: domain.summarize(work, data, settings.data, asOf),
    canEdit: !work.archivedAt && editable(req) && authorizedOperational(req, work, data),
    canFinance: editable(req) && finance(req),
    canCompleteActions: editable(req), actor: req.userId, subWorks });
}));

router.patch('/project-tracker/works/:id/core', track, wrap(async (req, res) => {
  const tenantId = scope(req);
  const [work, record, users] = await Promise.all([board.work(tenantId, req.params.id),
    entry(tenantId, 'work', req.params.id), board.users(tenantId)]);
  if (!work || work.archivedAt) fail('Work not found', 404);
  if (!editable(req) || !authorizedOperational(req, work, record.data) || !feature(req, 'workBoard', 'edit')) fail('Work editor permission is required', 403);
  const input = req.body || {};
  const body = {};
  if (Object.hasOwn(input, 'status')) body.status = choice(input.status, domain.trackerStatuses);
  if (Object.hasOwn(input, 'statusReason')) body.statusReason = string(input.statusReason, 1000);
  if (Object.hasOwn(input, 'deadline')) body.deadline = date(input.deadline);
  if (Object.hasOwn(input, 'responsibleUserId')) {
    if (!privileged(req)) fail('Only tenant administrators can reassign a work', 403);
    body.responsibleUserId = optionalRef(input.responsibleUserId, users);
  }
  if (input.expectedUpdatedAt) body.expectedUpdatedAt = string(input.expectedUpdatedAt, 40, true);
  req.body = body;
  return projectTrackerWorkPolicy('workEdit')(req, res, (error) => {
    if (error) return res.status(500).json({ error: 'Work could not be updated' });
    return workController.updateWork(req, res);
  });
}));

router.patch('/project-tracker/works/:id', track, wrap(async (req, res) => {
  const tenantId = scope(req);
  const { id } = req.params;
  const [work, current, refs] = await Promise.all([board.work(tenantId, id), entry(tenantId, 'work', id), references(req)]);
  if (!work) fail('Work not found', 404);
  const legacy = current.data.opening ? new Map() : await board.legacyBilling(tenantId, [id]);
  const old = openingData({ ...work, ...legacy.get(id) }, current.data);
  const { version, action, value = {} } = req.body || {};
  domain.object(value);
  const actor = req.userId;
  const asOf = today(refs.settings.data.timezone);
  const data = structuredClone(old);
  let note = '';
  if (['invoice', 'payment', 'adjustment', 'void', 'opening', 'reconcile'].includes(action)) {
    if (!editable(req) || !finance(req)) fail('Finance permission is required', 403);
    if (work.archivedAt && action === 'invoice') fail('Restore the work before issuing a new invoice', 409);
    data.invoices ||= [];
    if (action === 'opening') {
      const invoicedCents = cents(value.invoiced);
      const paidCents = cents(value.paid);
      if (paidCents > invoicedCents) fail('Opening payment cannot exceed the opening invoice amount');
      data.opening = { ...old.opening, invoicedCents, paidCents, due: date(value.due), confirmed: true,
        sourceStatus: old.opening?.sourceStatus || '', confirmedBy: actor, confirmedAt: stamp() };
      if (domain.invoiceBalance(data.opening) < 0) fail('Opening balance is lower than recorded settlements');
    } else if (action === 'reconcile') {
      if (data.opening && !data.opening.confirmed) fail('Confirm the opening balance before reconciliation');
      data.reconciledOn = asOf;
      data.reconciledBy = actor;
    } else if (action === 'invoice') {
      if (data.invoices.length >= 200) fail('Invoice limit reached for this scope');
      const number = string(value.number, 100, true);
      if (data.invoices.some((invoice) => invoice.number === number && !invoice.voidedAt)) fail('Invoice already exists', 409);
      const issued = date(value.issued);
      const due = date(value.due);
      if (!issued || !due || due < issued) fail('An invoice requires a valid issue date and due date');
      const total = cents(value.amount);
      if (!total) fail('Invoice amount must be positive');
      const allocations = domain.array(value.allocations || [], 100);
      const ids = new Set();
      const entries = [];
      let allocated = 0;
      for (const item of allocations) {
        domain.object(item);
        const sub = await board.target(tenantId, 'subWork', item.subWorkId);
        if (!sub || sub.archivedAt || sub.workItemId !== work.id || ids.has(item.subWorkId)) fail('Invalid or repeated invoice milestone');
        ids.add(item.subWorkId);
        const value = cents(item.amount);
        if (!value) fail('Invoice milestone amount must be positive');
        allocated += value;
        entries.push({ subWorkId: item.subWorkId, cents: value });
      }
      if (allocated > total) fail('Milestone allocations exceed the invoice amount');
      data.invoices.push({ id: randomUUID(), number, issued, due, cents: total, currency: work.currency,
        allocations: entries, payments: [], adjustments: [], createdBy: actor, createdAt: stamp() });
      note = number;
    } else {
      const opening = value.invoiceId === 'opening';
      const invoice = opening ? data.opening : data.invoices.find((item) => item.id === value.invoiceId && !item.voidedAt);
      if (!invoice || (opening && !invoice.confirmed)) fail('Invoice or confirmed opening balance not found', 404);
      invoice.payments ||= [];
      invoice.adjustments ||= [];
      note = opening ? 'Opening balance' : invoice.number;
      if (action === 'void') {
        const target = value.paymentId ? invoice.payments.find((item) => item.id === value.paymentId)
          : value.adjustmentId ? invoice.adjustments?.find((item) => item.id === value.adjustmentId) : invoice;
        if (!target || target.voidedAt) fail('Entry not found', 404);
        if (target === invoice && opening) fail('Reconcile the opening balance instead of reversing it');
        if (target === invoice && [...invoice.payments, ...(invoice.adjustments || [])].some((item) => !item.voidedAt)) fail('Reverse payments and adjustments first');
        target.voidReason = string(value.reason, 500, true);
        target.voidedAt = stamp();
        target.voidedBy = actor;
      } else {
        const total = cents(value.amount);
        const received = date(value.date);
        if (!received || !total || total > domain.invoiceBalance(invoice)) fail('Enter a date and an amount within the outstanding invoice balance');
        if (action === 'payment') {
          if (invoice.payments.length >= 200) fail('Payment limit reached for this invoice');
          invoice.payments.push({ id: randomUUID(), date: received, cents: total, reference: string(value.reference, 100), createdAt: stamp(), createdBy: actor });
        } else {
          invoice.adjustments ||= [];
          if (invoice.adjustments.length >= 200) fail('Adjustment limit reached for this invoice');
          invoice.adjustments.push({ id: randomUUID(), date: received, cents: total, reason: string(value.reason, 500, true),
            kind: choice(value.kind, ['credit', 'writeOff']), createdAt: stamp(), createdBy: actor });
        }
      }
    }
  } else {
    const assignedTask = action === 'taskDone' && data.tasks?.some((task) => task.id === value.id && task.ownerId === actor);
    if (work.archivedAt || !editable(req) || (!assignedTask && !authorizedOperational(req, work, old))) fail('Work editor permission is required', 403);
    const settings = refs.settings.data;
    if (action === 'details') {
      data.unitId = optionalRef(value.unitId, settings.units, old.unitId);
      data.serviceId = optionalRef(value.serviceId, settings.services, old.serviceId);
      data.groupId = optionalRef(value.groupId, refs.groups.map((group) => ({ id: group.id, archived: group.data.archived })), old.groupId);
      data.backupId = optionalRef(value.backupId, refs.users, old.backupId);
      if (data.backupId && data.backupId === work.responsibleUserId) fail('Owner and backup must be different people');
      data.priority = choice(value.priority || '', ['', 'High', 'Medium', 'Low']);
      data.po = string(value.po, 120);
      data.start = date(value.start);
      data.sharepoint = url(value.sharepoint);
      data.remarks = string(value.remarks, 10000);
      data.risk = string(value.risk, 2000);
      if (value.amountConfirmed === true) {
        data.contractUnknown = false;
        data.amountConfirmed = true;
      }
      data.custom = customValues(settings, 'work', value.custom, old.custom, refs.users, 'trackerEditor');
    } else if (action === 'review') {
      data.reviewedOn = asOf;
      data.reviewedBy = actor;
    } else if (action === 'task') {
      data.tasks ||= [];
      const existing = value.id && data.tasks.find((task) => task.id === value.id && !task.done);
      if (value.id && !existing) fail('Open action not found', 404);
      if (!existing && data.tasks.length >= 250) fail('Action limit reached for this scope');
      const task = { id: existing?.id || randomUUID(), title: string(value.title, 500, true),
        ownerId: optionalRef(value.ownerId, refs.users, existing?.ownerId) || fail('An action owner is required'),
        due: date(value.due) || fail('An action deadline is required'), done: false,
        custom: customValues(settings, 'task', value.custom, existing?.custom, refs.users, 'taskEditor') };
      if (existing) Object.assign(existing, task);
      else data.tasks.push(task);
      if (value.next) data.nextTaskId = task.id;
      note = task.title;
    } else if (action === 'taskDone') {
      const task = data.tasks?.find((item) => item.id === value.id && !item.done);
      if (!task) fail('Open action not found', 404);
      task.done = true;
      task.completedAt = stamp();
      task.completedBy = actor;
      note = task.title;
    } else fail('Unknown action');
  }
  if (action !== 'review') data.materialAt = stamp();
  data.audit = appendAudit(old, req, action, note);
  if (Buffer.byteLength(JSON.stringify(data)) > 2000000) fail('This scope has reached its storage limit', 422);
  const saved = await repo.save(tenantId, 'work', id, version, data);
  res.json({ ...saved, work: domain.summarize(work, data, refs.settings.data, asOf) });
}));

router.put('/project-tracker/groups/:id', track, wrap(async (req, res) => {
  if (!editable(req) || !privileged(req)) fail('Tenant administration permission is required', 403);
  const tenantId = scope(req);
  const id = req.params.id === 'new' ? randomUUID() : domain.identifier(req.params.id);
  const [old, refs] = await Promise.all([entry(tenantId, 'group', id), references(req)]);
  const input = domain.object(req.body.data);
  const data = { name: string(input.name, 200, true), description: string(input.description, 4000),
    archived: input.archived === true, custom: customValues(refs.settings.data, 'group', input.custom, old.data.custom, refs.users, 'groupEditor') };
  res.json(await repo.save(tenantId, 'group', id, req.body.version, data));
}));

router.get('/project-tracker/issues', track, wrap(async (req, res) => {
  res.json(await repo.list(scope(req), 'issue'));
}));
router.put('/project-tracker/issues/:id', track, wrap(async (req, res) => {
  if (!editable(req)) fail('Project editor permission is required', 403);
  const tenantId = scope(req);
  const id = req.params.id === 'new' ? randomUUID() : domain.identifier(req.params.id);
  const [old, users] = await Promise.all([entry(tenantId, 'issue', id), board.users(tenantId)]);
  const input = domain.object(req.body.data);
  const work = input.workId ? await board.work(tenantId, input.workId) : null;
  if (input.workId && !work) fail('Work not found', 404);
  const workRecord = work && await entry(tenantId, 'work', work.id);
  if (!privileged(req) && !finance(req) && old.data.ownerId !== req.userId &&
    !(work && authorizedOperational(req, work, workRecord.data))) fail('Issue editor permission is required', 403);
  const data = { workId: work?.id || '', title: string(input.title, 250, true),
    description: string(input.description, 6000), ownerId: optionalRef(input.ownerId, users, old.data.ownerId),
    closed: input.closed === true, updatedAt: stamp(), updatedBy: req.userId, source: old.data.source || '' };
  res.json(await repo.save(tenantId, 'issue', id, req.body.version, data));
}));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2000000, files: 1, fields: 4, fieldSize: 500000 } });
const importAllowed = (req, res, next) => {
  if (!privileged(req) || !editable(req) || !feature(req, 'workBoard', 'edit')) return res.status(403).json({ error: 'Import permission is required' });
  next();
};
function uploadInfo(req) {
  if (!req.file?.buffer?.length || !/\.xlsx$/i.test(req.file.originalname)) fail('Upload a .xlsx workbook');
  const source = importer.normalized(string(req.body.source, 120, true));
  const hash = createHash('sha256').update(req.file.buffer).digest('hex');
  return { source, hash };
}
router.post('/project-tracker/import/preview', track, importAllowed, upload.single('file'), wrap(async (req, res) => {
  const { source, hash } = uploadInfo(req);
  const workbook = await spreadsheet.readWorkbook(req.file.buffer);
  res.json({ hash, rows: await importer.preview(scope(req), workbook, source), questions: workbook.issues.length });
}));
router.post('/project-tracker/import/apply', track, importAllowed, upload.single('file'), wrap(async (req, res) => {
  const { source, hash } = uploadInfo(req);
  if (req.body.hash !== hash) fail('The workbook changed after preview. Preview it again.', 409);
  let decisions;
  try { decisions = JSON.parse(req.body.decisions || '[]'); } catch { fail('Invalid import selections'); }
  domain.array(decisions, 50);
  const workbook = await spreadsheet.readWorkbook(req.file.buffer);
  const tenantId = scope(req);
  const [settings, users, clients] = await Promise.all([config(tenantId), board.users(tenantId), board.clients(tenantId)]);
  const refs = { settings, users, clients };
  const results = [];
  const seen = new Set();
  const byNumber = new Map(workbook.rows.map((row) => [row.no, row]));
  for (const decision of decisions) {
    domain.object(decision);
    if (!byNumber.has(decision.no) || seen.has(decision.no)) fail('Invalid or repeated source row selection');
    seen.add(decision.no);
    if (!decision.workId && decision.create !== true) fail('Choose a work or approve creating one');
  }
  for (const decision of decisions) {
    const row = byNumber.get(decision.no);
    try {
      const workId = await importer.applyRow(tenantId, req.userId, source, row, decision, { config, references: () => refs });
      results.push({ no: row.no, workId });
    } catch (error) {
      if (!error.statusCode) throw error;
      results.push({ no: row.no, error: error.message });
    }
  }
  const questions = req.body.questions === 'true' && !results.some((item) => item.error)
    ? await importer.applyIssues(tenantId, req.userId, source, workbook, users) : 0;
  res.json({ results, questions });
}));
router.get('/project-tracker/export', track, wrap(async (req, res) => {
  const [{ rows }, refs, issues] = await Promise.all([portfolio(req), references(req), repo.list(scope(req), 'issue')]);
  const workbook = await spreadsheet.exportWorkbook(rows, refs.settings.data, refs.groups, refs.users, issues);
  res.attachment('project-tracker.xlsx');
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  await workbook.xlsx.write(res);
  res.end();
}));

module.exports = { router, config, entry, wrap, portfolio, authorizedOperational };
