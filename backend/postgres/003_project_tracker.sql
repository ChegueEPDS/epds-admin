CREATE TABLE IF NOT EXISTS project_tracker_records (
  tenant_id varchar(24) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind text NOT NULL,
  record_id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, kind, record_id)
);

CREATE INDEX IF NOT EXISTS project_tracker_unit_idx
  ON project_tracker_records(tenant_id, (data->>'unitId')) WHERE kind='work';

ALTER TABLE work_items ADD COLUMN IF NOT EXISTS status_reason text NOT NULL DEFAULT '';
