const { EJSON } = require('bson');

const id = (value) => value == null ? null : String(value);
const date = (value) => value ? new Date(value) : null;
const json = (value, fallback) => JSON.stringify(value == null ? fallback : value);

function decode(value) {
  return EJSON.deserialize(value, { relaxed: false });
}

async function sourceDocuments(client, collection) {
  const { rows } = await client.query(
    `SELECT document FROM mongo_source_documents
      WHERE collection_name = $1 ORDER BY document_id`,
    [collection]
  );
  return rows.map((row) => decode(row.document));
}

async function firstExistingCollection(client, names) {
  for (const name of names) {
    const result = await client.query(
      'SELECT EXISTS (SELECT 1 FROM mongo_source_documents WHERE collection_name = $1) AS found',
      [name]
    );
    if (result.rows[0].found) return name;
  }
  return names[0];
}

async function upsert(client, table, row) {
  const columns = Object.keys(row);
  const values = Object.values(row);
  const assignments = columns.filter((column) => column !== 'id')
    .map((column) => `${column} = EXCLUDED.${column}`).join(', ');
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
  await client.query(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})
     ON CONFLICT (id) DO UPDATE SET ${assignments}`,
    values
  );
}

function stamps(doc) {
  return {
    created_at: date(doc.createdAt) || new Date(0),
    updated_at: date(doc.updatedAt) || date(doc.createdAt) || new Date(0)
  };
}

async function resolveTenantId(client, doc, references = {}) {
  if (doc.tenantId) return id(doc.tenantId);

  const userIds = [
    references.responsibleUserId,
    references.userId,
    references.createdBy,
    references.updatedBy
  ].filter(Boolean).map(id);
  if (userIds.length) {
    const result = await client.query(
      `SELECT tenant_id FROM users
        WHERE id = ANY($1::text[]) AND tenant_id IS NOT NULL
        ORDER BY CASE id WHEN $2 THEN 0 ELSE 1 END LIMIT 1`,
      [userIds, userIds[0]]
    );
    if (result.rows[0]?.tenant_id) return result.rows[0].tenant_id;
  }

  if (references.clientId) {
    const result = await client.query(
      `SELECT tenant_id FROM client_company_tenants
        WHERE client_company_id = $1 ORDER BY tenant_id LIMIT 1`,
      [id(references.clientId)]
    );
    if (result.rows[0]?.tenant_id) return result.rows[0].tenant_id;
  }

  if (references.workItemId) {
    const result = await client.query('SELECT tenant_id FROM work_items WHERE id = $1', [id(references.workItemId)]);
    if (result.rows[0]?.tenant_id) return result.rows[0].tenant_id;
  }

  if (references.projectId) {
    const result = await client.query('SELECT tenant_id FROM effort_projects WHERE id = $1', [id(references.projectId)]);
    if (result.rows[0]?.tenant_id) return result.rows[0].tenant_id;
  }

  // Very old records predate tenant selection. If every tenant-scoped user in
  // the source belongs to the same tenant, that is the only defensible legacy
  // owner and keeps the record visible without inventing a new tenant.
  const sourceUsers = await sourceDocuments(client, await firstExistingCollection(client, ['users']));
  const sourceUserTenants = [...new Set(sourceUsers.map((user) => id(user.tenantId)).filter(Boolean))];
  if (sourceUserTenants.length === 1) return sourceUserTenants[0];

  const onlyTenant = await client.query('SELECT id FROM tenants ORDER BY id LIMIT 2');
  if (onlyTenant.rows.length === 1) return onlyTenant.rows[0].id;
  throw new Error(`Cannot infer tenant for legacy document ${id(doc._id) || '<unknown>'}`);
}

async function projectTenants(client) {
  const collection = await firstExistingCollection(client, ['tenants']);
  const docs = await sourceDocuments(client, collection);
  for (const doc of docs) await upsert(client, 'tenants', {
    id: id(doc._id), name: doc.name, display_name: doc.displayName || null,
    type: doc.type || 'company', owner_user_id: null,
    seats_max: Number(doc.seats?.max || 0), seats_used: Number(doc.seats?.used || 0),
    seats_managed: doc.seatsManaged || 'stripe', features: json(doc.features, {}),
    profession_rbac_enabled: Boolean(doc.professionRbacEnabled), ...stamps(doc)
  });
  return docs;
}

async function projectUsers(client) {
  const docs = await sourceDocuments(client, await firstExistingCollection(client, ['users']));
  for (const doc of docs) await upsert(client, 'users', {
    id: id(doc._id), azure_id: doc.azureId || null, first_name: doc.firstName,
    last_name: doc.lastName, email: String(doc.email || '').toLowerCase(),
    nickname: doc.nickname || null, tenant_id: id(doc.tenantId), role: doc.role || 'User',
    professions: json(doc.professions, []), password: doc.password || null,
    email_verified: doc.emailVerified !== false, last_login_at: date(doc.lastLoginAt), ...stamps(doc)
  });
  return docs;
}

async function projectTenantOwners(client, tenantDocs) {
  for (const doc of tenantDocs) {
    if (!doc.ownerUserId) continue;
    await client.query('UPDATE tenants SET owner_user_id = $2 WHERE id = $1', [id(doc._id), id(doc.ownerUserId)]);
  }
}

async function projectSessions(client) {
  const docs = await sourceDocuments(client, await firstExistingCollection(client, ['sessions']));
  for (const doc of docs) await upsert(client, 'sessions', {
    id: id(doc._id), user_id: id(doc.userId), tenant_id: id(doc.tenantId),
    client_type: doc.clientType || 'web', refresh_token_hash: doc.refreshTokenHash,
    previous_refresh_token_hash: doc.previousRefreshTokenHash || null,
    previous_refresh_token_grace_until: date(doc.previousRefreshTokenGraceUntil),
    revoked_at: date(doc.revokedAt), expires_at: date(doc.expiresAt),
    absolute_expires_at: date(doc.absoluteExpiresAt), last_seen_at: date(doc.lastSeenAt) || new Date(0),
    user_agent: doc.userAgent || '', ip: doc.ip || '', ...stamps(doc)
  });
  return docs;
}

async function projectClients(client) {
  const docs = await sourceDocuments(client, await firstExistingCollection(client, ['clientcompanies', 'client_companies']));
  for (const doc of docs) {
    await upsert(client, 'client_companies', {
      id: id(doc._id), tax_number: doc.taxNumber, normalized_tax_number: doc.normalizedTaxNumber,
      name: doc.name, country: doc.country || 'HU', postal_code: doc.postalCode || '',
      city: doc.city || '', address: doc.address || '', email: doc.email || '', phone: doc.phone || '',
      created_by: id(doc.createdBy), updated_by: id(doc.updatedBy), ...stamps(doc)
    });
    await client.query('DELETE FROM client_company_tenants WHERE client_company_id = $1', [id(doc._id)]);
    for (const tenantId of doc.tenantIds || []) await client.query(
      `INSERT INTO client_company_tenants (client_company_id, tenant_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`, [id(doc._id), id(tenantId)]
    );
  }
  return docs;
}

async function projectWorks(client) {
  const docs = await sourceDocuments(client, await firstExistingCollection(client, ['workitems', 'work_items']));
  for (const doc of docs) await upsert(client, 'work_items', {
    id: id(doc._id), tenant_id: await resolveTenantId(client, doc, doc), year: Number(doc.year),
    sequence_number: Number(doc.sequenceNumber), work_number: doc.workNumber, name: doc.name,
    client_id: id(doc.clientId), customer: doc.customer || '', responsible_user_id: id(doc.responsibleUserId),
    responsible: doc.responsible || '', contributors: json(doc.contributors, []), status: doc.status || 'inquiry',
    deadline: date(doc.deadline), description: doc.description || '', currency: doc.currency || 'HUF',
    total_amount: Number(doc.totalAmount || 0), cost_amount: Number(doc.costAmount || 0),
    subcontractor: doc.subcontractor || '', payment_deadline_days: Number(doc.paymentDeadlineDays ?? 30),
    offer_date: date(doc.offerDate), completion_date: date(doc.completionDate), invoice_date: date(doc.invoiceDate),
    invoice_payment_deadline: date(doc.invoicePaymentDeadline), invoice_number: doc.invoiceNumber || '',
    contract_signed: Boolean(doc.contractSigned), performance_certificate: Boolean(doc.performanceCertificate),
    archived_at: date(doc.archivedAt), created_by: id(doc.createdBy), updated_by: id(doc.updatedBy), ...stamps(doc)
  });
  return docs;
}

async function projectSubWorks(client) {
  const docs = await sourceDocuments(client, await firstExistingCollection(client, ['subworkitems', 'sub_work_items']));
  for (const doc of docs) await upsert(client, 'sub_work_items', {
    id: id(doc._id), tenant_id: await resolveTenantId(client, doc, doc), work_item_id: id(doc.workItemId),
    sequence_number: Number(doc.sequenceNumber), name: doc.name, description: doc.description || '',
    responsible_user_id: id(doc.responsibleUserId), responsible: doc.responsible || '',
    contributors: json(doc.contributors, []), status: doc.status || 'inquiry', deadline: date(doc.deadline),
    completed_at: date(doc.completedAt), planned_hours: Number(doc.plannedHours || 0), amount: Number(doc.amount || 0),
    currency: doc.currency || 'HUF', performance_certificate_required: Boolean(doc.performanceCertificateRequired),
    performance_certificate_signed: Boolean(doc.performanceCertificateSigned), invoice_number: doc.invoiceNumber || '',
    invoice_date: date(doc.invoiceDate), invoice_payment_deadline: date(doc.invoicePaymentDeadline),
    paid_amount: Number(doc.paidAmount || 0), paid_at: date(doc.paidAt), archived_at: date(doc.archivedAt),
    archived_by_work_at: date(doc.archivedByWorkAt), created_by: id(doc.createdBy), updated_by: id(doc.updatedBy), ...stamps(doc)
  });
  return docs;
}

async function projectDocuments(client) {
  const docs = await sourceDocuments(client, await firstExistingCollection(client, ['workdocuments', 'work_documents']));
  for (const doc of docs) await upsert(client, 'work_documents', {
    id: id(doc._id), tenant_id: await resolveTenantId(client, doc, doc), work_item_id: id(doc.workItemId), category: doc.category,
    display_name: doc.displayName, file_name: doc.fileName, storage_key: doc.storageKey,
    content_type: doc.contentType || 'application/octet-stream', size: Number(doc.size || 0),
    uploaded_by: id(doc.uploadedBy), uploaded_by_name: doc.uploadedByName || '', ...stamps(doc)
  });
  return docs;
}

async function projectSequences(client) {
  const docs = await sourceDocuments(client, await firstExistingCollection(client, ['worksequences', 'work_sequences']));
  for (const doc of docs) await upsert(client, 'work_sequences', {
    id: id(doc._id), tenant_id: await resolveTenantId(client, doc, doc), key: doc.key, value: Number(doc.value || 0), ...stamps(doc)
  });
  return docs;
}

async function projectEffort(client) {
  const projects = await sourceDocuments(client, await firstExistingCollection(client, ['effortprojects', 'effort_projects']));
  for (const doc of projects) await upsert(client, 'effort_projects', {
    id: id(doc._id), tenant_id: await resolveTenantId(client, doc, doc), name: doc.name, normalized_name: doc.normalizedName,
    customer: doc.customer || '', comment: doc.comment || '', work_item_id: id(doc.workItemId),
    work_item_snapshot: json(doc.workItemSnapshot, {}), status: doc.status || 'open', closed_at: date(doc.closedAt),
    closed_net_ms: Number(doc.closedNetMs || 0), closed_gross_ms: Number(doc.closedGrossMs || 0),
    created_by: id(doc.createdBy), updated_by: id(doc.updatedBy), closed_by: id(doc.closedBy), ...stamps(doc)
  });
  const tasks = await sourceDocuments(client, await firstExistingCollection(client, ['efforttasks', 'effort_tasks']));
  for (const doc of tasks) {
    await upsert(client, 'effort_tasks', {
      id: id(doc._id), project_id: id(doc.projectId), tenant_id: await resolveTenantId(client, doc, doc), name: doc.name,
      note: doc.note || '', sub_work_item_id: id(doc.subWorkItemId), sub_work_item_snapshot: json(doc.subWorkItemSnapshot, {}),
      status: doc.status || 'open', archived_net_ms: Number(doc.archivedNetMs || 0),
      archived_session_count: Number(doc.archivedSessionCount || 0), first_started_at: date(doc.firstStartedAt),
      active_timer_user_id: id(doc.activeTimer?.userId), active_timer_started_at: date(doc.activeTimer?.startedAt),
      closed_at: date(doc.closedAt), closed_net_ms: Number(doc.closedNetMs || 0), closed_gross_ms: Number(doc.closedGrossMs || 0),
      created_by: id(doc.createdBy), updated_by: id(doc.updatedBy), closed_by: id(doc.closedBy), ...stamps(doc)
    });
    await client.query('DELETE FROM effort_sessions WHERE task_id = $1', [id(doc._id)]);
    for (const [position, session] of (doc.sessions || []).entries()) await client.query(
      `INSERT INTO effort_sessions (task_id, user_id, position, started_at, stopped_at, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id(doc._id), id(session.userId), position, date(session.startedAt), date(session.stoppedAt), Number(session.durationMs || 0)]
    );
  }
  return [...projects, ...tasks];
}

