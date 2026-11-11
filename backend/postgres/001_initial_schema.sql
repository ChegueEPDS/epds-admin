BEGIN;

CREATE TABLE IF NOT EXISTS migration_runs (
  id bigserial PRIMARY KEY,
  source_database text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'running',
  source_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  target_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text
);

-- Lossless source archive. Every BSON document is stored as MongoDB Extended
-- JSON before relational projection. It is not used by the application, but
-- guarantees that no source field is discarded by the migration.
CREATE TABLE IF NOT EXISTS mongo_source_documents (
  collection_name text NOT NULL,
  document_id text NOT NULL,
  document jsonb NOT NULL,
  source_updated_at timestamptz,
  imported_at timestamptz NOT NULL DEFAULT now(),
  last_seen_run_id bigint REFERENCES migration_runs(id) ON DELETE SET NULL,
  PRIMARY KEY (collection_name, document_id)
);

ALTER TABLE mongo_source_documents
  ADD COLUMN IF NOT EXISTS last_seen_run_id bigint REFERENCES migration_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS mongo_source_documents_collection_idx
  ON mongo_source_documents(collection_name);

CREATE TABLE IF NOT EXISTS tenants (
  id varchar(24) PRIMARY KEY,
  name text NOT NULL UNIQUE,
  display_name text,
  type text NOT NULL CHECK (type IN ('company', 'client', 'finance')),
  owner_user_id varchar(24),
  seats_max integer NOT NULL DEFAULT 0 CHECK (seats_max >= 0),
  seats_used integer NOT NULL DEFAULT 0 CHECK (seats_used >= 0),
  seats_managed text NOT NULL DEFAULT 'stripe' CHECK (seats_managed IN ('stripe', 'manual')),
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  profession_rbac_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id varchar(24) PRIMARY KEY,
  azure_id text UNIQUE,
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text NOT NULL UNIQUE,
  nickname text,
  tenant_id varchar(24) REFERENCES tenants(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('User', 'Admin', 'Finance', 'SuperAdmin')),
  professions jsonb NOT NULL DEFAULT '[]'::jsonb,
  password text,
  email_verified boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

DO $$ BEGIN
  ALTER TABLE tenants ADD CONSTRAINT tenants_owner_user_fk FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS sessions (
  id varchar(24) PRIMARY KEY,
  user_id varchar(24) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id varchar(24) REFERENCES tenants(id) ON DELETE CASCADE,
  client_type text NOT NULL DEFAULT 'web' CHECK (client_type IN ('web', 'mobile')),
  refresh_token_hash text NOT NULL,
  previous_refresh_token_hash text,
  previous_refresh_token_grace_until timestamptz,
  revoked_at timestamptz,
  expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz,
  last_seen_at timestamptz NOT NULL,
  user_agent text NOT NULL DEFAULT '',
  ip text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS client_companies (
  id varchar(24) PRIMARY KEY,
  tax_number text NOT NULL,
  normalized_tax_number text NOT NULL UNIQUE,
  name text NOT NULL,
  country text NOT NULL DEFAULT 'HU',
  postal_code text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  created_by varchar(24) REFERENCES users(id) ON DELETE SET NULL,
  updated_by varchar(24) REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS client_company_tenants (
  client_company_id varchar(24) NOT NULL REFERENCES client_companies(id) ON DELETE CASCADE,
  tenant_id varchar(24) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  PRIMARY KEY (client_company_id, tenant_id)
);

CREATE TABLE IF NOT EXISTS work_items (
  id varchar(24) PRIMARY KEY,
  tenant_id varchar(24) NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  year integer NOT NULL CHECK (year BETWEEN 2000 AND 9999),
  sequence_number integer NOT NULL CHECK (sequence_number > 0),
  work_number text NOT NULL,
  name text NOT NULL,
  client_id varchar(24) REFERENCES client_companies(id) ON DELETE SET NULL,
  customer text NOT NULL DEFAULT '',
  responsible_user_id varchar(24) REFERENCES users(id) ON DELETE SET NULL,
  responsible text NOT NULL DEFAULT '',
  contributors jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL,
  deadline timestamptz,
  description text NOT NULL DEFAULT '',
  currency text NOT NULL DEFAULT 'HUF',
  total_amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  cost_amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (cost_amount >= 0),
  subcontractor text NOT NULL DEFAULT '',
  payment_deadline_days integer NOT NULL DEFAULT 30 CHECK (payment_deadline_days >= 0),
  offer_date timestamptz,
  completion_date timestamptz,
  invoice_date timestamptz,
  paid_at timestamptz,
  invoice_payment_deadline timestamptz,
  invoice_number text NOT NULL DEFAULT '',
  contract_signed boolean NOT NULL DEFAULT false,
  performance_certificate boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  created_by varchar(24) REFERENCES users(id) ON DELETE SET NULL,
  updated_by varchar(24) REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (tenant_id, year, sequence_number)
);

CREATE TABLE IF NOT EXISTS sub_work_items (
  id varchar(24) PRIMARY KEY,
  tenant_id varchar(24) NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  work_item_id varchar(24) NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  sequence_number integer NOT NULL CHECK (sequence_number > 0),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  responsible_user_id varchar(24) REFERENCES users(id) ON DELETE SET NULL,
  responsible text NOT NULL DEFAULT '',
  contributors jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL,
  deadline timestamptz,
  completed_at timestamptz,
  planned_hours numeric(12,2) NOT NULL DEFAULT 0 CHECK (planned_hours >= 0),
  amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  currency text NOT NULL DEFAULT 'HUF',
  performance_certificate_required boolean NOT NULL DEFAULT false,
  performance_certificate_signed boolean NOT NULL DEFAULT false,
  invoice_number text NOT NULL DEFAULT '',
  invoice_date timestamptz,
  invoice_payment_deadline timestamptz,
  paid_amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  paid_at timestamptz,
  archived_at timestamptz,
  archived_by_work_at timestamptz,
  created_by varchar(24) REFERENCES users(id) ON DELETE SET NULL,
  updated_by varchar(24) REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (tenant_id, work_item_id, sequence_number)
);

CREATE TABLE IF NOT EXISTS work_documents (
  id varchar(24) PRIMARY KEY,
  tenant_id varchar(24) NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  work_item_id varchar(24) NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  category text NOT NULL,
  display_name text NOT NULL,
  file_name text NOT NULL,
  storage_key text NOT NULL,
  content_type text NOT NULL DEFAULT 'application/octet-stream',
  size bigint NOT NULL DEFAULT 0 CHECK (size >= 0),
  uploaded_by varchar(24) REFERENCES users(id) ON DELETE SET NULL,
  uploaded_by_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS work_sequences (
  id varchar(24) PRIMARY KEY,
  tenant_id varchar(24) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key text NOT NULL,
  value integer NOT NULL DEFAULT 0 CHECK (value >= 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (tenant_id, key)
);

CREATE TABLE IF NOT EXISTS effort_projects (
  id varchar(24) PRIMARY KEY,
  tenant_id varchar(24) REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  normalized_name text NOT NULL,
  customer text NOT NULL DEFAULT '',
  comment text NOT NULL DEFAULT '',
  work_item_id varchar(24) REFERENCES work_items(id) ON DELETE SET NULL,
  work_item_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK (status IN ('open', 'closed')),
  closed_at timestamptz,
  closed_net_ms bigint NOT NULL DEFAULT 0,
  closed_gross_ms bigint NOT NULL DEFAULT 0,
  created_by varchar(24) REFERENCES users(id) ON DELETE SET NULL,
  updated_by varchar(24) REFERENCES users(id) ON DELETE SET NULL,
  closed_by varchar(24) REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS effort_tasks (
  id varchar(24) PRIMARY KEY,
  project_id varchar(24) NOT NULL REFERENCES effort_projects(id) ON DELETE CASCADE,
  tenant_id varchar(24) REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  note text NOT NULL DEFAULT '',
  sub_work_item_id varchar(24) REFERENCES sub_work_items(id) ON DELETE SET NULL,
  sub_work_item_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK (status IN ('open', 'closed')),
  archived_net_ms bigint NOT NULL DEFAULT 0,
  archived_session_count integer NOT NULL DEFAULT 0,
  first_started_at timestamptz,
  active_timer_user_id varchar(24) REFERENCES users(id) ON DELETE SET NULL,
  active_timer_started_at timestamptz,
  closed_at timestamptz,
  closed_net_ms bigint NOT NULL DEFAULT 0,
  closed_gross_ms bigint NOT NULL DEFAULT 0,
  created_by varchar(24) REFERENCES users(id) ON DELETE SET NULL,
  updated_by varchar(24) REFERENCES users(id) ON DELETE SET NULL,
  closed_by varchar(24) REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS effort_sessions (
  id bigserial PRIMARY KEY,
  task_id varchar(24) NOT NULL REFERENCES effort_tasks(id) ON DELETE CASCADE,
  user_id varchar(24) NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  position integer NOT NULL,
  started_at timestamptz NOT NULL,
  stopped_at timestamptz,
  duration_ms bigint NOT NULL DEFAULT 0,
  UNIQUE (task_id, position)
);

CREATE TABLE IF NOT EXISTS domain_monitors (
  id varchar(24) PRIMARY KEY,
  name text NOT NULL,
  base_url text NOT NULL,
  normalized_url text NOT NULL UNIQUE,
  owner text NOT NULL DEFAULT 'EPDS',
  tenant_id varchar(24) REFERENCES tenants(id) ON DELETE SET NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_by varchar(24) REFERENCES users(id) ON DELETE SET NULL,
  updated_by varchar(24) REFERENCES users(id) ON DELETE SET NULL,
  last_checked_at timestamptz,
  last_status text NOT NULL DEFAULT 'unknown',
  last_response_ms integer,
  last_status_code integer,
  last_error text,
  last_error_type text,
  last_warning text,
  last_warning_type text,
  last_final_url text,
  last_redirect_count integer,
  last_content_type text,
  last_content_length bigint,
  last_tls_valid_to timestamptz,
  last_tls_days_remaining integer,
  current_issue_since timestamptz,
  last_failure_at timestamptz,
  last_recovery_at timestamptz,
  health_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS domain_health_checks (
  id varchar(24) PRIMARY KEY,
  domain_id varchar(24) NOT NULL REFERENCES domain_monitors(id) ON DELETE CASCADE,
  checked_at timestamptz NOT NULL,
  ok boolean NOT NULL,
  status text NOT NULL DEFAULT 'ok',
  status_code integer,
  response_ms integer,
  final_url text,
  redirect_count integer,
  content_type text,
  content_length bigint,
  tls_valid_to timestamptz,
  tls_days_remaining integer,
  error_type text,
  error_message text,
  warning_type text,
  warning_message text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS domain_health_daily_rollups (
  id varchar(24) PRIMARY KEY,
  domain_id varchar(24) NOT NULL REFERENCES domain_monitors(id) ON DELETE CASCADE,
  day date NOT NULL,
  total_checks integer NOT NULL,
  ok_count integer NOT NULL,
  warning_count integer NOT NULL,
  error_count integer NOT NULL,
  response_ms_sum bigint NOT NULL,
  response_ms_count integer NOT NULL,
  response_ms_samples jsonb NOT NULL DEFAULT '[]'::jsonb,
  first_checked_at timestamptz,
  last_checked_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (domain_id, day)
);

CREATE TABLE IF NOT EXISTS domain_page_speed_scans (
  id varchar(24) PRIMARY KEY,
  domain_id varchar(24) NOT NULL REFERENCES domain_monitors(id) ON DELETE CASCADE,
  checked_at timestamptz NOT NULL,
  source text NOT NULL,
  scans jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS domain_status_pdfs (
  id varchar(24) PRIMARY KEY,
  owner_slug text NOT NULL,
  report_date date NOT NULL,
  report_generated_at timestamptz NOT NULL,
  content bytea NOT NULL,
  size bigint NOT NULL,
  etag text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (owner_slug, report_date)
);

CREATE TABLE IF NOT EXISTS domain_status_report_snapshots (
  id varchar(24) PRIMARY KEY,
  owner_slug text NOT NULL UNIQUE,
  generated_at timestamptz NOT NULL,
  report jsonb NOT NULL,
  build_duration_ms bigint NOT NULL,
  ready boolean NOT NULL DEFAULT false,
  lease_until timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS license_customers (
  id varchar(24) PRIMARY KEY,
  tenant_id varchar(24) REFERENCES tenants(id) ON DELETE RESTRICT,
  customer_name text NOT NULL,
  normalized_customer_name text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL,
  status_version integer NOT NULL DEFAULT 0,
  integration_event_version integer NOT NULL DEFAULT 0,
  ordered_from_status text NOT NULL DEFAULT '',
  object_limit_option text NOT NULL,
  custom_object_limit integer,
  expires_at timestamptz NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by varchar(24) REFERENCES users(id) ON DELETE SET NULL,
  updated_by varchar(24) REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS license_customer_tenant_name_unique
  ON license_customers(tenant_id, normalized_customer_name) WHERE tenant_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS integration_clients (
  id varchar(24) PRIMARY KEY,
  name text NOT NULL,
  key_prefix text NOT NULL UNIQUE,
  key_hash text NOT NULL UNIQUE,
  status text NOT NULL,
  scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  webhook_url text NOT NULL DEFAULT '',
  webhook_secret_encrypted text NOT NULL DEFAULT '',
  webhook_enabled boolean NOT NULL DEFAULT false,
  last_used_at timestamptz,
  last_webhook_success_at timestamptz,
  revoked_at timestamptz,
  created_by varchar(24) REFERENCES users(id) ON DELETE SET NULL,
  updated_by varchar(24) REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS license_events (
  id varchar(24) PRIMARY KEY,
  event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  license_id varchar(24) NOT NULL REFERENCES license_customers(id) ON DELETE CASCADE,
  status_version integer NOT NULL,
  previous_status text NOT NULL,
  status text NOT NULL,
  payload jsonb NOT NULL,
  actor jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  deliveries_ensured_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (license_id, status_version)
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id varchar(24) PRIMARY KEY,
  event_id varchar(24) NOT NULL REFERENCES license_events(id) ON DELETE CASCADE,
  client_id varchar(24) NOT NULL REFERENCES integration_clients(id) ON DELETE CASCADE,
  status text NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL,
  locked_until timestamptz,
  delivered_at timestamptz,
  last_attempt_at timestamptz,
  last_status_code integer,
  last_error text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (event_id, client_id)
);

CREATE TABLE IF NOT EXISTS integration_requests (
  id varchar(24) PRIMARY KEY,
  client_id varchar(24) NOT NULL REFERENCES integration_clients(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  status text NOT NULL,
  response_status integer,
  response_body jsonb,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (client_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS webhook_test_receipts (
  id varchar(24) PRIMARY KEY,
  inbox_token_hash text NOT NULL,
  method text NOT NULL DEFAULT 'POST',
  path text NOT NULL,
  headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_body text NOT NULL DEFAULT '',
  parsed_body jsonb,
  byte_length bigint NOT NULL DEFAULT 0,
  received_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS scheduled_job_leases (
  id varchar(24) PRIMARY KEY,
  name text NOT NULL UNIQUE,
  holder text NOT NULL,
  locked_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS work_items_list_idx ON work_items(tenant_id, archived_at, status, deadline, updated_at DESC);
CREATE INDEX IF NOT EXISTS sub_work_items_list_idx ON sub_work_items(tenant_id, work_item_id, archived_at, status, sequence_number);
CREATE INDEX IF NOT EXISTS work_documents_list_idx ON work_documents(tenant_id, work_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS effort_projects_list_idx ON effort_projects(tenant_id, created_by, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS effort_tasks_list_idx ON effort_tasks(tenant_id, created_by, project_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS domain_checks_history_idx ON domain_health_checks(domain_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS domain_scans_history_idx ON domain_page_speed_scans(domain_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS webhook_delivery_worker_idx ON webhook_deliveries(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS webhook_receipt_inbox_idx ON webhook_test_receipts(inbox_token_hash, received_at DESC);

COMMIT;

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
