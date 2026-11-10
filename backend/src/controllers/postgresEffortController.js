const store = require('../repositories/postgres/effortRepository');
const { withTransaction } = require('../postgres');
const {
  httpError, applyTaskFields, setNetOverride, setStatus, checkStart, startTimer,
  stopByUser, presentTask, presentProject
} = require('../services/effortTaskState');

const terminal = new Set(['completed_billable', 'invoiced', 'paid', 'closed', 'cancelled', 'lost']);
const clean = (value) => String(value || '').trim();
const nameOf = (value) => {
  const name = clean(value).replace(/\s+/g, ' ');
  if (!name) throw httpError('Name is required');
  return name;
};

function scope(req) {
  if (!req.scope?.tenantId) throw httpError('Tenant context is required', 403);
  return [req.scope.tenantId, req.userId, Boolean(req.scope.tenantFeatures?.workBoard?.enabled)];
}

async function scopedProject(req, client, id = req.params.id, lock = true) {
  const project = await store.findProject(client, scope(req), id, lock);
  if (!project) throw httpError('Project not found', 404);
  return project;
}

async function scopedTask(req, client) {
  const projectId = await store.findTaskProject(client, scope(req)[0], req.params.taskId);
  if (!projectId) throw httpError('Task not found', 404);
  const project = await scopedProject(req, client, projectId);
  const task = await store.findTask(client, projectId, req.params.taskId);
  if (!task) throw httpError('Task not found', 404);
  return { project, task };
}

function checkProject(project) {
  if (project.status === 'closed') throw httpError('Reopen the project before editing its tasks', 409);
}

function checkPrivate(project) {
  if (project.shared) throw httpError('Manage the project in Project Tracker', 409);
}

async function workReference(client, tenantId, workId, activeOnly = false) {
  if (!workId) return { workItemId: null, workItemSnapshot: {} };
  const work = await store.work(client, tenantId, workId);
  if (!work || (activeOnly && terminal.has(work.status))) throw httpError('Selected work is unavailable', 409);
  return { workItemId: work.id, workItemSnapshot: { name: work.name, workNumber: work.work_number, customer: work.customer || '' } };
}

async function subReference(client, project, subId) {
  if (!subId) return { subWorkItemId: null, subWorkItemSnapshot: {} };
  const sub = await store.subWork(client, project.tenantId, project.workItemId, subId);
  if (!sub) throw httpError('Select an available sub-work from this project', 409);
  return { subWorkItemId: sub.id, subWorkItemSnapshot: { name: sub.name,
    subWorkNumber: `${project.workItemSnapshot.workNumber}/${String(sub.sequence_number).padStart(2, '0')}` } };
}

const taskFields = (req, client, task) => applyTaskFields(task, req.body || {}, async (id) => {
  const { rows } = await client.query(`SELECT id, first_name AS "firstName", last_name AS "lastName", email
    FROM users WHERE tenant_id=$1 AND id=$2`, [req.scope.tenantId, id]);
  return rows[0];
});

function respond(handler, { write = false, status = 200 } = {}) {
  return async (req, res) => {
    try {
      const result = await (write
        ? withTransaction((client) => handler(req, client))
        : withTransaction((client) => handler(req, client), { isolationLevel: 'REPEATABLE READ' }));
      res.status(status);
      if (status === 204) return res.end();
      return res.json(result);
    } catch (error) {
      if (error.code === '23505' && error.constraint === 'effort_tasks_one_active_timer_per_user') {
        return res.status(409).json({ error: 'Pause or stop your running timer first' });
      }
      if (!error.statusCode) console.error('[effort-pg]', error);
      return res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Effort operation failed' });
    }
  };
}

exports.listProjects = respond(async (req, client) => {
  const board = req.query.board === '1';
  const access = scope(req);
  if (!board) access[2] = false;
  const limit = board ? null : Math.max(1, Math.min(200, Math.floor(Number(req.query.limit) || 100)));
  const projects = await store.listProjects(client, access, limit);
  const tasks = await store.listTasks(client, access[0], projects.map((project) => project._id));
  const byProject = new Map();
  for (const task of tasks) {
    const group = byProject.get(task.projectId) || [];
    group.push(task);
    byProject.set(task.projectId, group);
  }
  const now = new Date();
  return projects.map((project) => presentProject(project, byProject.get(project._id) || [], now, req.userId));
});

async function projectResponse(req, client, project, now = new Date()) {
  const tasks = await store.listTasks(client, project.tenantId, [project._id]);
  return presentProject(project, tasks, now, req.userId);
}

exports.getProject = respond(async (req, client) =>
  projectResponse(req, client, await scopedProject(req, client, req.params.id, false)));

exports.createProject = respond(async (req, client) => {
  const [tenantId, userId, canAccessWork] = scope(req);
  const body = req.body || {};
  const shared = body.shared === true;
  if (shared && !canAccessWork) throw httpError('Project Tracker access is required', 403);
  if (shared && !body.workItemId) throw httpError('Select a Project Tracker project');
  const name = shared ? '' : nameOf(body.name);
  if (body.workItemId && !shared) {
    const existing = await store.findLinkedProject(client, tenantId, userId, body.workItemId, shared);
    if (existing) return projectResponse(req, client, existing);
  }
  const reference = await workReference(client, tenantId, body.workItemId, !shared);
  const project = await store.saveProject(client, {
    ...reference, tenantId, shared, name: shared ? reference.workItemSnapshot.name : name,
    customer: shared ? reference.workItemSnapshot.customer : clean(body.customer), comment: shared ? '' : clean(body.comment),
    createdBy: userId, updatedBy: userId
  });
  return projectResponse(req, client, project);
}, { write: true, status: 201 });

