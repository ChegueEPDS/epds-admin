const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

test('PostgreSQL startup upgrades the existing effort board and preserves overlapping legacy timers', {
  skip: process.env.EFFORT_SCHEMA_QA !== 'true'
}, async () => {
  const db = require('../src/postgres');
  const { connectDb } = require('../src/db');
  const effort = require('../src/repositories/postgres/effortRepository');
  const migration = '009_effort_board';
  const actor = 'schema-user';
  const tenant = 'schema-tenant';
  const otherTenant = 'other-schema-tenant';
  const older = 'older-task';
  const newer = 'newer-task';
  const scope = [tenant, actor, true];

  try {
    assert.equal((await db.query('SELECT current_database() AS name')).rows[0].name, 'epds_effort_schema_qa');
    await db.query(await fs.readFile(path.join(__dirname, '../postgres/001_initial_schema.sql'), 'utf8'));
    await db.query(`INSERT INTO tenants(id,name,type,created_at,updated_at)
      VALUES ($1::varchar,$1::varchar,'company',now(),now()),
             ($2::varchar,$2::varchar,'company',now(),now())`, [tenant, otherTenant]);
    await db.query(`INSERT INTO users(id,first_name,last_name,email,tenant_id,role,created_at,updated_at)
      VALUES ($1,'Schema','QA','schema@example.test',$2,'SuperAdmin',now(),now())`, [actor, tenant]);
    await db.query(`INSERT INTO effort_projects(id,tenant_id,name,normalized_name,status,created_by,created_at,updated_at)
      VALUES ('older-project',$1,'Older','older','open',$3,now(),now()),
             ('newer-project',$2,'Newer','newer','open',$3,now(),now())`, [tenant, otherTenant, actor]);
    await db.query(`INSERT INTO effort_tasks
      (id,project_id,tenant_id,name,status,active_timer_user_id,active_timer_started_at,created_at,updated_at)
      VALUES ($1,'older-project',$3,'Older timer','open',$5,now()-interval '5 minutes',now(),now()),
             ($2,'newer-project',$4,'Newer timer','open',$5,now()-interval '1 minute',now(),now())`,
    [older, newer, tenant, otherTenant, actor]);

    await assert.rejects(effort.listProjects(db, scope, null), { code: '42703' });
    await Promise.all([connectDb(), connectDb()]);
    assert.equal((await effort.listProjects(db, scope, null))[0].shared, false);
    const paused = await effort.findTask(db, 'older-project', older);
    assert.equal(paused.activeTimer, undefined);
    assert.equal(paused.timerPaused, true);
    assert.equal(paused.sessions.length, 1);
    assert.equal(paused.sessions[0].userId, actor);
    assert.ok(paused.sessions[0].durationMs >= 300000);
    const running = await effort.findTask(db, 'newer-project', newer);
    assert.equal(running.activeTimer.userId, actor);

    await connectDb();
    assert.equal((await effort.findTask(db, 'older-project', older)).sessions.length, 1);
    assert.equal((await db.query('SELECT id FROM app_schema_migrations WHERE id=$1', [migration])).rowCount, 1);
    await assert.rejects(db.query(`UPDATE effort_tasks SET active_timer_user_id=$1, active_timer_started_at=now()
      WHERE id=$2`, [actor, older]), { code: '23505', constraint: 'effort_tasks_one_active_timer_per_user' });
    await db.query("UPDATE effort_tasks SET status='in_progress', estimate_ms=60000 WHERE id=$1", [newer]);
  } finally {
    await db.closePostgres();
  }
});
