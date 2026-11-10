const mongoose = require('mongoose');
const { query, withTransaction } = require('../../postgres');
const { pgOrderBy } = require('../../services/workBoardSort');

const id = () => String(new mongoose.Types.ObjectId());
const TERMINAL = ['completed_billable', 'invoiced', 'paid', 'closed', 'cancelled', 'lost'];

function work(row) {
  if (!row) return null;
  return {
    _id: row.id, id: row.id, tenantId: row.tenant_id, year: row.year,
    sequenceNumber: row.sequence_number, workNumber: row.work_number, name: row.name,
    clientId: row.client_id, customer: row.customer, responsibleUserId: row.responsible_user_id,
    entityId: row.entity_id || null, serviceTypeId: row.service_type_id || null,
    responsible: row.responsible, contributors: row.contributors || [], status: row.status,
    deadline: row.deadline, description: row.description, currency: row.currency,
    customFields: row.custom_fields || {}, fieldRevision: row.field_revision || 0,
    reporting: row.reporting || {},
    totalAmount: Number(row.total_amount), costAmount: Number(row.cost_amount),
    subcontractor: row.subcontractor, paymentDeadlineDays: row.payment_deadline_days,
    offerDate: row.offer_date, completionDate: row.completion_date, invoiceDate: row.invoice_date,
    invoicePaymentDeadline: row.invoice_payment_deadline, invoiceNumber: row.invoice_number,
    contractSigned: row.contract_signed, performanceCertificate: row.performance_certificate,
    archivedAt: row.archived_at, createdBy: row.created_by, updatedBy: row.updated_by,
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

function subWork(row) {
  if (!row) return null;
  return {
    _id: row.id, id: row.id, tenantId: row.tenant_id, workItemId: row.work_item_id,
    sequenceNumber: row.sequence_number, name: row.name, description: row.description,
    responsibleUserId: row.responsible_user_id, responsible: row.responsible,
    contributors: row.contributors || [], status: row.status, deadline: row.deadline,
    completedAt: row.completed_at, plannedHours: Number(row.planned_hours),
    amount: Number(row.amount), currency: row.currency,
    performanceCertificateRequired: row.performance_certificate_required,
    performanceCertificateSigned: row.performance_certificate_signed,
    invoiceNumber: row.invoice_number, invoiceDate: row.invoice_date,
    invoicePaymentDeadline: row.invoice_payment_deadline, paidAmount: Number(row.paid_amount),
    paidAt: row.paid_at, archivedAt: row.archived_at, archivedByWorkAt: row.archived_by_work_at,
    createdBy: row.created_by, updatedBy: row.updated_by, createdAt: row.created_at, updatedAt: row.updated_at
  };
}

function document(row) {
  if (!row) return null;
  return { _id: row.id, id: row.id, tenantId: row.tenant_id, workItemId: row.work_item_id,
    category: row.category, displayName: row.display_name, fileName: row.file_name,
    storageKey: row.storage_key, contentType: row.content_type, size: Number(row.size),
    uploadedBy: row.uploaded_by, uploadedByName: row.uploaded_by_name,
    createdAt: row.created_at, updatedAt: row.updated_at };
}

async function listSubWorks(tenantId, workIds, deleted = false) {
  if (!workIds.length) return [];
  const result = await query(`SELECT * FROM sub_work_items
    WHERE tenant_id=$1 AND work_item_id=ANY($2::varchar[])
      AND ${deleted ? 'archived_by_work_at IS NOT NULL' : 'archived_at IS NULL'}
    ORDER BY sequence_number`, [tenantId, workIds]);
  return result.rows.map(subWork);
}

async function listBoardOptions(tenantId) {
  const { rows } = await query(`SELECT id, work_number AS "workNumber", name, customer, status
    FROM work_items WHERE tenant_id=$1 AND archived_at IS NULL ORDER BY work_number DESC`, [tenantId]);
  const byWork = new Map(rows.map((row) => [row.id, { ...row, subWorks: [] }]));
  for (const item of await listSubWorks(tenantId, rows.map((row) => row.id))) {
    const parent = byWork.get(item.workItemId);
    parent.subWorks.push({ id: item.id, name: item.name, status: item.status, sequenceNumber: item.sequenceNumber,
      subWorkNumber: `${parent.workNumber}/${String(item.sequenceNumber).padStart(2, '0')}` });
  }
  return [...byWork.values()];
}

async function list({ tenantId, status = 'active', search = '', page = 1, limit = 50, sort }) {
  const params = [tenantId];
  const where = ['tenant_id=$1'];
  if (status === 'deleted') where.push('archived_at IS NOT NULL');
  else {
    where.push('archived_at IS NULL');
    if (status === 'active') { params.push(TERMINAL); where.push(`status<>ALL($${params.length}::text[])`); }
    else if (status && status !== 'all') { params.push(status); where.push(`status=$${params.length}`); }
  }
  if (search.trim()) {
    params.push(`%${search.trim()}%`);
    where.push(`(work_number ILIKE $${params.length} OR name ILIKE $${params.length} OR customer ILIKE $${params.length})`);
  }
  const clause = where.join(' AND ');
  const count = await query(`SELECT count(*)::int AS count FROM work_items WHERE ${clause}`, params);
  const orderBy = sort ? pgOrderBy(sort, params, status === 'deleted') : 'w.status, w.deadline NULLS LAST, w.updated_at DESC';
  params.push(Math.max(1, limit), Math.max(0, (page - 1) * limit));
  const rows = await query(`SELECT w.* FROM work_items w WHERE ${clause}
    ORDER BY ${orderBy} LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  const works = rows.rows.map(work);
  const children = await listSubWorks(tenantId, works.map((item) => item.id), status === 'deleted');
  const byWork = new Map();
  children.forEach((item) => byWork.set(item.workItemId, [...(byWork.get(item.workItemId) || []), item]));
  const summary = await query(`SELECT currency, count(*)::int AS active_count,
    count(*) FILTER (WHERE deadline<CURRENT_DATE)::int AS overdue_count, sum(total_amount) AS active_value
    FROM work_items WHERE tenant_id=$1 AND archived_at IS NULL AND status<>ALL($2::text[]) GROUP BY currency`, [tenantId, TERMINAL]);
  return { works: works.map((item) => ({ ...item, subWorks: byWork.get(item.id) || [] })),
    total: count.rows[0].count, summary: {
      activeCount: summary.rows.reduce((sum, row) => sum + row.active_count, 0),
      overdueCount: summary.rows.reduce((sum, row) => sum + row.overdue_count, 0)
    }, activeAmounts: summary.rows.map((row) => ({ currency: row.currency, amount: row.active_value })) };
}

async function findWork(tenantId, workId, includeDeleted = false) {
  const result = await query(`SELECT * FROM work_items WHERE id=$1 AND tenant_id=$2
    AND ${includeDeleted ? 'archived_at IS NOT NULL' : 'archived_at IS NULL'}`, [workId, tenantId]);
  const item = work(result.rows[0]);
  if (!item) return null;
  item.subWorks = await listSubWorks(tenantId, [workId], includeDeleted);
  return item;
}

async function nextSequence(client, tenantId, year) {
  const key = `work:${year}`;
  const result = await client.query(`INSERT INTO work_sequences(id,tenant_id,key,value,created_at,updated_at)
    SELECT $1::varchar,$2::varchar,$3::text,COALESCE(MAX(sequence_number),0)+1,now(),now()
    FROM work_items WHERE tenant_id=$2::varchar AND year=$4::integer
    ON CONFLICT(tenant_id,key) DO UPDATE
    SET value=GREATEST(work_sequences.value+1,EXCLUDED.value),updated_at=now() RETURNING value`, [id(), tenantId, key, year]);
  return Number(result.rows[0].value);
}

async function createWork(tenantId, actorId, input) {
  return withTransaction(async (client) => {
    const year = Number(input.year || new Date().getFullYear());
    const sequence = await nextSequence(client, tenantId, year);
    const workId = id();
    const result = await client.query(`INSERT INTO work_items
      (id,tenant_id,year,sequence_number,work_number,name,client_id,customer,responsible_user_id,responsible,
       contributors,status,deadline,description,currency,total_amount,cost_amount,subcontractor,payment_deadline_days,
       offer_date,completion_date,invoice_date,invoice_payment_deadline,invoice_number,contract_signed,
       performance_certificate,created_by,updated_by,created_at,updated_at,custom_fields,entity_id,service_type_id,reporting)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$27,now(),now(),$28::jsonb,$29,$30,$31::jsonb) RETURNING *`,
    [workId, tenantId, year, sequence, input.workNumber || `${String(year).slice(-2)}-${String(sequence).padStart(4, '0')}`,
      input.name, input.clientId || null, input.customer || '', input.responsibleUserId || null, input.responsible || '',
      JSON.stringify(input.contributors || []), input.status || 'inquiry', input.deadline || null, input.description || '',
      input.currency || 'HUF', Number(input.totalAmount || 0), Number(input.costAmount || 0), input.subcontractor || '',
      Number(input.paymentDeadlineDays ?? 30), input.offerDate || null, input.completionDate || null,
      input.invoiceDate || null, input.invoicePaymentDeadline || null, input.invoiceNumber || '',
      Boolean(input.contractSigned), Boolean(input.performanceCertificate), actorId, JSON.stringify(input.customFields || {}),
      input.entityId || null, input.serviceTypeId || null, JSON.stringify(input.reporting || {})]);
    return work(result.rows[0]);
  });
}

const WORK_MUTABLE = new Map([
  ['name','name'],['clientId','client_id'],['customer','customer'],['responsibleUserId','responsible_user_id'],
  ['entityId','entity_id'],['serviceTypeId','service_type_id'],
  ['responsible','responsible'],['status','status'],['deadline','deadline'],['description','description'],
  ['currency','currency'],['totalAmount','total_amount'],['costAmount','cost_amount'],['subcontractor','subcontractor'],
  ['paymentDeadlineDays','payment_deadline_days'],['offerDate','offer_date'],['completionDate','completion_date'],
  ['invoiceDate','invoice_date'],['invoicePaymentDeadline','invoice_payment_deadline'],['invoiceNumber','invoice_number'],
  ['contractSigned','contract_signed'],['performanceCertificate','performance_certificate']
]);

async function updateWork(tenantId, workId, actorId, input, expectedRevision) {
  const sets = []; const params = [workId, tenantId];
  for (const [key, column] of WORK_MUTABLE) if (Object.hasOwn(input, key)) {
    params.push(input[key] === '' && ['clientId','responsibleUserId'].includes(key) ? null : input[key]);
    sets.push(`${column}=$${params.length}`);
  }
  if (Object.hasOwn(input, 'contributors')) { params.push(JSON.stringify(input.contributors || [])); sets.push(`contributors=$${params.length}::jsonb`); }
  if (Object.hasOwn(input, 'reporting')) { params.push(JSON.stringify(input.reporting)); sets.push(`reporting=$${params.length}::jsonb`); }
  if (Object.hasOwn(input, 'customFields')) {
    params.push(JSON.stringify(input.customFields));
    sets.push(`custom_fields=$${params.length}::jsonb`, 'field_revision=field_revision+1');
  }
  if (!sets.length) return findWork(tenantId, workId);
  params.push(actorId); sets.push(`updated_by=$${params.length}`, 'updated_at=now()');
  let revision = '';
  if (expectedRevision !== undefined) {
    params.push(expectedRevision);
    revision = ` AND field_revision=$${params.length}`;
  }
  const result = await query(`UPDATE work_items SET ${sets.join(',')} WHERE id=$1 AND tenant_id=$2 AND archived_at IS NULL${revision} RETURNING *`, params);
  return work(result.rows[0]);
}

async function archiveWork(tenantId, workId, actorId) {
  return withTransaction(async (client) => {
    const now = new Date();
    const result = await client.query(`UPDATE work_items SET archived_at=$3,updated_by=$4,updated_at=now()
      WHERE id=$1 AND tenant_id=$2 AND archived_at IS NULL RETURNING *`, [workId, tenantId, now, actorId]);
    if (!result.rows[0]) return null;
    await client.query(`UPDATE sub_work_items SET archived_at=$3,archived_by_work_at=$3,updated_by=$4,updated_at=now()
      WHERE work_item_id=$1 AND tenant_id=$2 AND archived_at IS NULL`, [workId, tenantId, now, actorId]);
    return work(result.rows[0]);
  });
}

async function restoreWork(tenantId, workId, actorId) {
  return withTransaction(async (client) => {
    const result = await client.query(`UPDATE work_items SET archived_at=NULL,updated_by=$3,updated_at=now()
      WHERE id=$1 AND tenant_id=$2 AND archived_at IS NOT NULL RETURNING *`, [workId, tenantId, actorId]);
    if (!result.rows[0]) return null;
    await client.query(`UPDATE sub_work_items SET archived_at=NULL,archived_by_work_at=NULL,updated_by=$3,updated_at=now()
      WHERE work_item_id=$1 AND tenant_id=$2 AND archived_by_work_at IS NOT NULL`, [workId, tenantId, actorId]);
    return work(result.rows[0]);
  });
}

async function createSubWork(tenantId, workId, actorId, input) {
  return withTransaction(async (client) => {
    const locked = await client.query('SELECT id FROM work_items WHERE id=$1 AND tenant_id=$2 AND archived_at IS NULL FOR UPDATE', [workId, tenantId]);
    if (!locked.rows[0]) return null;
    const seq = await client.query('SELECT coalesce(max(sequence_number),0)+1 AS value FROM sub_work_items WHERE work_item_id=$1 AND tenant_id=$2', [workId, tenantId]);
    const result = await client.query(`INSERT INTO sub_work_items
      (id,tenant_id,work_item_id,sequence_number,name,description,responsible_user_id,responsible,contributors,status,
       deadline,completed_at,planned_hours,amount,currency,performance_certificate_required,
       performance_certificate_signed,invoice_number,invoice_date,invoice_payment_deadline,paid_amount,paid_at,
       created_by,updated_by,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$23,now(),now()) RETURNING *`,
    [id(),tenantId,workId,Number(seq.rows[0].value),input.name,input.description||'',input.responsibleUserId||null,
      input.responsible||'',JSON.stringify(input.contributors||[]),input.status||'inquiry',input.deadline||null,
      input.completedAt||null,Number(input.plannedHours||0),Number(input.amount||0),input.currency||'HUF',
      Boolean(input.performanceCertificateRequired),Boolean(input.performanceCertificateSigned),input.invoiceNumber||'',
      input.invoiceDate||null,input.invoicePaymentDeadline||null,Number(input.paidAmount||0),input.paidAt||null,actorId]);
    return subWork(result.rows[0]);
  });
}

const SUB_MUTABLE = new Map([
  ['name','name'],['description','description'],['responsibleUserId','responsible_user_id'],['responsible','responsible'],
  ['status','status'],['deadline','deadline'],['completedAt','completed_at'],['plannedHours','planned_hours'],
  ['amount','amount'],['currency','currency'],['performanceCertificateRequired','performance_certificate_required'],
  ['performanceCertificateSigned','performance_certificate_signed'],['invoiceNumber','invoice_number'],
  ['invoiceDate','invoice_date'],['invoicePaymentDeadline','invoice_payment_deadline'],['paidAmount','paid_amount'],['paidAt','paid_at']
]);

async function updateSubWork(tenantId, subWorkId, actorId, input) {
  const sets=[]; const params=[subWorkId,tenantId];
  for(const [key,column] of SUB_MUTABLE) if(Object.hasOwn(input,key)){
    params.push(input[key]==='' && key==='responsibleUserId'?null:input[key]); sets.push(`${column}=$${params.length}`);
  }
  if(Object.hasOwn(input,'contributors')){params.push(JSON.stringify(input.contributors||[]));sets.push(`contributors=$${params.length}::jsonb`);}
  if(!sets.length){const r=await query('SELECT * FROM sub_work_items WHERE id=$1 AND tenant_id=$2 AND archived_at IS NULL',params);return subWork(r.rows[0]);}
  params.push(actorId);sets.push(`updated_by=$${params.length}`,'updated_at=now()');
  const result=await query(`UPDATE sub_work_items SET ${sets.join(',')} WHERE id=$1 AND tenant_id=$2 AND archived_at IS NULL RETURNING *`,params);
  return subWork(result.rows[0]);
}

async function archiveSubWork(tenantId, subWorkId, actorId) {
  const result=await query(`UPDATE sub_work_items SET archived_at=now(),updated_by=$3,updated_at=now()
    WHERE id=$1 AND tenant_id=$2 AND archived_at IS NULL RETURNING *`,[subWorkId,tenantId,actorId]);
  return subWork(result.rows[0]);
}

async function listClients(tenantId) {
  const result = await query(`SELECT c.* FROM client_companies c JOIN client_company_tenants ct ON ct.client_company_id=c.id
    WHERE ct.tenant_id=$1 ORDER BY c.name LIMIT 500`, [tenantId]);
  return result.rows.map((r) => ({ _id:r.id,id:r.id,taxNumber:r.tax_number,normalizedTaxNumber:r.normalized_tax_number,
    name:r.name,country:r.country,postalCode:r.postal_code,city:r.city,address:r.address,email:r.email,phone:r.phone }));
}

async function findClientByTaxNumber(normalizedTaxNumber) {
  const result=await query('SELECT * FROM client_companies WHERE normalized_tax_number=$1',[normalizedTaxNumber]);
  return result.rows[0]||null;
}

async function isClientLinked(clientId, tenantId) {
  const result=await query('SELECT 1 FROM client_company_tenants WHERE client_company_id=$1 AND tenant_id=$2',[clientId,tenantId]);
  return Boolean(result.rows[0]);
}

async function saveClient(tenantId, actorId, input) {
  return withTransaction(async(client)=>{
    const clientId=id();
    const result=await client.query(`INSERT INTO client_companies
      (id,tax_number,normalized_tax_number,name,country,postal_code,city,address,email,phone,created_by,updated_by,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,now(),now())
      ON CONFLICT(normalized_tax_number) DO UPDATE SET updated_by=$11,updated_at=now() RETURNING *`,
    [clientId,input.taxNumber,input.normalizedTaxNumber,input.name,input.country||'HU',input.postalCode||'',input.city||'',
      input.address||'',input.email||'',input.phone||'',actorId]);
    await client.query(`INSERT INTO client_company_tenants(client_company_id,tenant_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,[result.rows[0].id,tenantId]);
    return result.rows[0];
  });
}

