ALTER TABLE tenants ADD COLUMN IF NOT EXISTS work_turnover_day varchar(5) NOT NULL DEFAULT '01-01'
  CHECK (work_turnover_day ~ '^((01|03|05|07|08|10|12)-(0[1-9]|[12][0-9]|3[01])|(04|06|09|11)-(0[1-9]|[12][0-9]|30)|02-(0[1-9]|[12][0-9]))$');
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS align_work_sequence boolean NOT NULL DEFAULT false;
