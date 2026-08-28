const mongoose = require('mongoose');
const { WorkItem, WORK_STATUSES } = require('../models/workItem');
const SubWorkItem = require('../models/subWorkItem');
const ClientCompany = require('../models/clientCompany');
const User = require('../models/user');

const TERMINAL_STATUSES = new Set(['completed_billable', 'invoiced', 'paid', 'closed', 'cancelled']);

function scopeQuery(scope) {
  return scope?.tenantId ? { tenantId: scope.tenantId } : { tenantId: null };
}

function cleanText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function cleanLongText(value) {
  return String(value || '').trim();
}

function normalizeTaxNumber(value) {
  return String(value || '').trim().toUpperCase().replace(/[^0-9A-Z]/g, '');
}

function presentClient(client) {
  return {
    id: String(client._id), taxNumber: client.taxNumber, name: client.name, country: client.country || 'HU',
    postalCode: client.postalCode || '', city: client.city || '', address: client.address || '',
    email: client.email || '', phone: client.phone || ''
  };
}

function presentUser(user) {
  return {
    id: String(user._id),
    fullName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email,
    email: user.email || ''
  };
}

function numberValue(value, fallback = 0) {
  if (value === '' || value === null || value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalDate(value) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function httpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function validateStatus(value) {
  const status = String(value || 'inquiry');
  if (!WORK_STATUSES.includes(status)) throw httpError('Invalid work status');
  return status;
}

function workPayload(body, existing = {}) {
  const name = cleanText(body?.name ?? existing.name);
  if (!name) throw httpError('Work name is required');
  return {
    name,
    customer: cleanText(body?.customer ?? existing.customer),
    responsible: cleanText(body?.responsible ?? existing.responsible),
    contributors: Array.isArray(body?.contributors) ? body.contributors.map(cleanText).filter(Boolean) : (existing.contributors || []),
    status: validateStatus(body?.status ?? existing.status),
    deadline: optionalDate(body?.deadline ?? existing.deadline),
    description: cleanLongText(body?.description ?? existing.description),
    currency: cleanText(body?.currency ?? existing.currency ?? 'HUF').toUpperCase() || 'HUF',
    totalAmount: Math.max(0, numberValue(body?.totalAmount, existing.totalAmount || 0)),
    costAmount: Math.max(0, numberValue(body?.costAmount, existing.costAmount || 0)),
    subcontractor: cleanText(body?.subcontractor ?? existing.subcontractor),
    paymentDeadlineDays: Math.max(0, numberValue(body?.paymentDeadlineDays, existing.paymentDeadlineDays ?? 30)),
    offerDate: optionalDate(body?.offerDate ?? existing.offerDate),
    completionDate: optionalDate(body?.completionDate ?? existing.completionDate),
    invoiceDate: optionalDate(body?.invoiceDate ?? existing.invoiceDate),
    invoicePaymentDeadline: optionalDate(body?.invoicePaymentDeadline ?? existing.invoicePaymentDeadline),
    invoiceNumber: cleanText(body?.invoiceNumber ?? existing.invoiceNumber),
    contractSigned: Boolean(body?.contractSigned ?? existing.contractSigned),
    performanceCertificate: Boolean(body?.performanceCertificate ?? existing.performanceCertificate)
  };
}

function subWorkPayload(body, work, existing = {}) {
  const name = cleanText(body?.name ?? existing.name);
  if (!name) throw httpError('Sub-work name is required');
  const currency = cleanText(body?.currency ?? existing.currency ?? work.currency).toUpperCase() || work.currency;
  if (currency !== work.currency) throw httpError('Sub-work currency must match the work currency');
  return {
    name,
    description: cleanLongText(body?.description ?? existing.description),
    responsible: cleanText(body?.responsible ?? existing.responsible),
    contributors: Array.isArray(body?.contributors) ? body.contributors.map(cleanText).filter(Boolean) : (existing.contributors || []),
    status: validateStatus(body?.status ?? existing.status),
    deadline: optionalDate(body?.deadline ?? existing.deadline),
    completedAt: optionalDate(body?.completedAt ?? existing.completedAt),
    plannedHours: Math.max(0, numberValue(body?.plannedHours, existing.plannedHours || 0)),
    amount: Math.max(0, numberValue(body?.amount, existing.amount || 0)),
    currency,
    performanceCertificateRequired: Boolean(body?.performanceCertificateRequired ?? existing.performanceCertificateRequired),
    performanceCertificateSigned: Boolean(body?.performanceCertificateSigned ?? existing.performanceCertificateSigned),
    invoiceNumber: cleanText(body?.invoiceNumber ?? existing.invoiceNumber),
    invoiceDate: optionalDate(body?.invoiceDate ?? existing.invoiceDate),
    invoicePaymentDeadline: optionalDate(body?.invoicePaymentDeadline ?? existing.invoicePaymentDeadline),
    paidAmount: Math.max(0, numberValue(body?.paidAmount, existing.paidAmount || 0)),
    paidAt: optionalDate(body?.paidAt ?? existing.paidAt)
  };
}

function presentSubWork(subWork, work) {
  const total = Number(work.totalAmount || 0);
  const amount = Number(subWork.amount || 0);
  return {
    id: String(subWork._id),
    workItemId: String(subWork.workItemId),
    sequenceNumber: subWork.sequenceNumber,
    subWorkNumber: `${work.workNumber}/${String(subWork.sequenceNumber).padStart(2, '0')}`,
    name: subWork.name,
    description: subWork.description || '',
    responsible: subWork.responsible || '',
    responsibleUserId: subWork.responsibleUserId ? String(subWork.responsibleUserId) : null,
    contributors: subWork.contributors || [],
    status: subWork.status,
    deadline: subWork.deadline || null,
    completedAt: subWork.completedAt || null,
    plannedHours: Number(subWork.plannedHours || 0),
    amount,
    currency: subWork.currency || work.currency,
    percentage: total > 0 ? (amount / total) * 100 : 0,
    performanceCertificateRequired: Boolean(subWork.performanceCertificateRequired),
    performanceCertificateSigned: Boolean(subWork.performanceCertificateSigned),
    invoiceNumber: subWork.invoiceNumber || '',
    invoiceDate: subWork.invoiceDate || null,
    invoicePaymentDeadline: subWork.invoicePaymentDeadline || null,
    paidAmount: Number(subWork.paidAmount || 0),
    paidAt: subWork.paidAt || null,
    createdAt: subWork.createdAt,
    updatedAt: subWork.updatedAt
  };
}

function presentWork(work, subWorks = []) {
  const activeSubWorks = subWorks.filter((item) => !item.archivedAt && item.status !== 'cancelled');
  const allocatedAmount = activeSubWorks.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const totalAmount = Number(work.totalAmount || 0);
  const paidAmount = activeSubWorks.reduce((sum, item) => sum + Number(item.paidAmount || 0), 0);
  return {
    id: String(work._id),
    workNumber: work.workNumber,
    year: work.year,
    sequenceNumber: work.sequenceNumber,
    name: work.name,
    customer: work.customer || '',
    clientId: work.clientId ? String(work.clientId) : null,
    responsible: work.responsible || '',
    responsibleUserId: work.responsibleUserId ? String(work.responsibleUserId) : null,
    contributors: work.contributors || [],
    status: work.status,
    deadline: work.deadline || null,
    description: work.description || '',
    currency: work.currency || 'HUF',
    totalAmount,
    costAmount: Number(work.costAmount || 0),
    marginPercent: totalAmount > 0 ? ((totalAmount - Number(work.costAmount || 0)) / totalAmount) * 100 : 0,
    allocatedAmount,
    allocatedPercentage: totalAmount > 0 ? (allocatedAmount / totalAmount) * 100 : 0,
    remainingAmount: totalAmount - allocatedAmount,
    paidAmount,
    subcontractor: work.subcontractor || '',
    paymentDeadlineDays: Number(work.paymentDeadlineDays || 0),
    offerDate: work.offerDate || null,
    completionDate: work.completionDate || null,
    invoiceDate: work.invoiceDate || null,
    invoicePaymentDeadline: work.invoicePaymentDeadline || null,
    invoiceNumber: work.invoiceNumber || '',
    contractSigned: Boolean(work.contractSigned),
    performanceCertificate: Boolean(work.performanceCertificate),
    archivedAt: work.archivedAt || null,
    subWorkCount: activeSubWorks.length,
    subWorks: activeSubWorks.map((item) => presentSubWork(item, work)),
    createdAt: work.createdAt,
    updatedAt: work.updatedAt
  };
}

async function scopedWork(id, scope) {
  if (!mongoose.isValidObjectId(id)) throw httpError('Work not found', 404);
  const work = await WorkItem.findOne({ _id: id, ...scopeQuery(scope), archivedAt: { $exists: false } });
  if (!work) throw httpError('Work not found', 404);
  return work;
}

async function resolveClient(clientId, scope) {
  if (!clientId) return null;
  if (!mongoose.isValidObjectId(clientId)) throw httpError('Client not found', 404);
  const tenantId = scope?.tenantId || null;
  const client = await ClientCompany.findOne({ _id: clientId, tenantIds: tenantId });
  if (!client) throw httpError('Client is not available for this tenant', 404);
  return client;
}

async function resolveResponsible(userId, scope) {
  if (!userId) return null;
  if (!mongoose.isValidObjectId(userId)) throw httpError('Responsible user not found', 404);
  const user = await User.findOne({ _id: userId, tenantId: scope?.tenantId || null });
  if (!user) throw httpError('Responsible user is not a member of this tenant', 404);
  return user;
}

function applyWorkReferences(target, client, responsibleUser) {
  target.clientId = client?._id || undefined;
  target.customer = client?.name || '';
  target.responsibleUserId = responsibleUser?._id || undefined;
  target.responsible = responsibleUser ? presentUser(responsibleUser).fullName : '';
}

function applySubWorkResponsible(target, responsibleUser) {
  target.responsibleUserId = responsibleUser?._id || undefined;
  target.responsible = responsibleUser ? presentUser(responsibleUser).fullName : '';
}

async function withErrors(res, fn) {
  try {
    await fn();
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ error: 'Work number already exists; please try again' });
    return res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Internal server error' });
  }
}