async function listUsers(tenantId) {
  const result = await query('SELECT id,first_name,last_name,email FROM users WHERE tenant_id=$1 ORDER BY last_name,first_name,email LIMIT 500',[tenantId]);
  return result.rows.map((r)=>({id:r.id,_id:r.id,firstName:r.first_name,lastName:r.last_name,email:r.email}));
}

async function listDocuments(tenantId, workId) {
  const result = await query('SELECT * FROM work_documents WHERE tenant_id=$1 AND work_item_id=$2 ORDER BY created_at DESC',[tenantId,workId]);
  return result.rows.map(document);
}

async function findDocument(tenantId, documentId) {
  const result=await query('SELECT * FROM work_documents WHERE tenant_id=$1 AND id=$2',[tenantId,documentId]);
  return document(result.rows[0]);
}

async function createDocument(tenantId, workId, actorId, input) {
  const result = await query(`INSERT INTO work_documents
    (id,tenant_id,work_item_id,category,display_name,file_name,storage_key,content_type,size,uploaded_by,uploaded_by_name,created_at,updated_at)
    SELECT $1::varchar(24),$2::varchar(24),$3::varchar(24),$4,$5,$6,$7,$8,$9,$10::varchar(24),$11,now(),now()
    WHERE EXISTS(SELECT 1 FROM work_items WHERE id=$3 AND tenant_id=$2 AND archived_at IS NULL) RETURNING *`,
  [id(),tenantId,workId,input.category,input.displayName,input.fileName,input.storageKey,input.contentType||'application/octet-stream',
    Number(input.size||0),actorId,input.uploadedByName||'']);
  return document(result.rows[0]);
}

async function deleteDocument(tenantId, documentId) {
  const result = await query(`DELETE FROM work_documents d USING work_items w
    WHERE d.id=$1 AND d.tenant_id=$2 AND w.id=d.work_item_id AND w.tenant_id=$2 AND w.archived_at IS NULL
    RETURNING d.*`,[documentId,tenantId]);
  return document(result.rows[0]);
}

module.exports = { list, listBoardOptions, findWork, createWork, updateWork, archiveWork, restoreWork, createSubWork,
  updateSubWork, archiveSubWork, listClients, findClientByTaxNumber, isClientLinked, saveClient, listUsers,
  listDocuments, findDocument, createDocument, deleteDocument, work, subWork, document };
