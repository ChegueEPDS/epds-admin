ALTER TABLE effort_tasks ADD COLUMN IF NOT EXISTS due_date date;

CREATE OR REPLACE FUNCTION invalidate_effort_action_dashboard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  changed_tenant varchar(24);
  changed_project varchar(24);
BEGIN
  IF TG_OP = 'UPDATE' AND (OLD.status = 'closed') = (NEW.status = 'closed')
    AND OLD.due_date IS NOT DISTINCT FROM NEW.due_date THEN
    RETURN NULL;
  END IF;
  changed_tenant := CASE WHEN TG_OP = 'DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END;
  changed_project := CASE WHEN TG_OP = 'DELETE' THEN OLD.project_id ELSE NEW.project_id END;
  IF EXISTS (SELECT 1 FROM effort_projects WHERE id = changed_project AND tenant_id = changed_tenant AND shared) THEN
    INSERT INTO work_dashboard_snapshots (tenant_id, revision)
    VALUES (changed_tenant, 1)
    ON CONFLICT (tenant_id) DO UPDATE SET revision = work_dashboard_snapshots.revision + 1;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS work_dashboard_effort_action_changed ON effort_tasks;
CREATE TRIGGER work_dashboard_effort_action_changed
AFTER INSERT OR UPDATE OR DELETE ON effort_tasks
FOR EACH ROW EXECUTE FUNCTION invalidate_effort_action_dashboard();
