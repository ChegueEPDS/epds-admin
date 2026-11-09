CREATE TABLE IF NOT EXISTS work_dashboard_snapshots (
  tenant_id varchar(24) PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  revision bigint NOT NULL DEFAULT 0,
  snapshot_key text,
  generated_at timestamptz,
  report jsonb
);

CREATE OR REPLACE FUNCTION invalidate_work_dashboard_snapshot() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  changed_tenant varchar(24);
BEGIN
  changed_tenant := CASE WHEN TG_OP = 'DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END;
  INSERT INTO work_dashboard_snapshots (tenant_id, revision)
  VALUES (changed_tenant, 1)
  ON CONFLICT (tenant_id) DO UPDATE SET revision = work_dashboard_snapshots.revision + 1;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS work_dashboard_work_changed ON work_items;
CREATE TRIGGER work_dashboard_work_changed
AFTER INSERT OR UPDATE OR DELETE ON work_items
FOR EACH ROW EXECUTE FUNCTION invalidate_work_dashboard_snapshot();

DROP TRIGGER IF EXISTS work_dashboard_sub_work_changed ON sub_work_items;
CREATE TRIGGER work_dashboard_sub_work_changed
AFTER INSERT OR UPDATE OR DELETE ON sub_work_items
FOR EACH ROW EXECUTE FUNCTION invalidate_work_dashboard_snapshot();
