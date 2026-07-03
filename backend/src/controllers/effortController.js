const EffortProject = require('../models/effortProject');
const EffortTask = require('../models/effortTask');

function scopeQuery(scope) {
  return scope?.tenantId ? { tenantId: scope.tenantId } : { tenantId: null };
}

function normalizeText(input) {
  return String(input || '').trim().replace(/\s+/g, ' ');
}

function normalizeLongText(input) {
  return String(input || '').trim();
}

function httpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function msBetween(start, end) {
  const startMs = start ? new Date(start).getTime() : 0;
  const endMs = end ? new Date(end).getTime() : Date.now();
  if (!startMs || Number.isNaN(startMs) || Number.isNaN(endMs)) return 0;
  return Math.max(0, endMs - startMs);
}

function taskNetMs(task, now = new Date()) {
  const saved = (task.sessions || []).reduce((total, session) => total + Number(session.durationMs || 0), 0);
  if (task.activeTimer?.startedAt) return saved + msBetween(task.activeTimer.startedAt, now);
  return saved;
}

function taskGrossMs(task) {
  if (task.status !== 'closed') return 0;
  return Number(task.closedGrossMs || 0);
}

function presentTask(task, now = new Date()) {
  return {
    id: String(task._id),
    projectId: String(task.projectId),
    name: task.name,
    note: task.note || '',
    status: task.status,
    netMs: task.status === 'closed' ? Number(task.closedNetMs || 0) : taskNetMs(task, now),
    grossMs: taskGrossMs(task),
    active: Boolean(task.activeTimer?.startedAt),
    activeStartedAt: task.activeTimer?.startedAt || null,
    closedAt: task.closedAt || null,
    closedNetMs: Number(task.closedNetMs || 0),
    closedGrossMs: Number(task.closedGrossMs || 0),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt
  };
}

function projectGrossMs(project) {
  if (project.status !== 'closed') return 0;
  return Number(project.closedGrossMs || 0);
}

function presentProject(project, tasks = [], now = new Date()) {
  const presentedTasks = tasks.map((task) => presentTask(task, now));
  const netMs = project.status === 'closed'
    ? Number(project.closedNetMs || 0)
    : presentedTasks.reduce((total, task) => total + Number(task.netMs || 0), 0);

  return {
    id: String(project._id),
    name: project.name,
    customer: project.customer || '',
    comment: project.comment || '',
    status: project.status,
    netMs,
    grossMs: projectGrossMs(project),
    closedAt: project.closedAt || null,
    closedNetMs: Number(project.closedNetMs || 0),
    closedGrossMs: Number(project.closedGrossMs || 0),
    taskCount: presentedTasks.length,
    openTaskCount: presentedTasks.filter((task) => task.status === 'open').length,
    activeTaskCount: presentedTasks.filter((task) => task.active).length,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    tasks: presentedTasks
  };
}

async function getScopedProject(projectId, scope) {
  const project = await EffortProject.findOne({ _id: projectId, ...scopeQuery(scope) });
  if (!project) throw httpError('Project not found', 404);
  return project;
}

async function getScopedTask(taskId, scope) {
  const task = await EffortTask.findOne({ _id: taskId, ...scopeQuery(scope) });
  if (!task) throw httpError('Task not found', 404);
  return task;
}

function stopTaskTimer(task, now = new Date()) {
  if (!task.activeTimer?.startedAt || !task.activeTimer?.userId) return false;
  const durationMs = msBetween(task.activeTimer.startedAt, now);
  task.sessions.push({
    userId: task.activeTimer.userId,
    startedAt: task.activeTimer.startedAt,
    stoppedAt: now,
    durationMs
  });
  task.activeTimer = undefined;
  return true;
}

async function stopActiveTimersForUser(scope, userId, now, exceptTaskId = null) {
  const activeTasks = await EffortTask.find({
    ...scopeQuery(scope),
    'activeTimer.userId': userId,
    'activeTimer.startedAt': { $exists: true }
  });

  for (const task of activeTasks) {
    if (exceptTaskId && String(task._id) === String(exceptTaskId)) continue;
    if (stopTaskTimer(task, now)) {
      task.updatedBy = userId;
      await task.save();
    }
  }
}

async function withErrors(res, fn) {
  try {
    await fn();
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Internal server error' });
  }
}

exports.listProjects = (req, res) => withErrors(res, async () => {
  const projects = await EffortProject.find(scopeQuery(req.scope)).sort({ status: 1, updatedAt: -1 });
  const projectIds = projects.map((project) => project._id);
  const tasks = await EffortTask.find({ ...scopeQuery(req.scope), projectId: { $in: projectIds } }).sort({ updatedAt: -1 });
  const tasksByProject = new Map();
  for (const task of tasks) {
    const key = String(task.projectId);
    if (!tasksByProject.has(key)) tasksByProject.set(key, []);
    tasksByProject.get(key).push(task);
  }
  const now = new Date();
  res.json(projects.map((project) => presentProject(project, tasksByProject.get(String(project._id)) || [], now)));
});

exports.createProject = (req, res) => withErrors(res, async () => {
  const name = normalizeText(req.body?.name);
  if (!name) throw httpError('Project name is required');

  const project = await EffortProject.create({
    name,
    normalizedName: name.toLowerCase(),
    customer: normalizeText(req.body?.customer),
    comment: normalizeLongText(req.body?.comment),
    tenantId: req.scope?.tenantId || null,
    createdBy: req.userId,
    updatedBy: req.userId
  });

  res.status(201).json(presentProject(project, []));
});

