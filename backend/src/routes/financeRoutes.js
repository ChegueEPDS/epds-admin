const express = require('express');
const mongoose = require('mongoose');
const Tenant = require('../models/tenant');
const { WorkItem } = require('../models/workItem');
const { requireSessionAuth } = require('../middlewares/authMiddleware');
const { databaseEngine } = require('../postgres');
const tenants = require('../repositories/postgres/tenantRepository');
const works = require('../repositories/postgres/workBoardRepository');
const { workBoardSort, mongoSortStages } = require('../services/workBoardSort');
const { workReporting } = require('../services/workDashboard');
const { workBillingDates } = require('../services/workBillingDates');
const { markMongoDashboardDirty } = require('../services/workDashboardSnapshots');

const router = express.Router();
const statuses = ['completed_billable', 'invoiced', 'paid'];
const sorts = ['workNumber', 'name', 'status', 'totalAmount'];
const reportingFields = ['invoicedAmount', 'paidAmount', 'paymentStatus'];
const dateFields = ['completionDate', 'invoiceDate', 'invoicePaymentDeadline', 'paidAt'];
const editFields = ['fieldRevision', 'status', 'invoiceNumber', ...dateFields, 'reporting'];
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const objectId = (value) => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);
const pg = () => databaseEngine() === 'postgresql';
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const workNotFound = () => fail('A munka nem található.', 404);
const revisionConflict = () => fail('A munka időközben megváltozott. Frissítsd a táblát, majd próbáld újra.', 409);

function financeOnly(req, res, next) {
  if (req.role !== 'Finance' || req.user.tenantType !== 'finance') {
    return res.status(403).json({ error: 'Pénzügyi hozzáférés szükséges.' });
  }
  res.set('Cache-Control', 'no-store');
  next();
}

function eligible(tenant) {
  return tenant && tenant.type === 'company' && tenant.features?.workBoard?.enabled === true
    && tenant.features?.financeAccess?.enabled === true;
}

function presentTenant(tenant) {
  return { id: String(tenant._id), name: tenant.displayName || tenant.name };
}

function presentWork(work) {
  const reporting = Object.fromEntries(reportingFields.filter((key) => Object.hasOwn(work.reporting || {}, key))
    .map((key) => [key, work.reporting[key]]));
  return {
    id: String(work._id), workNumber: work.workNumber, name: work.name, customer: work.customer || '',
    status: work.status, currency: work.currency || 'HUF',
    totalAmount: Number(work.totalAmount || 0), completionDate: work.completionDate || null,
    invoiceNumber: work.invoiceNumber || '', invoiceDate: work.invoiceDate || null,
    invoicePaymentDeadline: work.invoicePaymentDeadline || null, paidAt: work.paidAt || null,
    paymentDeadlineDays: work.paymentDeadlineDays ?? 30,
    reporting, fieldRevision: work.fieldRevision ?? work.__v ?? 0
  };
}

const handle = (handler) => async (req, res, next) => {
  try { await handler(req, res); }
  catch (error) {
    if (error.name === 'VersionError') error = revisionConflict();
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  }
};

async function target(req) {
  const { tenantId } = req.params;
  if (!objectId(tenantId)) throw fail('A tenant nem érhető el.', 404);
  const tenant = pg() ? await tenants.findById(tenantId) : await Tenant.findById(tenantId).lean();
  if (!eligible(tenant)) throw fail('A tenant nem érhető el.', 404);
  return tenant;
}

const financeScope = (tenantId, allowedStatuses) => ({
  tenantId: new mongoose.Types.ObjectId(tenantId), archivedAt: { $exists: false }, status: { $in: allowedStatuses }
});

async function findWork(tenantId, id) {
  if (!objectId(id)) throw workNotFound();
  const work = pg() ? await works.findWork(tenantId, id, false, statuses)
    : await WorkItem.findOne({ ...financeScope(tenantId, statuses), _id: id });
  if (!work) throw workNotFound();
  return work;
}

function dateValue(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
    throw fail('Érvényes dátumot adj meg.');
  }
  return new Date(value);
}

