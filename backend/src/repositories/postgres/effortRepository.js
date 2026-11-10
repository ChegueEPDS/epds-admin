const mongoose = require('mongoose');
const newId = () => String(new mongoose.Types.ObjectId());
const projectAccess = 'tenant_id=$1 AND ((NOT shared AND created_by=$2) OR (shared AND $3))';

function project(row) {
  if (!row) return null;
  return {
    _id: row.id, tenantId: row.tenant_id, name: row.name, normalizedName: row.normalized_name,
    customer: row.customer, comment: row.comment, workItemId: row.work_item_id,
    workItemSnapshot: row.work_item_snapshot, shared: row.shared, status: row.status,
    closedAt: row.closed_at, closedNetMs: Number(row.closed_net_ms), closedGrossMs: Number(row.closed_gross_ms),
    createdBy: row.created_by, updatedBy: row.updated_by, closedBy: row.closed_by,
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

function task(row, sessions = []) {
  return {
    _id: row.id, projectId: row.project_id, tenantId: row.tenant_id, name: row.name, note: row.note,
    subWorkItemId: row.sub_work_item_id, subWorkItemSnapshot: row.sub_work_item_snapshot, status: row.status,
    assigneeId: row.assignee_id, assigneeName: row.assignee_name,
    estimateMs: row.estimate_ms === null ? null : Number(row.estimate_ms),
    netAdjustmentMs: Number(row.net_adjustment_ms), netCorrections: row.net_corrections, timerPaused: row.timer_paused,
    sessions, persistedSessions: sessions.length, archivedNetMs: Number(row.archived_net_ms),
    archivedSessionCount: row.archived_session_count, firstStartedAt: row.first_started_at,
    activeTimer: row.active_timer_started_at ? { userId: row.active_timer_user_id, startedAt: row.active_timer_started_at } : undefined,
    closedAt: row.closed_at, closedNetMs: Number(row.closed_net_ms), closedGrossMs: Number(row.closed_gross_ms),
    createdBy: row.created_by, updatedBy: row.updated_by, closedBy: row.closed_by,
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

async function sessionsFor(client, ids) {
  const grouped = new Map();
  if (!ids.length) return grouped;
  const { rows } = await client.query(`SELECT task_id, user_id, started_at, stopped_at, duration_ms
    FROM effort_sessions WHERE task_id=ANY($1::varchar[]) ORDER BY task_id,position`, [ids]);
  for (const row of rows) {
    const sessions = grouped.get(row.task_id) || [];
    sessions.push({ userId: row.user_id, startedAt: row.started_at, stoppedAt: row.stopped_at, durationMs: Number(row.duration_ms) });
    grouped.set(row.task_id, sessions);
  }
  return grouped;
}

async function listProjects(client, scope, limit) {
  const { rows } = await client.query(`SELECT * FROM effort_projects WHERE ${projectAccess}
    ORDER BY status,updated_at DESC LIMIT $4`, [...scope, limit]);
  return rows.map(project);
}

async function findProject(client, scope, id, lock = false) {
  const { rows } = await client.query(`SELECT * FROM effort_projects WHERE ${projectAccess}
    AND id=$4 ${lock ? 'FOR UPDATE' : ''}`, [...scope, id]);
  return project(rows[0]);
}

async function listTasks(client, tenantId, projectIds) {
  if (!projectIds.length) return [];
  const { rows } = await client.query(`SELECT * FROM effort_tasks WHERE tenant_id=$1
    AND project_id=ANY($2::varchar[]) ORDER BY created_at,id`, [tenantId, projectIds]);
  const sessions = await sessionsFor(client, rows.map((row) => row.id));
  return rows.map((row) => task(row, sessions.get(row.id)));
}

async function findTaskProject(client, tenantId, taskId) {
  const { rows } = await client.query('SELECT project_id FROM effort_tasks WHERE tenant_id=$1 AND id=$2', [tenantId, taskId]);
  return rows[0]?.project_id;
}

async function findTask(client, projectId, taskId) {
  const { rows } = await client.query('SELECT * FROM effort_tasks WHERE project_id=$1 AND id=$2', [projectId, taskId]);
  if (!rows.length) return null;
  const sessions = await sessionsFor(client, [taskId]);
  return task(rows[0], sessions.get(taskId));
}

async function write(client, table, id, values, insertConflict = '') {
  const columns = Object.keys(values);
  const args = Object.values(values);
  const placeholders = columns.map((_, i) => `$${i + 1}`);
  if (!id) {
    const { rows } = await client.query(`INSERT INTO ${table} (${columns.join(',')},id,created_at,updated_at)
      VALUES (${placeholders.join(',')},$${args.length + 1},now(),now()) ${insertConflict} RETURNING *`, [...args, newId()]);
    return rows[0];
  }
  const assignments = columns.map((key, i) => `${key}=${placeholders[i]}`);
  const { rows } = await client.query(`UPDATE ${table} SET ${assignments.join(',')},updated_at=now()
    WHERE id=$${args.length + 1} RETURNING *`, [...args, id]);
  return rows[0];
}

async function saveProject(client, input) {
  const row = await write(client, 'effort_projects', input._id, {
    tenant_id: input.tenantId, name: input.name, normalized_name: input.name.toLowerCase(),
    customer: input.customer || '', comment: input.comment || '', work_item_id: input.workItemId || null,
    work_item_snapshot: JSON.stringify(input.workItemSnapshot || {}), shared: Boolean(input.shared),
    status: input.status || 'open', closed_at: input.closedAt || null,
    closed_net_ms: input.closedNetMs || 0, closed_gross_ms: input.closedGrossMs || 0,
    created_by: input.createdBy, updated_by: input.updatedBy, closed_by: input.closedBy || null
  }, input.shared ? 'ON CONFLICT (tenant_id,work_item_id) WHERE shared AND work_item_id IS NOT NULL DO NOTHING' : '');
  return project(row) || findLinkedProject(client, input.tenantId, input.createdBy, input.workItemId, true);
}

async function findLinkedProject(client, tenantId, userId, workId, shared = false) {
  const { rows } = await client.query(`SELECT * FROM effort_projects
    WHERE tenant_id=$1 AND work_item_id=$2 AND shared=$3 AND ($3 OR created_by=$4)
    ORDER BY status DESC,created_at LIMIT 1`, [tenantId, workId, shared, userId]);
  return project(rows[0]);
}

async function saveTask(client, input) {
  const row = await write(client, 'effort_tasks', input._id, {
    project_id: input.projectId, tenant_id: input.tenantId, name: input.name, note: input.note || '',
    sub_work_item_id: input.subWorkItemId || null, sub_work_item_snapshot: JSON.stringify(input.subWorkItemSnapshot || {}),
    status: input.status || 'new', assignee_id: input.assigneeId || null, assignee_name: input.assigneeName || '',
    estimate_ms: input.estimateMs ?? null, net_adjustment_ms: input.netAdjustmentMs || 0,
    net_corrections: JSON.stringify(input.netCorrections || []), timer_paused: Boolean(input.timerPaused),
    archived_net_ms: input.archivedNetMs || 0, archived_session_count: input.archivedSessionCount || 0,
    first_started_at: input.firstStartedAt || null, active_timer_user_id: input.activeTimer?.userId || null,
    active_timer_started_at: input.activeTimer?.startedAt || null, closed_at: input.closedAt || null,
    closed_net_ms: input.closedNetMs || 0, closed_gross_ms: input.closedGrossMs || 0,
    created_by: input.createdBy, updated_by: input.updatedBy, closed_by: input.closedBy || null
  });
  const sessions = input.sessions || [];
  for (let position = input.persistedSessions || 0; position < sessions.length; position++) {
    const session = sessions[position];
    await client.query(`INSERT INTO effort_sessions(task_id,user_id,position,started_at,stopped_at,duration_ms)
      VALUES($1,$2,$3,$4,$5,$6)`, [row.id, session.userId, position, session.startedAt, session.stoppedAt, session.durationMs]);
  }
  return task(row, sessions);
}

async function work(client, tenantId, workId) {
  const { rows } = await client.query(`SELECT id, name, customer, work_number, status FROM work_items
    WHERE id=$1 AND tenant_id=$2 AND archived_at IS NULL`, [workId, tenantId]);
  return rows[0];
}

async function subWork(client, tenantId, workId, subWorkId) {
  const { rows } = await client.query(`SELECT id, name, sequence_number FROM sub_work_items
    WHERE id=$1 AND work_item_id=$2 AND tenant_id=$3 AND archived_at IS NULL`, [subWorkId, workId, tenantId]);
  return rows[0];
}

async function otherTimer(client, userId, taskId) {
  const { rows } = await client.query(`SELECT 1 FROM effort_tasks WHERE active_timer_user_id=$1
    AND active_timer_started_at IS NOT NULL AND id<>$2 LIMIT 1`, [userId, taskId]);
  return Boolean(rows.length);
}

module.exports = { listProjects, findProject, listTasks, findTaskProject, findTask, saveProject, findLinkedProject,
  saveTask, work, subWork, otherTimer };
