ALTER TABLE tenants ADD COLUMN IF NOT EXISTS weekly_work_summary_since timestamptz;

CREATE TABLE IF NOT EXISTS work_status_changes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id varchar(24) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  work_id varchar(24) NOT NULL,
  changed_at timestamptz NOT NULL,
  payload jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS work_status_changes_week
  ON work_status_changes (tenant_id, changed_at);
