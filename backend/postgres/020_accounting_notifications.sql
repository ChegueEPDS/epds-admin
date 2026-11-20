ALTER TABLE tenants ADD COLUMN IF NOT EXISTS accounting_notifications jsonb;

CREATE TABLE IF NOT EXISTS accounting_notification_outbox (
  id uuid PRIMARY KEY,
  payload jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE INDEX IF NOT EXISTS accounting_notification_pending
  ON accounting_notification_outbox (next_attempt_at) WHERE sent_at IS NULL;