exports.getProject = (req, res) => withErrors(res, async () => {
  const project = await getScopedProject(req.params.id, req.scope);
  const tasks = await EffortTask.find({ ...scopeQuery(req.scope), projectId: project._id }).sort({ status: 1, updatedAt: -1 });
  res.json(presentProject(project, tasks));
});

exports.updateProject = (req, res) => withErrors(res, async () => {
  const project = await getScopedProject(req.params.id, req.scope);
  if (project.status === 'closed') throw httpError('Closed project must be reopened before editing');

  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'name')) {
    const name = normalizeText(req.body.name);
    if (!name) throw httpError('Project name is required');
    project.name = name;
    project.normalizedName = name.toLowerCase();
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'customer')) project.customer = normalizeText(req.body.customer);
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'comment')) project.comment = normalizeLongText(req.body.comment);
  project.updatedBy = req.userId;
  await project.save();

  const tasks = await EffortTask.find({ ...scopeQuery(req.scope), projectId: project._id }).sort({ status: 1, updatedAt: -1 });
  res.json(presentProject(project, tasks));
});

exports.closeProject = (req, res) => withErrors(res, async () => {
  const project = await getScopedProject(req.params.id, req.scope);
  if (project.status === 'closed') {
    const tasks = await EffortTask.find({ ...scopeQuery(req.scope), projectId: project._id }).sort({ status: 1, updatedAt: -1 });
    return res.json(presentProject(project, tasks));
  }

  const now = new Date();
  const tasks = await EffortTask.find({ ...scopeQuery(req.scope), projectId: project._id }).sort({ status: 1, updatedAt: -1 });
  for (const task of tasks) {
    if (stopTaskTimer(task, now)) {
      task.updatedBy = req.userId;
      await task.save();
    }
  }

  const freshTasks = await EffortTask.find({ ...scopeQuery(req.scope), projectId: project._id }).sort({ status: 1, updatedAt: -1 });
  project.status = 'closed';
  project.closedAt = now;
  project.closedNetMs = freshTasks.reduce((total, task) => total + taskNetMs(task, now), 0);
  project.closedGrossMs = msBetween(project.createdAt, now);
  project.closedBy = req.userId;
  project.updatedBy = req.userId;
  await project.save();

  res.json(presentProject(project, freshTasks, now));
});

exports.reopenProject = (req, res) => withErrors(res, async () => {
  const project = await getScopedProject(req.params.id, req.scope);
  project.status = 'open';
  project.closedAt = undefined;
  project.closedNetMs = 0;
  project.closedGrossMs = 0;
  project.closedBy = undefined;
  project.updatedBy = req.userId;
  await project.save();

  const tasks = await EffortTask.find({ ...scopeQuery(req.scope), projectId: project._id }).sort({ status: 1, updatedAt: -1 });
  res.json(presentProject(project, tasks));
});

exports.createTask = (req, res) => withErrors(res, async () => {
  const project = await getScopedProject(req.params.id, req.scope);
  if (project.status === 'closed') throw httpError('Closed project must be reopened before adding tasks');

  const name = normalizeText(req.body?.name);
  if (!name) throw httpError('Task name is required');

  const task = await EffortTask.create({
    projectId: project._id,
    tenantId: req.scope?.tenantId || null,
    name,
    note: normalizeLongText(req.body?.note),
    createdBy: req.userId,
    updatedBy: req.userId
  });
  project.updatedBy = req.userId;
  await project.save();

  res.status(201).json(presentTask(task));
});

exports.updateTask = (req, res) => withErrors(res, async () => {
  const task = await getScopedTask(req.params.taskId, req.scope);
  if (task.status === 'closed') throw httpError('Closed task cannot be edited');
  const project = await getScopedProject(task.projectId, req.scope);
  if (project.status === 'closed') throw httpError('Closed project must be reopened before editing tasks');

  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'name')) {
    const name = normalizeText(req.body.name);
    if (!name) throw httpError('Task name is required');
    task.name = name;
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'note')) task.note = normalizeLongText(req.body.note);
  task.updatedBy = req.userId;
  await task.save();
  res.json(presentTask(task));
});

exports.startTask = (req, res) => withErrors(res, async () => {
  const task = await getScopedTask(req.params.taskId, req.scope);
  if (task.status === 'closed') throw httpError('Closed task cannot be started');
  const project = await getScopedProject(task.projectId, req.scope);
  if (project.status === 'closed') throw httpError('Closed project must be reopened before starting tasks');

  const now = new Date();
  await stopActiveTimersForUser(req.scope, req.userId, now, task._id);
  if (!task.activeTimer?.startedAt) {
    task.activeTimer = { userId: req.userId, startedAt: now };
    task.updatedBy = req.userId;
    await task.save();
  }
  res.json(presentTask(task, now));
});

exports.stopTask = (req, res) => withErrors(res, async () => {
  const task = await getScopedTask(req.params.taskId, req.scope);
  const now = new Date();
  if (String(task.activeTimer?.userId || '') !== String(req.userId || '')) {
    throw httpError('This task is not running for the current user', 409);
  }
  stopTaskTimer(task, now);
  task.updatedBy = req.userId;
  await task.save();
  res.json(presentTask(task, now));
});

exports.closeTask = (req, res) => withErrors(res, async () => {
  const task = await getScopedTask(req.params.taskId, req.scope);
  if (task.status === 'closed') return res.json(presentTask(task));

  const now = new Date();
  if (task.activeTimer?.startedAt) stopTaskTimer(task, now);
  task.status = 'closed';
  task.closedAt = now;
  task.closedNetMs = taskNetMs(task, now);
  task.closedGrossMs = msBetween(task.createdAt, now);
  task.closedBy = req.userId;
  task.updatedBy = req.userId;
  await task.save();
  res.json(presentTask(task, now));
});