exports.listWorks = (req, res) => withErrors(res, async () => {
  const query = { ...scopeQuery(req.scope), archivedAt: { $exists: false } };
  if (req.query?.active === 'true') query.status = { $nin: [...TERMINAL_STATUSES] };
  const works = await WorkItem.find(query).sort({ status: 1, deadline: 1, updatedAt: -1 });
  const subWorks = await SubWorkItem.find({ ...scopeQuery(req.scope), workItemId: { $in: works.map((work) => work._id) }, archivedAt: { $exists: false } }).sort({ sequenceNumber: 1 });
  const byWork = new Map();
  subWorks.forEach((item) => {
    const key = String(item.workItemId);
    if (!byWork.has(key)) byWork.set(key, []);
    byWork.get(key).push(item);
  });
  res.json({ works: works.map((work) => presentWork(work, byWork.get(String(work._id)) || [])) });
});

exports.activeOptions = (req, res) => withErrors(res, async () => {
  const works = await WorkItem.find({ ...scopeQuery(req.scope), archivedAt: { $exists: false }, status: { $nin: [...TERMINAL_STATUSES] } }).sort({ workNumber: -1 });
  const subWorks = await SubWorkItem.find({ ...scopeQuery(req.scope), workItemId: { $in: works.map((work) => work._id) }, archivedAt: { $exists: false }, status: { $nin: [...TERMINAL_STATUSES] } }).sort({ sequenceNumber: 1 });
  const byWork = new Map();
  subWorks.forEach((item) => {
    const key = String(item.workItemId);
    if (!byWork.has(key)) byWork.set(key, []);
    byWork.get(key).push({ id: String(item._id), sequenceNumber: item.sequenceNumber, subWorkNumber: '', name: item.name, status: item.status });
  });
  res.json({
    works: works.map((work) => ({
      id: String(work._id), workNumber: work.workNumber, name: work.name, customer: work.customer || '', status: work.status,
      subWorks: (byWork.get(String(work._id)) || []).map((item) => ({ ...item, subWorkNumber: `${work.workNumber}/${String(item.sequenceNumber).padStart(2, '0')}` }))
    }))
  });
});

