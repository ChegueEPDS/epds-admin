ALTER TABLE users ADD COLUMN IF NOT EXISTS additional_tenant_ids varchar(24)[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS users_additional_tenant_ids_idx ON users USING gin (additional_tenant_ids);
