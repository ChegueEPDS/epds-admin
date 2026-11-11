ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_type_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_type_check CHECK (type IN ('company', 'client', 'finance'));
