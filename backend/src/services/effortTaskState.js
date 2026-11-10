const STATUSES = ['new', 'in_progress', 'closed'];

function httpError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function msBetween(start, end) {
  return start ? Math.max(0, new Date(end) - new Date(start)) : 0;
}

function measuredNetMs(task, now) {
  return Number(task.archivedNetMs || 0)
    + (task.sessions || []).reduce((total, session) => total + Number(session.durationMs || 0), 0)
    + msBetween(task.activeTimer?.startedAt, now);
}

function taskNetMs(task, now) {
  return measuredNetMs(task, now) + Number(task.netAdjustmentMs || 0);
}

function firstStartedAt(task) {
  if (task.firstStartedAt) return new Date(task.firstStartedAt);
  const starts = (task.sessions || []).map((session) => session.startedAt)
    .concat(task.activeTimer?.startedAt || []).filter(Boolean).map((value) => new Date(value).getTime());
  return starts.length ? new Date(Math.min(...starts)) : null;
}

function taskStatus(task) {
  if (task.status !== 'open') return task.status;
  return firstStartedAt(task) || task.archivedSessionCount ? 'in_progress' : 'new';
}

function activeByUser(task, userId) {
  return Boolean(task.activeTimer?.startedAt && String(task.activeTimer.userId) === String(userId));
}

function durationField(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw httpError(`${label} must be a non-negative duration`);
  return value;
}

async function applyTaskFields(task, body, findAssignee) {
  if (Object.hasOwn(body, 'estimateMs')) {
    task.estimateMs = body.estimateMs === null ? null : durationField(body.estimateMs, 'Estimate');
  }
  if (Object.hasOwn(body, 'assigneeId') && String(body.assigneeId || '') !== String(task.assigneeId || '')) {
    if (body.assigneeId !== null && !/^[0-9a-f]{24}$/i.test(body.assigneeId)) {
      throw httpError('Invalid assignee');
    }
    const user = body.assigneeId ? await findAssignee(body.assigneeId) : null;
    if (body.assigneeId && !user) throw httpError('Select an assignee from this organization');
    task.assigneeId = user ? String(user.id || user._id) : null;
    task.assigneeName = user ? `${user.firstName} ${user.lastName}`.trim() || user.email : '';
  }
}

function setNetOverride(task, body, now, userId, actor) {
  if (!Object.hasOwn(body, 'netOverrideMs')) return;
  if (task.activeTimer?.startedAt) throw httpError('Pause or stop the timer before correcting net time', 409);
  const target = durationField(body.netOverrideMs, 'Net time');
  const previousMs = task.status === 'closed' ? Number(task.closedNetMs || 0) : taskNetMs(task, now);
  if (target === previousMs) return;
  const reason = typeof body.netOverrideReason === 'string' ? body.netOverrideReason.trim() : '';
  if (!reason || reason.length > 500) throw httpError('Enter a time correction reason (up to 500 characters)');
  task.netCorrections ||= [];
  const userName = [actor?.firstName, actor?.lastName].filter(Boolean).join(' ').trim() || actor?.email || '';
  task.netCorrections.push({ userId, userName, at: now, reason, previousMs, netMs: target });
  task.netAdjustmentMs = target - measuredNetMs(task, now);
  if (task.status === 'closed') task.closedNetMs = target;
}

function stopTimer(task, now, { pause = false, sessionLimit = Infinity } = {}) {
  const timer = task.activeTimer;
  if (timer?.startedAt) {
    task.firstStartedAt ||= firstStartedAt(task);
    task.sessions.push({
      userId: timer.userId,
      startedAt: timer.startedAt,
      stoppedAt: now,
      durationMs: msBetween(timer.startedAt, now)
    });
    while (task.sessions.length > sessionLimit) {
      task.archivedNetMs = Number(task.archivedNetMs || 0) + task.sessions.shift().durationMs;
      task.archivedSessionCount = Number(task.archivedSessionCount || 0) + 1;
    }
    task.activeTimer = undefined;
  }
  task.timerPaused = pause;
}

