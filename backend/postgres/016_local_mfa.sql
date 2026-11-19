CREATE TABLE IF NOT EXISTS local_mfa (
  user_id varchar(24) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  revision text NOT NULL,
  state jsonb NOT NULL
);

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS mfa_version text;