exports.updateProject = respond(async (req, client) => {
  const project = await scopedProject(req, client);
  checkPrivate(project);
  checkProject(project);
  const body = req.body || {};
  if (Object.hasOwn(body, 'name')) project.name = nameOf(body.name);
  if (Object.hasOwn(body, 'customer')) project.customer = clean(body.customer);
  if (Object.hasOwn(body, 'comment')) project.comment = clean(body.comment);
  if (Object.hasOwn(body, 'workItemId') && (body.workItemId || null) !== project.workItemId) {
    const tasks = await store.listTasks(client, project.tenantId, [project._id]);
    if (tasks.some((task) => task.subWorkItemId)) throw httpError('Remove existing sub-work links before changing projects', 409);
    Object.assign(project, await workReference(client, project.tenantId, body.workItemId));
  }
  project.updatedBy = req.userId;
  return projectResponse(req, client, await store.saveProject(client, project));
}, { write: true });

exports.deleteProject = respond(async (req, client) => {
  const project = await scopedProject(req, client);
  checkPrivate(project);
  await client.query('DELETE FROM effort_projects WHERE id=$1', [project._id]);
}, { write: true, status: 204 });

exports.closeProject = respond(async (req, client) => {
  let project = await scopedProject(req, client);
  checkPrivate(project);
  if (project.status === 'closed') return projectResponse(req, client, project);
  const now = new Date();
  const tasks = await store.listTasks(client, project.tenantId, [project._id]);
  for (const task of tasks) {
    if (task.status === 'closed') continue;
    setStatus(task, 'closed', req.userId, now);
    task.updatedBy = req.userId;
    await store.saveTask(client, task);
  }
  project = await store.saveProject(client, { ...project, status: 'closed', closedAt: now,
    closedNetMs: tasks.reduce((sum, task) => sum + task.closedNetMs, 0),
    closedGrossMs: tasks.reduce((sum, task) => sum + task.closedGrossMs, 0),
    updatedBy: req.userId, closedBy: req.userId });
  return presentProject(project, tasks, now, req.userId);
}, { write: true });

exports.reopenProject = respond(async (req, client) => {
  const project = await scopedProject(req, client);
  checkPrivate(project);
  return projectResponse(req, client, await store.saveProject(client, { ...project, status: 'open',
    closedAt: null, closedNetMs: 0, closedGrossMs: 0, closedBy: null, updatedBy: req.userId }));
}, { write: true });

exports.createTask = respond(async (req, client) => {
  const project = await scopedProject(req, client);
  checkProject(project);
  if (project.shared && (!project.workItemId || !await store.work(client, project.tenantId, project.workItemId))) {
    throw httpError('Selected work is unavailable', 409);
  }
  const task = {
    projectId: project._id, tenantId: project.tenantId, name: nameOf(req.body?.name), note: clean(req.body?.note),
    ...await subReference(client, project, req.body?.subWorkItemId), createdBy: req.userId, updatedBy: req.userId
  };
  await taskFields(req, client, task);
  return presentTask(await store.saveTask(client, task), new Date(), req.userId);
}, { write: true, status: 201 });

function changeTask(change, { allowClosedProject = false } = {}) {
  return respond(async (req, client) => {
    const { task, project } = await scopedTask(req, client);
    if (!allowClosedProject) checkProject(project);
    const now = new Date();
    await change(req, client, project, task, now);
    task.updatedBy = req.userId;
    return presentTask(await store.saveTask(client, task), now, req.userId);
  }, { write: true });
}

exports.updateTask = changeTask(async (req, client, project, task, now) => {
  const body = req.body || {};
  if (Object.hasOwn(body, 'name')) task.name = nameOf(body.name);
  if (Object.hasOwn(body, 'note')) task.note = clean(body.note);
  if (Object.hasOwn(body, 'subWorkItemId') && (body.subWorkItemId || null) !== task.subWorkItemId) {
    Object.assign(task, await subReference(client, project, body.subWorkItemId));
  }
  await taskFields(req, client, task);
  if (Object.hasOwn(body, 'status')) setStatus(task, body.status, req.userId, now);
  setNetOverride(task, body, now, req.userId, req.user);
});

exports.deleteTask = respond(async (req, client) => {
  const { task } = await scopedTask(req, client);
  if (task.activeTimer?.startedAt) throw httpError('Stop the timer before deleting this task', 409);
  await client.query('DELETE FROM effort_tasks WHERE id=$1', [task._id]);
}, { write: true, status: 204 });

exports.startTask = changeTask(async (req, client, project, task, now) => {
  checkStart(task, req.userId);
  if (await store.otherTimer(client, req.userId, task._id)) throw httpError('Pause or stop your running timer first', 409);
  startTimer(task, req.userId, now);
});

exports.stopTask = changeTask((req, client, project, task, now) => {
  stopByUser(task, req.userId, now, { pause: req.body?.pause === true });
}, { allowClosedProject: true });

exports.closeTask = changeTask((req, client, project, task, now) => setStatus(task, 'closed', req.userId, now));
