const mongoose = require('mongoose');
const { query, withTransaction } = require('../../postgres');

const newId = () => String(new mongoose.Types.ObjectId());

function project(row) {
  if (!row) return null;
  return { _id:row.id,id:row.id,tenantId:row.tenant_id,name:row.name,normalizedName:row.normalized_name,
    customer:row.customer,comment:row.comment,workItemId:row.work_item_id,workItemSnapshot:row.work_item_snapshot||{},
    status:row.status,closedAt:row.closed_at,closedNetMs:Number(row.closed_net_ms),closedGrossMs:Number(row.closed_gross_ms),
    createdBy:row.created_by,updatedBy:row.updated_by,closedBy:row.closed_by,createdAt:row.created_at,updatedAt:row.updated_at };
}
function task(row, sessions=[]) {
  if (!row) return null;
  return { _id:row.id,id:row.id,projectId:row.project_id,tenantId:row.tenant_id,name:row.name,note:row.note,
    subWorkItemId:row.sub_work_item_id,subWorkItemSnapshot:row.sub_work_item_snapshot||{},status:row.status,sessions,
    archivedNetMs:Number(row.archived_net_ms),archivedSessionCount:Number(row.archived_session_count),firstStartedAt:row.first_started_at,
    activeTimer:row.active_timer_started_at?{userId:row.active_timer_user_id,startedAt:row.active_timer_started_at}:undefined,
    closedAt:row.closed_at,closedNetMs:Number(row.closed_net_ms),closedGrossMs:Number(row.closed_gross_ms),
    createdBy:row.created_by,updatedBy:row.updated_by,closedBy:row.closed_by,createdAt:row.created_at,updatedAt:row.updated_at };
}

async function sessionsFor(client, taskIds) {
  if (!taskIds.length) return new Map();
  const result=await client.query(`SELECT * FROM effort_sessions WHERE task_id=ANY($1::varchar[]) ORDER BY task_id,position`,[taskIds]);
  const map=new Map();for(const r of result.rows){const list=map.get(r.task_id)||[];list.push({userId:r.user_id,startedAt:r.started_at,stoppedAt:r.stopped_at,durationMs:Number(r.duration_ms)});map.set(r.task_id,list);}return map;
}
async function listProjects(tenantId,userId,limit=100){const result=await query(`SELECT * FROM effort_projects WHERE tenant_id=$1 AND created_by=$2 ORDER BY status,updated_at DESC LIMIT $3`,[tenantId,userId,limit]);return result.rows.map(project);}
async function findProject(tenantId,userId,projectId,client=null){const executor=client||{query};const result=await executor.query('SELECT * FROM effort_projects WHERE id=$1 AND tenant_id=$2 AND created_by=$3',[projectId,tenantId,userId]);return project(result.rows[0]);}
async function listTasks(tenantId,userId,projectIds,client=null){if(!projectIds.length)return[];const executor=client||{query};const result=await executor.query(`SELECT * FROM effort_tasks WHERE tenant_id=$1 AND created_by=$2 AND project_id=ANY($3::varchar[]) ORDER BY status,updated_at DESC`,[tenantId,userId,projectIds]);const sm=await sessionsFor(executor,result.rows.map(r=>r.id));return result.rows.map(r=>task(r,sm.get(r.id)||[]));}
async function findTask(tenantId,userId,taskId,client=null){const executor=client||{query};const result=await executor.query('SELECT * FROM effort_tasks WHERE id=$1 AND tenant_id=$2 AND created_by=$3',[taskId,tenantId,userId]);if(!result.rows[0])return null;const sm=await sessionsFor(executor,[taskId]);return task(result.rows[0],sm.get(taskId)||[]);}

