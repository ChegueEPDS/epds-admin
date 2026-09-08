const EffortProject = require('../models/effortProject');
const EffortTask = require('../models/effortTask');
const { WorkItem } = require('../models/workItem');
const SubWorkItem = require('../models/subWorkItem');
const { mapWithConcurrency } = require('../services/scheduledJobLeaseService');

const TERMINAL_WORK_STATUSES = ['completed_billable', 'invoiced', 'paid', 'closed', 'cancelled'];

function scopeQuery(scope) {
  return scope?.tenantId ? { tenantId: scope.tenantId } : { tenantId: null };
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
  const saved = Number(task.archivedNetMs || 0)
    + (task.sessions || []).reduce((total, session) => total + Number(session.durationMs || 0), 0);
  if (task.activeTimer?.startedAt) return saved + msBetween(task.activeTimer.startedAt, now);
  return saved;
}

function taskFirstStartedAt(task) {
  if (task.firstStartedAt) return new Date(task.firstStartedAt);
  const starts = (task.sessions || [])
    .map((session) => session.startedAt)
    .concat(task.activeTimer?.startedAt || [])
    .map((value) => new Date(value).getTime())
    .filter((value) => value && !Number.isNaN(value));
  if (!starts.length) return null;
  return new Date(Math.min(...starts));
}

function taskGrossSnapshotMs(task, now = new Date()) {
  const firstStartedAt = taskFirstStartedAt(task);
  return firstStartedAt ? msBetween(firstStartedAt, now) : 0;
}

function taskGrossMs(task) {
  if (task.status !== 'closed') return 0;
  return Number(task.closedGrossMs || 0);
}

function activeByUser(task, userId) {
  return Boolean(task.activeTimer?.startedAt && String(task.activeTimer.userId || '') === String(userId || ''));
}

