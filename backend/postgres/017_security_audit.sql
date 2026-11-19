CREATE TABLE IF NOT EXISTS security_audit_events (
  id uuid PRIMARY KEY,
  occurred_at timestamptz NOT NULL,
  event jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS security_audit_events_time ON security_audit_events (occurred_at);
CREATE INDEX IF NOT EXISTS security_audit_events_tenant_time
  ON security_audit_events ((event->>'tenantId'), occurred_at);

CREATE OR REPLACE FUNCTION reject_security_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Security audit records are append-only';
END;
$$;

DROP TRIGGER IF EXISTS security_audit_append_only ON security_audit_events;
CREATE TRIGGER security_audit_append_only
  BEFORE UPDATE OR DELETE OR TRUNCATE ON security_audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION reject_security_audit_mutation();