async function saveProject(input,client=null){const executor=client||{query};const pid=String(input.id||input._id||newId());const result=await executor.query(`INSERT INTO effort_projects
  (id,tenant_id,name,normalized_name,customer,comment,work_item_id,work_item_snapshot,status,closed_at,closed_net_ms,closed_gross_ms,created_by,updated_by,closed_by,created_at,updated_at)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,coalesce($16,now()),now()) ON CONFLICT(id) DO UPDATE SET
  name=EXCLUDED.name,normalized_name=EXCLUDED.normalized_name,customer=EXCLUDED.customer,comment=EXCLUDED.comment,
  work_item_id=EXCLUDED.work_item_id,work_item_snapshot=EXCLUDED.work_item_snapshot,status=EXCLUDED.status,closed_at=EXCLUDED.closed_at,
  closed_net_ms=EXCLUDED.closed_net_ms,closed_gross_ms=EXCLUDED.closed_gross_ms,updated_by=EXCLUDED.updated_by,closed_by=EXCLUDED.closed_by,updated_at=now() RETURNING *`,
  [pid,input.tenantId,input.name,input.normalizedName||String(input.name).toLowerCase(),input.customer||'',input.comment||'',input.workItemId||null,JSON.stringify(input.workItemSnapshot||{}),input.status||'open',input.closedAt||null,Number(input.closedNetMs||0),Number(input.closedGrossMs||0),input.createdBy,input.updatedBy,input.closedBy||null,input.createdAt||null]);return project(result.rows[0]);}

async function saveTask(input,client=null){const executor=client||{query};const tid=String(input.id||input._id||newId());const result=await executor.query(`INSERT INTO effort_tasks
  (id,project_id,tenant_id,name,note,sub_work_item_id,sub_work_item_snapshot,status,archived_net_ms,archived_session_count,first_started_at,active_timer_user_id,active_timer_started_at,closed_at,closed_net_ms,closed_gross_ms,created_by,updated_by,closed_by,created_at,updated_at)
  VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,coalesce($20,now()),now()) ON CONFLICT(id) DO UPDATE SET
  name=EXCLUDED.name,note=EXCLUDED.note,sub_work_item_id=EXCLUDED.sub_work_item_id,sub_work_item_snapshot=EXCLUDED.sub_work_item_snapshot,
  status=EXCLUDED.status,archived_net_ms=EXCLUDED.archived_net_ms,archived_session_count=EXCLUDED.archived_session_count,
  first_started_at=EXCLUDED.first_started_at,active_timer_user_id=EXCLUDED.active_timer_user_id,active_timer_started_at=EXCLUDED.active_timer_started_at,
  closed_at=EXCLUDED.closed_at,closed_net_ms=EXCLUDED.closed_net_ms,closed_gross_ms=EXCLUDED.closed_gross_ms,updated_by=EXCLUDED.updated_by,closed_by=EXCLUDED.closed_by,updated_at=now() RETURNING *`,
  [tid,input.projectId,input.tenantId,input.name,input.note||'',input.subWorkItemId||null,JSON.stringify(input.subWorkItemSnapshot||{}),input.status||'open',Number(input.archivedNetMs||0),Number(input.archivedSessionCount||0),input.firstStartedAt||null,input.activeTimer?.userId||null,input.activeTimer?.startedAt||null,input.closedAt||null,Number(input.closedNetMs||0),Number(input.closedGrossMs||0),input.createdBy,input.updatedBy,input.closedBy||null,input.createdAt||null]);
  await executor.query('DELETE FROM effort_sessions WHERE task_id=$1',[tid]);let position=0;for(const s of input.sessions||[])await executor.query(`INSERT INTO effort_sessions(task_id,user_id,position,started_at,stopped_at,duration_ms) VALUES($1,$2,$3,$4,$5,$6)`,[tid,s.userId,position++,s.startedAt,s.stoppedAt||null,Number(s.durationMs||0)]);return task(result.rows[0],input.sessions||[]);}

