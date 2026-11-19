ALTER TABLE users ADD COLUMN IF NOT EXISTS login_method text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS microsoft_tenant_id text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_token_hash text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_token_expires_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_token_purpose text;
CREATE UNIQUE INDEX IF NOT EXISTS users_account_token_hash_idx
  ON users (account_token_hash) WHERE account_token_hash IS NOT NULL;
