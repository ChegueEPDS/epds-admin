ALTER TABLE work_items ADD COLUMN IF NOT EXISTS entity_id uuid;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS service_type_id uuid;
