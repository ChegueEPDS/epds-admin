ALTER TABLE work_items ADD COLUMN IF NOT EXISTS reporting jsonb NOT NULL DEFAULT '{}'::jsonb;