exports.getWork = (req, res) => withErrors(res, async () => {
  const work = await scopedWork(req.params.id, req.scope);
  const subWorks = await SubWorkItem.find({ ...scopeQuery(req.scope), workItemId: work._id, archivedAt: { $exists: false } }).sort({ sequenceNumber: 1 });
  res.json({ work: presentWork(work, subWorks) });
});

exports.createWork = (req, res) => withErrors(res, async () => {
  const payload = workPayload(req.body);
  const client = await resolveClient(req.body?.clientId, req.scope);
  const responsibleUser = await resolveResponsible(req.body?.responsibleUserId, req.scope);
  const year = Math.max(2000, Math.min(9999, numberValue(req.body?.year, new Date().getFullYear())));
  const latest = await WorkItem.findOne({ ...scopeQuery(req.scope), year }).sort({ sequenceNumber: -1 }).select('sequenceNumber').lean();
  const sequenceNumber = Number(latest?.sequenceNumber || 0) + 1;
  const work = await WorkItem.create({
    ...payload, ...scopeQuery(req.scope), year, sequenceNumber,
    workNumber: `${String(year).slice(-2)}-${String(sequenceNumber).padStart(4, '0')}`,
    createdBy: req.userId, updatedBy: req.userId
  });
  applyWorkReferences(work, client, responsibleUser);
  await work.save();
  res.status(201).json({ work: presentWork(work, []) });
});

