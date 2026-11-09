ALTER TABLE tenants ADD COLUMN IF NOT EXISTS work_field_settings jsonb NOT NULL DEFAULT '{"version":0,"fields":[]}'::jsonb;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS field_revision integer NOT NULL DEFAULT 0;