async function billingChanges(input, work, tenant) {
  if (!object(input) || Object.keys(input).some((key) => !editFields.includes(key))) {
    throw fail('Csak pénzügyi mezők szerkeszthetők.');
  }
  if (!Number.isSafeInteger(input.fieldRevision) || input.fieldRevision !== (work.fieldRevision ?? work.__v ?? 0)) {
    throw revisionConflict();
  }
  const changes = {};
  if (Object.hasOwn(input, 'status')) {
    const current = statuses.indexOf(work.status);
    if (input.status !== work.status && input.status !== statuses[current + 1]) {
      throw fail('Csak a következő pénzügyi státusz választható.');
    }
    if (!statuses.includes(input.status)) throw fail('Érvénytelen pénzügyi státusz.');
    changes.status = input.status;
  }
  if (Object.hasOwn(input, 'invoiceNumber')) {
    if (typeof input.invoiceNumber !== 'string' || input.invoiceNumber.trim().length > 150) {
      throw fail('A számlaszám legfeljebb 150 karakter lehet.');
    }
    changes.invoiceNumber = input.invoiceNumber.trim();
  }
  for (const key of dateFields) {
    if (Object.hasOwn(input, key)) changes[key] = dateValue(input[key]);
  }
  if (Object.hasOwn(input, 'reporting')) {
    if (!object(input.reporting) || Object.keys(input.reporting).some((key) => !reportingFields.includes(key))) {
      throw fail('Csak pénzügyi mezők szerkeszthetők.');
    }
    changes.reporting = await workReporting(
      { body: { reporting: input.reporting }, scope: { tenantId: String(tenant._id), tenantType: tenant.type } },
      work.reporting || {}, false
    );
  }
  if (!Object.keys(changes).length) throw fail('Adj meg legalább egy pénzügyi mezőt.');
  return { ...changes, ...workBillingDates(changes, work) };
}

router.use('/finance', requireSessionAuth, financeOnly);

router.get('/finance/tenants', handle(async (_req, res) => {
  const candidates = pg() ? await tenants.list() : await Tenant.find({
    'features.workBoard.enabled': true, 'features.financeAccess.enabled': true
  }).select('name displayName type features.workBoard features.financeAccess').lean();
  res.json({ tenants: candidates.filter(eligible).map(presentTenant).sort((a, b) => a.name.localeCompare(b.name, 'hu')) });
}));

router.get('/finance/tenants/:tenantId/works', handle(async (req, res) => {
  const tenant = await target(req);
  const tenantId = String(tenant._id);
  const status = req.query.status ?? 'all';
  if (status !== 'all' && !statuses.includes(status)) throw fail('Érvénytelen pénzügyi státusz.');
  const allowedStatuses = status === 'all' ? statuses : [status];
  const page = Math.min(1000000, Math.max(1, Math.floor(Number(req.query.page) || 1)));
  const limit = Math.min(100, Math.max(1, Math.floor(Number(req.query.limit) || 25)));
  const sort = await workBoardSort(tenantId, { sort: sorts.includes(req.query.sort) ? req.query.sort : 'workNumber',
    direction: req.query.direction });
  const search = String(req.query.search || '').trim().slice(0, 200);
  let result;
  if (pg()) {
    result = await works.list({ tenantId, allowedStatuses, search, page, limit, sort });
  } else {
    const filter = financeScope(tenantId, allowedStatuses);
    if (search) {
      const pattern = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ workNumber: pattern }, { name: pattern }, { customer: pattern }];
    }
    const [rows, total] = await Promise.all([
      WorkItem.aggregate([{ $match: filter }, ...mongoSortStages(sort), { $skip: (page - 1) * limit }, { $limit: limit }]),
      WorkItem.countDocuments(filter)
    ]);
    result = { works: rows, total };
  }
  res.json({ tenant: presentTenant(tenant), works: result.works.map(presentWork),
    pagination: { page, limit, total: result.total, pages: Math.max(1, Math.ceil(result.total / limit)) } });
}));

router.get('/finance/tenants/:tenantId/works/:id', handle(async (req, res) => {
  const tenant = await target(req);
  res.json({ work: presentWork(await findWork(String(tenant._id), req.params.id)) });
}));

router.patch('/finance/tenants/:tenantId/works/:id', handle(async (req, res) => {
  const tenant = await target(req);
  const tenantId = String(tenant._id);
  const work = await findWork(tenantId, req.params.id);
  const changes = await billingChanges(req.body, work, tenant);
  let updated;
  if (pg()) {
    updated = await works.updateWork(tenantId, work.id, req.userId, changes, req.body.fieldRevision);
    if (!updated) throw revisionConflict();
  } else {
    Object.assign(work, changes, { updatedBy: req.userId });
    updated = await work.save();
    await markMongoDashboardDirty({ tenantId, tenantType: tenant.type });
  }
  console.info('[finance] updated work', {
    actorId: req.userId, tenantId, workId: String(work._id),
    fields: Object.keys(changes).filter((key) => key !== 'reporting')
      .concat(Object.keys(req.body.reporting || {}).map((key) => 'reporting.' + key))
  });
  res.json({ work: presentWork(updated) });
}));

module.exports = router;