exports.updateWork = (req, res) => withErrors(res, async () => {
  const work = await scopedWork(req.params.id, req.scope);
  Object.assign(work, workPayload(req.body, work), { updatedBy: req.userId });
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'clientId')) {
    const client = await resolveClient(req.body.clientId, req.scope);
    work.clientId = client?._id || undefined;
    work.customer = client?.name || '';
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'responsibleUserId')) {
    const responsibleUser = await resolveResponsible(req.body.responsibleUserId, req.scope);
    work.responsibleUserId = responsibleUser?._id || undefined;
    work.responsible = responsibleUser ? presentUser(responsibleUser).fullName : '';
  }
  await work.save();
  const subWorks = await SubWorkItem.find({ ...scopeQuery(req.scope), workItemId: work._id, archivedAt: { $exists: false } }).sort({ sequenceNumber: 1 });
  res.json({ work: presentWork(work, subWorks) });
});

exports.archiveWork = (req, res) => withErrors(res, async () => {
  const work = await scopedWork(req.params.id, req.scope);
  work.archivedAt = new Date();
  work.updatedBy = req.userId;
  await work.save();
  await SubWorkItem.updateMany({ ...scopeQuery(req.scope), workItemId: work._id }, { $set: { archivedAt: work.archivedAt, updatedBy: req.userId } });
  res.status(204).end();
});

exports.createSubWork = (req, res) => withErrors(res, async () => {
  const work = await scopedWork(req.params.id, req.scope);
  const latest = await SubWorkItem.findOne({ ...scopeQuery(req.scope), workItemId: work._id }).sort({ sequenceNumber: -1 }).select('sequenceNumber').lean();
  const subWork = await SubWorkItem.create({
    ...subWorkPayload(req.body, work), ...scopeQuery(req.scope), workItemId: work._id,
    sequenceNumber: Number(latest?.sequenceNumber || 0) + 1,
    createdBy: req.userId, updatedBy: req.userId
  });
  applySubWorkResponsible(subWork, await resolveResponsible(req.body?.responsibleUserId, req.scope));
  await subWork.save();
  res.status(201).json({ subWork: presentSubWork(subWork, work) });
});

