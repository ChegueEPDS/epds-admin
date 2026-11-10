const EffortProject = require('../models/effortProject');
const EffortTask = require('../models/effortTask');
const { WorkItem } = require('../models/workItem');
const SubWorkItem = require('../models/subWorkItem');
const User = require('../models/user');
const {
  httpError, applyTaskFields, setNetOverride, setStatus, checkStart, startTimer,
  stopTimer, stopByUser, presentTask, presentProject
} = require('../services/effortTaskState');

const configuredLimit = Number(process.env.EFFORT_EMBEDDED_SESSION_LIMIT || 100);
const sessionLimit = Number.isFinite(configuredLimit) ? Math.max(20, Math.floor(configuredLimit)) : 100;
const taskFields = (req, task) => applyTaskFields(task, req.body || {},
  (id) => User.findOne({ _id: id, ...scopeQuery(req.scope) }).select('firstName lastName email'));

const TERMINAL_WORK_STATUSES = ['completed_billable', 'invoiced', 'paid', 'closed', 'cancelled', 'lost'];

function scopeQuery(scope) {
  if (!scope?.tenantId) throw httpError('Tenant context is required', 403);
  return { tenantId: scope.tenantId };
}

function ownerScopeQuery(scope, userId) {
  return { ...scopeQuery(scope), createdBy: userId };
}

function normalizeText(input) {
  return String(input || '').trim().replace(/\s+/g, ' ');
}

function normalizeLongText(input) {
  return String(input || '').trim();
}

function requestLimit(value, fallback = 100, max = 200) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(1, Math.floor(parsed))) : fallback;
}

async function getScopedProject(projectId, scope, userId) {
  const project = await EffortProject.findOne({ _id: projectId, ...ownerScopeQuery(scope, userId) });
  if (!project) throw httpError('Project not found', 404);
  return project;
}

async function getScopedTask(taskId, scope, userId) {
  const task = await EffortTask.findOne({ _id: taskId, ...ownerScopeQuery(scope, userId) });
  if (!task) throw httpError('Task not found', 404);
  return task;
}

async function getActiveWorkItem(workItemId, scope) {
  if (!workItemId) return null;
  const work = await WorkItem.findOne({
    _id: workItemId,
    ...scopeQuery(scope),
    archivedAt: { $exists: false },
    status: { $nin: TERMINAL_WORK_STATUSES }
  });
  if (!work) throw httpError('Selected work is no longer active', 409);
  return work;
}

function setWorkReference(project, work) {
  if (!work) {
    project.workItemId = undefined;
    project.workItemSnapshot = undefined;
    return;
  }
  project.workItemId = work._id;
  project.workItemSnapshot = { workNumber: work.workNumber, name: work.name, customer: work.customer || '' };
}

async function getActiveSubWorkItem(subWorkItemId, project, scope) {
  if (!subWorkItemId) return null;
  if (!project.workItemId) throw httpError('Select a work before selecting a sub-work');
  const subWork = await SubWorkItem.findOne({
    _id: subWorkItemId,
    workItemId: project.workItemId,
    ...scopeQuery(scope),
    archivedAt: { $exists: false },
    status: { $nin: TERMINAL_WORK_STATUSES }
  });
  if (!subWork) throw httpError('Selected sub-work is no longer active', 409);
  return subWork;
}

function setSubWorkReference(task, subWork, project) {
  if (!subWork) {
    task.subWorkItemId = undefined;
    task.subWorkItemSnapshot = undefined;
    return;
  }
  const number = `${project.workItemSnapshot?.workNumber || ''}/${String(subWork.sequenceNumber).padStart(2, '0')}`;
  task.subWorkItemId = subWork._id;
  task.subWorkItemSnapshot = { subWorkNumber: number, name: subWork.name };
}

async function withErrors(res, fn) {
  try {
    await fn();
  } catch (err) {
    if (err?.code === 11000 && err?.keyPattern?.['activeTimer.userId']) {
      return res.status(409).json({ error: 'Only one timer can run for a user at a time' });
    }
    if (err.name === 'VersionError' || err.name === 'DocumentNotFoundError') {
      return res.status(409).json({ error: 'This task changed elsewhere. Refresh and try again.' });
    }
    res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Internal server error' });
  }
}

exports.listProjects = (req, res) => withErrors(res, async () => {
  const limit = requestLimit(req.query.limit);
  const query = EffortProject.find(ownerScopeQuery(req.scope, req.userId)).sort({ status: 1, updatedAt: -1 });
  const projects = await (req.query.board === '1' ? query : query.limit(limit));
  const projectIds = projects.map((project) => project._id);
  const tasks = await EffortTask.find({ ...ownerScopeQuery(req.scope, req.userId), projectId: { $in: projectIds } }).sort({ updatedAt: -1 });
  const tasksByProject = new Map();
  for (const task of tasks) {
    const key = String(task.projectId);
    if (!tasksByProject.has(key)) tasksByProject.set(key, []);
    tasksByProject.get(key).push(task);
  }
  const now = new Date();
  res.json(projects.map((project) => presentProject(project, tasksByProject.get(String(project._id)) || [], now, req.userId)));
});