async function deleteProject(tenantId,userId,projectId){return withTransaction(async client=>{const p=await findProject(tenantId,userId,projectId,client);if(!p)return false;await client.query('DELETE FROM effort_projects WHERE id=$1',[projectId]);return true;});}
async function deleteTask(tenantId,userId,taskId){const result=await query('DELETE FROM effort_tasks WHERE id=$1 AND tenant_id=$2 AND created_by=$3 RETURNING id',[taskId,tenantId,userId]);return Boolean(result.rows[0]);}
async function activeWork(tenantId,workId){if(!workId)return null;const result=await query(`SELECT * FROM work_items WHERE id=$1 AND tenant_id=$2 AND archived_at IS NULL AND status<>ALL($3::text[])`,[workId,tenantId,['completed_billable','invoiced','paid','closed','cancelled']]);return result.rows[0]||null;}
async function activeSubWork(tenantId,workId,subWorkId){if(!subWorkId)return null;const result=await query(`SELECT * FROM sub_work_items WHERE id=$1 AND work_item_id=$2 AND tenant_id=$3 AND archived_at IS NULL AND status<>ALL($4::text[])`,[subWorkId,workId,tenantId,['completed_billable','invoiced','paid','closed','cancelled']]);return result.rows[0]||null;}

async function switchActiveTimer(tenantId,userId,targetTaskId,now=new Date()) {return withTransaction(async client=>{
  const active=await client.query(`SELECT * FROM effort_tasks WHERE tenant_id=$1 AND active_timer_user_id=$2 AND active_timer_started_at IS NOT NULL FOR UPDATE`,[tenantId,userId]);
  for(const row of active.rows){if(row.id===targetTaskId)continue;const duration=Math.max(0,now-new Date(row.active_timer_started_at));const pos=await client.query('SELECT coalesce(max(position),-1)+1 AS p FROM effort_sessions WHERE task_id=$1',[row.id]);await client.query(`INSERT INTO effort_sessions(task_id,user_id,position,started_at,stopped_at,duration_ms) VALUES($1,$2,$3,$4,$5,$6)`,[row.id,userId,Number(pos.rows[0].p),row.active_timer_started_at,now,duration]);await client.query(`UPDATE effort_tasks SET active_timer_user_id=NULL,active_timer_started_at=NULL,updated_by=$2,updated_at=now() WHERE id=$1`,[row.id,userId]);}
  const target=await client.query(`UPDATE effort_tasks SET active_timer_user_id=$2,active_timer_started_at=coalesce(active_timer_started_at,$3),first_started_at=coalesce(first_started_at,$3),updated_by=$2,updated_at=now() WHERE id=$1 AND tenant_id=$4 AND created_by=$2 AND status='open' AND (active_timer_user_id IS NULL OR active_timer_user_id=$2) RETURNING *`,[targetTaskId,userId,now,tenantId]);if(!target.rows[0])return null;const sm=await sessionsFor(client,[targetTaskId]);return task(target.rows[0],sm.get(targetTaskId)||[]);
});}
async function stopTimer(tenantId,userId,taskId,now=new Date()){return withTransaction(async client=>{const locked=await client.query(`SELECT * FROM effort_tasks WHERE id=$1 AND tenant_id=$2 AND created_by=$3 FOR UPDATE`,[taskId,tenantId,userId]);const row=locked.rows[0];if(!row||row.active_timer_user_id!==userId||!row.active_timer_started_at)return null;const duration=Math.max(0,now-new Date(row.active_timer_started_at));const pos=await client.query('SELECT coalesce(max(position),-1)+1 AS p FROM effort_sessions WHERE task_id=$1',[taskId]);await client.query(`INSERT INTO effort_sessions(task_id,user_id,position,started_at,stopped_at,duration_ms) VALUES($1,$2,$3,$4,$5,$6)`,[taskId,userId,Number(pos.rows[0].p),row.active_timer_started_at,now,duration]);const updated=await client.query(`UPDATE effort_tasks SET active_timer_user_id=NULL,active_timer_started_at=NULL,updated_by=$2,updated_at=now() WHERE id=$1 RETURNING *`,[taskId,userId]);const sm=await sessionsFor(client,[taskId]);return task(updated.rows[0],sm.get(taskId)||[]);});}

module.exports={listProjects,findProject,listTasks,findTask,saveProject,saveTask,deleteProject,deleteTask,activeWork,activeSubWork,switchActiveTimer,stopTimer,project,task};