exports.updateSubWork = (req, res) => withErrors(res, async () => {
  if (!mongoose.isValidObjectId(req.params.subWorkId)) throw httpError('Sub-work not found', 404);
  const subWork = await SubWorkItem.findOne({ _id: req.params.subWorkId, ...scopeQuery(req.scope), archivedAt: { $exists: false } });
  if (!subWork) throw httpError('Sub-work not found', 404);
  const work = await scopedWork(subWork.workItemId, req.scope);
  Object.assign(subWork, subWorkPayload(req.body, work, subWork), { updatedBy: req.userId });
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'responsibleUserId')) {
    applySubWorkResponsible(subWork, await resolveResponsible(req.body.responsibleUserId, req.scope));
  }
  await subWork.save();
  res.json({ subWork: presentSubWork(subWork, work) });
});

exports.archiveSubWork = (req, res) => withErrors(res, async () => {
  if (!mongoose.isValidObjectId(req.params.subWorkId)) throw httpError('Sub-work not found', 404);
  const subWork = await SubWorkItem.findOne({ _id: req.params.subWorkId, ...scopeQuery(req.scope), archivedAt: { $exists: false } });
  if (!subWork) throw httpError('Sub-work not found', 404);
  subWork.archivedAt = new Date();
  subWork.updatedBy = req.userId;
  await subWork.save();
  res.status(204).end();
});

exports.TERMINAL_STATUSES = TERMINAL_STATUSES;
exports._test = { normalizeTaxNumber, presentWork, presentSubWork, scopeQuery };

exports.listClients = (req, res) => withErrors(res, async () => {
  const clients = await ClientCompany.find({ tenantIds: req.scope?.tenantId || null }).sort({ name: 1 });
  res.json({ clients: clients.map(presentClient) });
});

exports.lookupClientByTaxNumber = (req, res) => withErrors(res, async () => {
  const normalizedTaxNumber = normalizeTaxNumber(req.query?.taxNumber);
  if (!normalizedTaxNumber) throw httpError('Tax number is required');
  const client = await ClientCompany.findOne({ normalizedTaxNumber });
  res.json({ client: client ? presentClient(client) : null, linked: Boolean(client?.tenantIds?.some((id) => String(id) === String(req.scope?.tenantId || ''))) });
});

exports.createOrLinkClient = (req, res) => withErrors(res, async () => {
  const normalizedTaxNumber = normalizeTaxNumber(req.body?.taxNumber);
  const name = cleanText(req.body?.name);
  if (!normalizedTaxNumber) throw httpError('Tax number is required');
  if (!name) throw httpError('Company name is required');
  const tenantId = req.scope?.tenantId || null;
  const existing = await ClientCompany.findOne({ normalizedTaxNumber });
  if (existing) {
    await ClientCompany.updateOne({ _id: existing._id }, { $addToSet: { tenantIds: tenantId }, $set: { updatedBy: req.userId } });
    existing.tenantIds = [...(existing.tenantIds || []), tenantId];
    return res.json({ client: presentClient(existing), matchedExisting: true });
  }
  try {
    const client = await ClientCompany.create({
      taxNumber: cleanText(req.body.taxNumber), normalizedTaxNumber, name,
      country: cleanText(req.body?.country || 'HU').toUpperCase(), postalCode: cleanText(req.body?.postalCode),
      city: cleanText(req.body?.city), address: cleanText(req.body?.address), email: cleanText(req.body?.email).toLowerCase(),
      phone: cleanText(req.body?.phone), tenantIds: [tenantId], createdBy: req.userId, updatedBy: req.userId
    });
    return res.status(201).json({ client: presentClient(client), matchedExisting: false });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const client = await ClientCompany.findOneAndUpdate({ normalizedTaxNumber }, { $addToSet: { tenantIds: tenantId } }, { new: true });
    return res.json({ client: presentClient(client), matchedExisting: true });
  }
});

exports.listTenantUsers = (req, res) => withErrors(res, async () => {
  const users = await User.find({ tenantId: req.scope?.tenantId || null }).sort({ lastName: 1, firstName: 1, email: 1 });
  res.json({ users: users.map(presentUser) });
});