exports.createProject = (req, res) => withErrors(res, async () => {
  const name = normalizeText(req.body?.name);
  if (!name) throw httpError('Project name is required');

  if (req.body?.workItemId) {
    const existing = await EffortProject.findOne({
      ...ownerScopeQuery(req.scope, req.userId), workItemId: req.body.workItemId
    }).sort({ status: -1, createdAt: 1 });
    if (existing) {
      const tasks = await EffortTask.find({ ...ownerScopeQuery(req.scope, req.userId), projectId: existing._id });
      return res.json(presentProject(existing, tasks, new Date(), req.userId));
    }
  }
  const work = await getActiveWorkItem(req.body?.workItemId, req.scope);
  const project = new EffortProject({
    name,
    normalizedName: name.toLowerCase(),
    customer: normalizeText(req.body?.customer),
    comment: normalizeLongText(req.body?.comment),
    tenantId: req.scope?.tenantId || null,
    createdBy: req.userId,
    updatedBy: req.userId
  });
  setWorkReference(project, work);
  await project.save();

  res.status(201).json(presentProject(project, [], new Date(), req.userId));
});

exports.getProject = (req, res) => withErrors(res, async () => {
  const project = await getScopedProject(req.params.id, req.scope, req.userId);
  const tasks = await EffortTask.find({ ...ownerScopeQuery(req.scope, req.userId), projectId: project._id }).sort({ status: 1, updatedAt: -1 });
  res.json(presentProject(project, tasks, new Date(), req.userId));
});

exports.updateProject = (req, res) => withErrors(res, async () => {
  const project = await getScopedProject(req.params.id, req.scope, req.userId);
  if (project.status === 'closed') throw httpError('Closed project must be reopened before editing');

  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'name')) {
    const name = normalizeText(req.body.name);
    if (!name) throw httpError('Project name is required');
    project.name = name;
    project.normalizedName = name.toLowerCase();
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'customer')) project.customer = normalizeText(req.body.customer);
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'comment')) project.comment = normalizeLongText(req.body.comment);
  if (Object.hasOwn(req.body || {}, 'workItemId') && String(req.body.workItemId || '') !== String(project.workItemId || '')) {
    const nextWork = await getActiveWorkItem(req.body.workItemId, req.scope);
    if (nextWork && await EffortProject.exists({ ...ownerScopeQuery(req.scope, req.userId), workItemId: nextWork._id })) {
      throw httpError('An effort project already exists for this work', 409);
    }
    const linkedTaskExists = await EffortTask.exists({
      ...ownerScopeQuery(req.scope, req.userId),
      projectId: project._id,
      subWorkItemId: { $exists: true }
    });
    if (linkedTaskExists) throw httpError('Remove sub-work links from effort tasks before changing the related work', 409);
    setWorkReference(project, nextWork);
  }
  project.updatedBy = req.userId;
  await project.save();

  const tasks = await EffortTask.find({ ...ownerScopeQuery(req.scope, req.userId), projectId: project._id }).sort({ status: 1, updatedAt: -1 });
  res.json(presentProject(project, tasks, new Date(), req.userId));
});

exports.deleteProject = (req, res) => withErrors(res, async () => {
  const project = await getScopedProject(req.params.id, req.scope, req.userId);
  await EffortTask.deleteMany({ ...ownerScopeQuery(req.scope, req.userId), projectId: project._id });
  await EffortProject.deleteOne({ _id: project._id, ...ownerScopeQuery(req.scope, req.userId) });
  res.status(204).end();
});

exports.closeProject = (req, res) => withErrors(res, async () => {
  const project = await getScopedProject(req.params.id, req.scope, req.userId);
  if (project.status === 'closed') {
    const tasks = await EffortTask.find({ ...ownerScopeQuery(req.scope, req.userId), projectId: project._id }).sort({ status: 1, updatedAt: -1 });
    return res.json(presentProject(project, tasks, new Date(), req.userId));
  }

  const now = new Date();
  const tasks = await EffortTask.find({ ...ownerScopeQuery(req.scope, req.userId), projectId: project._id }).sort({ status: 1, updatedAt: -1 });
  for (const task of tasks) {
    if (task.status === 'closed') continue;
    setStatus(task, 'closed', req.userId, now, sessionLimit);
    task.updatedBy = req.userId;
    await task.save();
  }
  project.status = 'closed';
  project.closedAt = now;
  project.closedNetMs = tasks.reduce((total, task) => total + Number(task.closedNetMs || 0), 0);
  project.closedGrossMs = tasks.reduce((total, task) => total + Number(task.closedGrossMs || 0), 0);
  project.closedBy = req.userId;
  project.updatedBy = req.userId;
  await project.save();

  res.json(presentProject(project, tasks, now, req.userId));
});

