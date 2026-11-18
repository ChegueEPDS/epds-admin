ALTER TABLE sub_work_items ADD COLUMN IF NOT EXISTS exchange_rates jsonb NOT NULL DEFAULT '{}';