async function projectCore(pool) {
  const client = await pool.connect();
  const counts = {};
  try {
    await client.query('BEGIN');
    await client.query(`TRUNCATE TABLE
      webhook_test_receipts, integration_requests, webhook_deliveries, license_events, integration_clients,
      license_customers, domain_status_report_snapshots, domain_status_pdfs, domain_page_speed_scans,
      domain_health_daily_rollups, domain_health_checks, domain_monitors, effort_sessions, effort_tasks,
      effort_projects, work_documents, sub_work_items, work_items, work_sequences, client_company_tenants,
      client_companies, sessions, scheduled_job_leases, users, tenants CASCADE`);
    const tenants = await projectTenants(client); counts.tenants = tenants.length;
    counts.users = (await projectUsers(client)).length;
    await projectTenantOwners(client, tenants);
    counts.sessions = (await projectSessions(client)).length;
    counts.clientCompanies = (await projectClients(client)).length;
    counts.workItems = (await projectWorks(client)).length;
    counts.subWorkItems = (await projectSubWorks(client)).length;
    counts.workDocuments = (await projectDocuments(client)).length;
    counts.workSequences = (await projectSequences(client)).length;
    counts.effortRecords = (await projectEffort(client)).length;
    await client.query('COMMIT');
    return counts;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function verifyCore(pool) {
  const client = await pool.connect();
  const checks = [
    ['tenants', ['tenants']], ['users', ['users']], ['sessions', ['sessions']],
    ['client_companies', ['clientcompanies', 'client_companies']],
    ['work_items', ['workitems', 'work_items']], ['sub_work_items', ['subworkitems', 'sub_work_items']],
    ['work_documents', ['workdocuments', 'work_documents']], ['work_sequences', ['worksequences', 'work_sequences']],
    ['effort_projects', ['effortprojects', 'effort_projects']], ['effort_tasks', ['efforttasks', 'effort_tasks']]
  ];
  try {
    const results = [];
    for (const [table, aliases] of checks) {
      const collection = await firstExistingCollection(client, aliases);
      const source = await client.query(
        'SELECT count(*)::bigint AS count FROM mongo_source_documents WHERE collection_name = $1', [collection]
      );
      const target = await client.query(`SELECT count(*)::bigint AS count FROM ${table}`);
      const row = { table, source: Number(source.rows[0].count), target: Number(target.rows[0].count) };
      row.ok = row.source === row.target;
      results.push(row);
    }
    const orphans = await client.query(`
      SELECT
        (SELECT count(*) FROM work_items w LEFT JOIN tenants t ON t.id=w.tenant_id WHERE t.id IS NULL) AS work_tenant,
        (SELECT count(*) FROM sub_work_items s LEFT JOIN work_items w ON w.id=s.work_item_id WHERE w.id IS NULL) AS sub_work,
        (SELECT count(*) FROM effort_tasks e LEFT JOIN effort_projects p ON p.id=e.project_id WHERE p.id IS NULL) AS effort_project
    `);
    console.table(results);
    const orphanCount = Object.values(orphans.rows[0]).reduce((sum, value) => sum + Number(value), 0);
    if (results.some((row) => !row.ok) || orphanCount) {
      throw new Error(`Core projection verification failed; orphan references: ${orphanCount}`);
    }
    return results;
  } finally {
    client.release();
  }
}

module.exports = {
  projectCore, verifyCore, sourceDocuments, firstExistingCollection,
  upsert, id, date, json, stamps
};