exports.reopenProject = (req, res) => withErrors(res, async () => {
  const project = await getScopedProject(req.params.id, req.scope, req.userId);
  project.status = 'open';
  project.closedAt = undefined;
  project.closedNetMs = 0;
  project.closedGrossMs = 0;
  project.closedBy = undefined;
  project.updatedBy = req.userId;
  await project.save();

  const tasks = await EffortTask.find({ ...ownerScopeQuery(req.scope, req.userId), projectId: project._id }).sort({ status: 1, updatedAt: -1 });
  res.json(presentProject(project, tasks, new Date(), req.userId));
});

exports.createTask = (req, res) => withErrors(res, async () => {
  const project = await getScopedProject(req.params.id, req.scope, req.userId);
  if (project.status === 'closed') throw httpError('Closed project must be reopened before adding tasks');

  const name = normalizeText(req.body?.name);
  if (!name) throw httpError('Task name is required');

  const subWork = await getActiveSubWorkItem(req.body?.subWorkItemId, project, req.scope);
  const task = new EffortTask({
    projectId: project._id,
    tenantId: req.scope?.tenantId || null,
    name,
    note: normalizeLongText(req.body?.note),
    createdBy: req.userId,
    updatedBy: req.userId
  });
  setSubWorkReference(task, subWork, project);
  await taskFields(req, task);
  await task.save();
  project.updatedBy = req.userId;
  await project.save();

  res.status(201).json(presentTask(task, new Date(), req.userId));
});

const updateTask = (req, res) => withErrors(res, async () => {
  const task = await getScopedTask(req.params.taskId, req.scope, req.userId);
  const project = await getScopedProject(task.projectId, req.scope, req.userId);
  if (project.status === 'closed') throw httpError('Closed project must be reopened before editing tasks');

  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'name')) {
    const name = normalizeText(req.body.name);
    if (!name) throw httpError('Task name is required');
    task.name = name;
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'note')) task.note = normalizeLongText(req.body.note);
  if (Object.hasOwn(req.body || {}, 'subWorkItemId') && String(req.body.subWorkItemId || '') !== String(task.subWorkItemId || '')) {
    setSubWorkReference(task, await getActiveSubWorkItem(req.body.subWorkItemId, project, req.scope), project);
  }
  await taskFields(req, task);
  const now = new Date();
  if (Object.hasOwn(req.body || {}, 'status')) setStatus(task, req.body.status, req.userId, now, sessionLimit);
  setNetOverride(task, req.body || {}, now);
  task.updatedBy = req.userId;
  await task.save();
  res.json(presentTask(task, now, req.userId));
});

exports.deleteTask = (req, res) => withErrors(res, async () => {
  const task = await getScopedTask(req.params.taskId, req.scope, req.userId);
  await getScopedProject(task.projectId, req.scope, req.userId);
  await EffortTask.deleteOne({ _id: task._id, ...ownerScopeQuery(req.scope, req.userId) });
  res.status(204).end();
});

exports.startTask = (req, res) => withErrors(res, async () => {
  const task = await getScopedTask(req.params.taskId, req.scope, req.userId);
  const project = await getScopedProject(task.projectId, req.scope, req.userId);
  if (project.status === 'closed') throw httpError('Closed project must be reopened before starting tasks');
  checkStart(task, req.userId);

  const now = new Date();
  const previous = await EffortTask.findOne({
    _id: { $ne: task._id }, ...scopeQuery(req.scope),
    'activeTimer.userId': req.userId, 'activeTimer.startedAt': { $exists: true }
  });
  if (previous) {
    stopTimer(previous, now, { sessionLimit });
    previous.updatedBy = req.userId;
    await previous.save();
  }
  startTimer(task, req.userId, now);
  task.updatedBy = req.userId;
  await task.save();
  res.json(presentTask(task, now, req.userId));
});

exports.stopTask = (req, res) => withErrors(res, async () => {
  const task = await getScopedTask(req.params.taskId, req.scope, req.userId);
  const now = new Date();
  stopByUser(task, req.userId, now, { pause: req.body?.pause === true, sessionLimit });
  task.updatedBy = req.userId;
  await task.save();
  res.json(presentTask(task, now, req.userId));
});

exports.updateTask = updateTask;
exports.closeTask = (req, res) => updateTask({ ...req, body: { status: 'closed' } }, res);

// MongoDB also runs on standalone servers. Serialize this owner's writes in
// the API process, with optimistic task versions guarding concurrent writers.
const pending = new Map();
for (const name of Object.keys(exports).filter((name) => !['listProjects', 'getProject'].includes(name))) {
  const handler = exports[name];
  exports[name] = async (req, res) => {
    const key = String(req.userId);
    const operation = (pending.get(key) || Promise.resolve()).then(() => handler(req, res));
    pending.set(key, operation);
    try {
      await operation;
    } finally {
      if (pending.get(key) === operation) pending.delete(key);
    }
  };
}
