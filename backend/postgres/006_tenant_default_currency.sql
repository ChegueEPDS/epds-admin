ALTER TABLE tenants ADD COLUMN IF NOT EXISTS default_currency varchar(3) NOT NULL DEFAULT 'HUF';

CREATE TABLE IF NOT EXISTS mnb_exchange_rate_snapshots (
  id text PRIMARY KEY,
  data jsonb NOT NULL
);
