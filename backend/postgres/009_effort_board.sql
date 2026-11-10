ALTER TABLE effort_projects ADD COLUMN IF NOT EXISTS shared boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS effort_projects_shared_work
  ON effort_projects(tenant_id, work_item_id) WHERE shared AND work_item_id IS NOT NULL;

ALTER TABLE effort_tasks
  ADD COLUMN IF NOT EXISTS assignee_id varchar(24) REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assignee_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS estimate_ms bigint CHECK (estimate_ms >= 0),
  ADD COLUMN IF NOT EXISTS net_adjustment_ms bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_corrections jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS timer_paused boolean NOT NULL DEFAULT false;

ALTER TABLE effort_tasks DROP CONSTRAINT IF EXISTS effort_tasks_status_check;
ALTER TABLE effort_tasks ADD CONSTRAINT effort_tasks_status_check
  CHECK (status IN ('open', 'new', 'in_progress', 'closed'));

-- The old API allowed the same user to start timers in different tenants.
-- Keep their latest timer running and record the elapsed time of the others.
WITH running AS (
  SELECT id, active_timer_user_id AS user_id, active_timer_started_at AS started_at,
    row_number() OVER (PARTITION BY active_timer_user_id ORDER BY active_timer_started_at DESC, id DESC) AS rank
  FROM effort_tasks
  WHERE active_timer_user_id IS NOT NULL AND active_timer_started_at IS NOT NULL
), paused AS (
  UPDATE effort_tasks AS task SET
    active_timer_user_id = NULL,
    active_timer_started_at = NULL,
    timer_paused = true,
    first_started_at = coalesce(task.first_started_at, least(running.started_at,
      (SELECT min(started_at) FROM effort_sessions WHERE task_id = task.id))),
    updated_at = statement_timestamp()
  FROM running
  WHERE task.id = running.id AND running.rank > 1
  RETURNING task.id, running.user_id, running.started_at,
    greatest(running.started_at, statement_timestamp()) AS stopped_at
)
INSERT INTO effort_sessions (task_id, user_id, position, started_at, stopped_at, duration_ms)
SELECT paused.id, paused.user_id,
  (SELECT coalesce(max(position), -1) + 1 FROM effort_sessions WHERE task_id = paused.id),
  paused.started_at, paused.stopped_at,
  floor(extract(epoch FROM paused.stopped_at - paused.started_at) * 1000)::bigint
FROM paused;

CREATE UNIQUE INDEX IF NOT EXISTS effort_tasks_one_active_timer_per_user
  ON effort_tasks(active_timer_user_id) WHERE active_timer_started_at IS NOT NULL;
