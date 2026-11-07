ALTER TABLE domain_monitors ADD COLUMN IF NOT EXISTS monitoring_state jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE domain_health_checks ADD COLUMN IF NOT EXISTS measurement jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE TABLE IF NOT EXISTS domain_operations (
  key text PRIMARY KEY,
  kind text NOT NULL,
  tenant_id varchar(24) NOT NULL,
  month varchar(7),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  content bytea,
  sent_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS domain_operations_month_idx ON domain_operations(tenant_id,kind,month DESC);
CREATE INDEX IF NOT EXISTS domain_operations_pending_idx ON domain_operations(next_attempt_at) WHERE sent_at IS NULL;

-- Reclassify legacy successful-but-slow responses before producing customer reports.
UPDATE domain_health_checks SET ok=true,status='warning',warning_type='slow_response',warning_message=error_message,error_type=NULL,error_message=NULL WHERE error_type='slow_response';
UPDATE domain_monitors SET last_status='warning',last_warning_type='slow_response',last_warning=last_error,last_error_type=NULL,last_error=NULL,current_issue_since=NULL WHERE last_error_type='slow_response';