function setStatus(task, status, userId, now, sessionLimit) {
  if (!STATUSES.includes(status)) throw httpError('Invalid task status');
  if (status === taskStatus(task)) return;
  if (status !== 'in_progress') stopTimer(task, now, { sessionLimit });
  task.status = status;
  task.closedAt = status === 'closed' ? now : null;
  task.closedNetMs = status === 'closed' ? taskNetMs(task, now) : 0;
  task.closedGrossMs = status === 'closed' ? msBetween(firstStartedAt(task), now) : 0;
  task.closedBy = status === 'closed' ? userId : null;
}

function checkStart(task, userId) {
  if (taskStatus(task) !== 'in_progress') throw httpError('Move this task to In progress to start its timer', 409);
  if (task.activeTimer?.startedAt && !activeByUser(task, userId)) {
    throw httpError('This task is already running for another user', 409);
  }
}

function startTimer(task, userId, now) {
  if (task.activeTimer?.startedAt) return;
  task.status = 'in_progress';
  task.activeTimer = { userId, startedAt: now };
  task.firstStartedAt ||= now;
  task.timerPaused = false;
}

function stopByUser(task, userId, now, options) {
  checkStart(task, userId);
  if (options.pause && !activeByUser(task, userId)) return;
  stopTimer(task, now, options);
}

function presentTask(task, now, userId) {
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
      name: task.subWorkItemSnapshot.name
    } : null,
    status: taskStatus(task),
    assigneeId: task.assigneeId ? String(task.assigneeId) : null,
    assigneeName: task.assigneeName || '',
    estimateMs: task.estimateMs ?? null,
    measuredNetMs: measuredNetMs(task, now),
    netCorrections: task.netCorrections || [],
    netMs: task.status === 'closed' ? Number(task.closedNetMs || 0) : taskNetMs(task, now),
    grossMs: task.status === 'closed' ? Number(task.closedGrossMs || 0) : 0,
    active,
    activeByCurrentUser: activeByUser(task, userId),
    activeStartedAt: task.activeTimer?.startedAt || null,
    timerPaused: Boolean(task.timerPaused),
    sessionCount,
    hasStarted: sessionCount > 0 || active,
    closedAt: task.closedAt || null,
    closedNetMs: Number(task.closedNetMs || 0),
    closedGrossMs: Number(task.closedGrossMs || 0),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt
  };
}

function presentProject(project, tasks, now, userId) {
  const presentedTasks = tasks.map((task) => presentTask(task, now, userId));
  const closed = project.status === 'closed';
  return {
    id: String(project._id),
    name: project.name,
    customer: project.customer || '',
    comment: project.comment || '',
    shared: Boolean(project.shared),
    workItemId: project.workItemId ? String(project.workItemId) : null,
    workItem: project.workItemSnapshot?.name ? {
      id: project.workItemId ? String(project.workItemId) : null,
      workNumber: project.workItemSnapshot.workNumber || '',
      name: project.workItemSnapshot.name,
      customer: project.workItemSnapshot.customer || ''
    } : null,
    status: project.status,
    netMs: closed ? Number(project.closedNetMs || 0) : presentedTasks.reduce((total, task) => total + task.netMs, 0),
    grossMs: closed ? Number(project.closedGrossMs || 0) : 0,
    closedAt: project.closedAt || null,
    closedNetMs: Number(project.closedNetMs || 0),
    closedGrossMs: Number(project.closedGrossMs || 0),
    taskCount: presentedTasks.length,
    openTaskCount: presentedTasks.filter((task) => task.status !== 'closed').length,
    activeTaskCount: presentedTasks.filter((task) => task.active).length,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    tasks: presentedTasks
  };
}

module.exports = {
  httpError, applyTaskFields, setNetOverride, setStatus, checkStart, startTimer, stopTimer,
  stopByUser, presentTask, presentProject
};