function presentTask(task, now = new Date(), userId = null) {
  const sessionCount = Number(task.archivedSessionCount || 0) + (task.sessions || []).length;
  const active = Boolean(task.activeTimer?.startedAt);
  return {
    id: String(task._id),
    projectId: String(task.projectId),
    name: task.name,
    note: task.note || '',
    subWorkItemId: task.subWorkItemId ? String(task.subWorkItemId) : null,
    subWorkItem: task.subWorkItemSnapshot?.name ? {
      id: task.subWorkItemId ? String(task.subWorkItemId) : null,
      subWorkNumber: task.subWorkItemSnapshot.subWorkNumber || '',
      name: task.subWorkItemSnapshot.name || ''
    } : null,
    status: task.status,
    netMs: task.status === 'closed' ? Number(task.closedNetMs || 0) : taskNetMs(task, now),
    grossMs: taskGrossMs(task),
    active,
    activeByCurrentUser: activeByUser(task, userId),
    activeStartedAt: task.activeTimer?.startedAt || null,
    sessionCount,
    hasStarted: sessionCount > 0 || Boolean(task.activeTimer?.startedAt),
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

function presentProject(project, tasks = [], now = new Date(), userId = null) {
  const presentedTasks = tasks.map((task) => presentTask(task, now, userId));
  const netMs = project.status === 'closed'
    ? Number(project.closedNetMs || 0)
    : presentedTasks.reduce((total, task) => total + Number(task.netMs || 0), 0);

  return {
    id: String(project._id),
    name: project.name,
    customer: project.customer || '',
    comment: project.comment || '',
    workItemId: project.workItemId ? String(project.workItemId) : null,
    workItem: project.workItemSnapshot?.name ? {
      id: project.workItemId ? String(project.workItemId) : null,
      workNumber: project.workItemSnapshot.workNumber || '',
      name: project.workItemSnapshot.name || '',
      customer: project.workItemSnapshot.customer || ''
    } : null,
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

function stopTaskTimer(task, now = new Date()) {
  if (!task.activeTimer?.startedAt || !task.activeTimer?.userId) return false;
  task.firstStartedAt ||= taskFirstStartedAt(task) || task.activeTimer.startedAt;
  const durationMs = msBetween(task.activeTimer.startedAt, now);
  task.sessions.push({
    userId: task.activeTimer.userId,
    startedAt: task.activeTimer.startedAt,
    stoppedAt: now,
    durationMs
  });
  const configuredLimit = Number(process.env.EFFORT_EMBEDDED_SESSION_LIMIT || 100);
  const maxEmbeddedSessions = Number.isFinite(configuredLimit) ? Math.max(20, Math.floor(configuredLimit)) : 100;
  while (task.sessions.length > maxEmbeddedSessions) {
    task.archivedNetMs = Number(task.archivedNetMs || 0) + Number(task.sessions.shift()?.durationMs || 0);
    task.archivedSessionCount = Number(task.archivedSessionCount || 0) + 1;
  }
  task.activeTimer = undefined;
  return true;
}

function closeTaskSnapshot(task, userId, now = new Date()) {
  if (task.status === 'closed') return false;
  if (task.activeTimer?.startedAt) stopTaskTimer(task, now);
  task.status = 'closed';
  task.closedAt = now;
  task.closedNetMs = taskNetMs(task, now);
  task.closedGrossMs = taskGrossSnapshotMs(task, now);
  task.closedBy = userId;
  task.updatedBy = userId;
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
    if (err?.code === 11000 && err?.keyPattern?.['activeTimer.userId']) {
      return res.status(409).json({ error: 'Only one timer can run for a user at a time' });
    }
    res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Internal server error' });
  }
}

exports.listProjects = (req, res) => withErrors(res, async () => {
  const limit = requestLimit(req.query.limit);
  const projects = await EffortProject.find(ownerScopeQuery(req.scope, req.userId)).sort({ status: 1, updatedAt: -1 }).limit(limit);
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
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'workItemId')) {
    const nextWork = await getActiveWorkItem(req.body.workItemId, req.scope);
    const workChanged = String(project.workItemId || '') !== String(nextWork?._id || '');
    if (workChanged) {
      const linkedTaskExists = await EffortTask.exists({
        ...ownerScopeQuery(req.scope, req.userId),
        projectId: project._id,
        subWorkItemId: { $exists: true }
      });
      if (linkedTaskExists) throw httpError('Remove sub-work links from effort tasks before changing the related work', 409);
    }
    setWorkReference(project, nextWork);
  }
  project.updatedBy = req.userId;
  await project.save();

  const tasks = await EffortTask.find({ ...ownerScopeQuery(req.scope, req.userId), projectId: project._id }).sort({ status: 1, updatedAt: -1 });
  res.json(presentProject(project, tasks, new Date(), req.userId));
});

exports.closeProject = (req, res) => withErrors(res, async () => {
  const project = await getScopedProject(req.params.id, req.scope, req.userId);
  if (project.status === 'closed') {
    const tasks = await EffortTask.find({ ...ownerScopeQuery(req.scope, req.userId), projectId: project._id }).sort({ status: 1, updatedAt: -1 });
    return res.json(presentProject(project, tasks, new Date(), req.userId));
  }

  const now = new Date();
  const tasks = await EffortTask.find({ ...ownerScopeQuery(req.scope, req.userId), projectId: project._id }).sort({ status: 1, updatedAt: -1 });
  await mapWithConcurrency(tasks, 10, async (task) => {
    if (closeTaskSnapshot(task, req.userId, now)) await task.save();
  });
  const freshTasks = tasks;
  project.status = 'closed';
  project.closedAt = now;
  project.closedNetMs = freshTasks.reduce((total, task) => total + Number(task.closedNetMs || 0), 0);
  project.closedGrossMs = freshTasks.reduce((total, task) => total + Number(task.closedGrossMs || 0), 0);
  project.closedBy = req.userId;
  project.updatedBy = req.userId;
  await project.save();

  res.json(presentProject(project, freshTasks, now, req.userId));
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
  await task.save();
  project.updatedBy = req.userId;
  await project.save();

  res.status(201).json(presentTask(task, new Date(), req.userId));
});

exports.updateTask = (req, res) => withErrors(res, async () => {
  const task = await getScopedTask(req.params.taskId, req.scope, req.userId);
  if (task.status === 'closed') throw httpError('Closed task cannot be edited');
  const project = await getScopedProject(task.projectId, req.scope, req.userId);
  if (project.status === 'closed') throw httpError('Closed project must be reopened before editing tasks');

  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'name')) {
    const name = normalizeText(req.body.name);
    if (!name) throw httpError('Task name is required');
    task.name = name;
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'note')) task.note = normalizeLongText(req.body.note);
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'subWorkItemId')) {
    setSubWorkReference(task, await getActiveSubWorkItem(req.body.subWorkItemId, project, req.scope), project);
  }
  task.updatedBy = req.userId;
  await task.save();
  res.json(presentTask(task, new Date(), req.userId));
});

exports.startTask = (req, res) => withErrors(res, async () => {
  const task = await getScopedTask(req.params.taskId, req.scope, req.userId);
  if (task.status === 'closed') throw httpError('Closed task cannot be started');
  const project = await getScopedProject(task.projectId, req.scope, req.userId);
  if (project.status === 'closed') throw httpError('Closed project must be reopened before starting tasks');

  const now = new Date();
  await stopActiveTimersForUser(req.scope, req.userId, now, task._id);
  if (task.activeTimer?.startedAt && !activeByUser(task, req.userId)) {
    throw httpError('This task is already running for another user', 409);
  }
  if (!task.activeTimer?.startedAt) {
    task.activeTimer = { userId: req.userId, startedAt: now };
    task.firstStartedAt ||= now;
    task.updatedBy = req.userId;
    await task.save();
  }
  res.json(presentTask(task, now, req.userId));
});

exports.stopTask = (req, res) => withErrors(res, async () => {
  const task = await getScopedTask(req.params.taskId, req.scope, req.userId);
  const now = new Date();
  if (String(task.activeTimer?.userId || '') !== String(req.userId || '')) {
    throw httpError('This task is not running for the current user', 409);
  }
  stopTaskTimer(task, now);
  task.updatedBy = req.userId;
  await task.save();
  res.json(presentTask(task, now, req.userId));
});

exports.closeTask = (req, res) => withErrors(res, async () => {
  const task = await getScopedTask(req.params.taskId, req.scope, req.userId);
  if (task.status === 'closed') return res.json(presentTask(task, new Date(), req.userId));

  const now = new Date();
  closeTaskSnapshot(task, req.userId, now);
  await task.save();
  res.json(presentTask(task, now, req.userId));
});
