const {
  sourceDocuments, firstExistingCollection, upsert, id, date, json, stamps
} = require('./postgres-core-projector');

async function docs(client, aliases) {
  return sourceDocuments(client, await firstExistingCollection(client, aliases));
}

async function projectDomains(client) {
  const monitors = await docs(client, ['domainmonitors', 'domain_monitors']);
  for (const d of monitors) await upsert(client, 'domain_monitors', {
    id: id(d._id), name: d.name, base_url: d.baseUrl, normalized_url: d.normalizedUrl,
    owner: d.owner || 'EPDS', tenant_id: id(d.tenantId), enabled: d.enabled !== false,
    created_by: id(d.createdBy), updated_by: id(d.updatedBy), last_checked_at: date(d.lastCheckedAt),
    last_status: d.lastStatus || 'unknown', last_response_ms: d.lastResponseMs ?? null,
    last_status_code: d.lastStatusCode ?? null, last_error: d.lastError || null,
    last_error_type: d.lastErrorType || null, last_warning: d.lastWarning || null,
    last_warning_type: d.lastWarningType || null, last_final_url: d.lastFinalUrl || null,
    last_redirect_count: d.lastRedirectCount ?? null, last_content_type: d.lastContentType || null,
    last_content_length: d.lastContentLength ?? null, last_tls_valid_to: date(d.lastTlsValidTo),
    last_tls_days_remaining: d.lastTlsDaysRemaining ?? null, current_issue_since: date(d.currentIssueSince),
    last_failure_at: date(d.lastFailureAt), last_recovery_at: date(d.lastRecoveryAt),
    health_config: json(d.healthConfig, {}), ...stamps(d)
  });

  const checks = await docs(client, ['domainhealthchecks', 'domain_health_checks']);
  for (const d of checks) await upsert(client, 'domain_health_checks', {
    id: id(d._id), domain_id: id(d.domainId), checked_at: date(d.checkedAt), ok: Boolean(d.ok),
    status: d.status || (d.ok ? 'ok' : 'error'), status_code: d.statusCode ?? null,
    response_ms: d.responseMs ?? null, final_url: d.finalUrl || null, redirect_count: d.redirectCount ?? null,
    content_type: d.contentType || null, content_length: d.contentLength ?? null,
    tls_valid_to: date(d.tlsValidTo), tls_days_remaining: d.tlsDaysRemaining ?? null,
    error_type: d.errorType || null, error_message: d.errorMessage || null,
    warning_type: d.warningType || null, warning_message: d.warningMessage || null, ...stamps(d)
  });

  const rollups = await docs(client, ['domainhealthdailyrollups', 'domain_health_daily_rollups']);
  for (const d of rollups) await upsert(client, 'domain_health_daily_rollups', {
    id: id(d._id), domain_id: id(d.domainId), day: date(d.day), total_checks: Number(d.totalChecks),
    ok_count: Number(d.okCount), warning_count: Number(d.warningCount), error_count: Number(d.errorCount),
    response_ms_sum: Number(d.responseMsSum), response_ms_count: Number(d.responseMsCount),
    response_ms_samples: json(d.responseMsSamples, []), first_checked_at: date(d.firstCheckedAt),
    last_checked_at: date(d.lastCheckedAt), ...stamps(d)
  });

  const scans = await docs(client, ['domainpagespeedscans', 'domain_page_speed_scans']);
  for (const d of scans) await upsert(client, 'domain_page_speed_scans', {
    id: id(d._id), domain_id: id(d.domainId), checked_at: date(d.checkedAt),
    source: d.source || 'manual', scans: json(d.scans, []), ...stamps(d)
  });

  const pdfs = await docs(client, ['domainstatuspdfs', 'domain_status_pdfs']);
  for (const d of pdfs) await upsert(client, 'domain_status_pdfs', {
    id: id(d._id), owner_slug: d.ownerSlug, report_date: d.reportDate,
    report_generated_at: date(d.reportGeneratedAt), content: d.content?.buffer || d.content,
    size: Number(d.size), etag: d.etag, expires_at: date(d.expiresAt), ...stamps(d)
  });

  const snapshots = await docs(client, ['domainstatusreportsnapshots', 'domain_status_report_snapshots']);
  for (const d of snapshots) await upsert(client, 'domain_status_report_snapshots', {
    id: id(d._id), owner_slug: d.ownerSlug, generated_at: date(d.generatedAt), report: json(d.report, {}),
    build_duration_ms: Number(d.buildDurationMs), ready: Boolean(d.ready), lease_until: date(d.leaseUntil), ...stamps(d)
  });
  return { monitors: monitors.length, checks: checks.length, rollups: rollups.length, scans: scans.length, pdfs: pdfs.length, snapshots: snapshots.length };
}

function licenseDetails(d) {
  const excluded = new Set(['_id', 'tenantId', 'customerName', 'normalizedCustomerName', 'description', 'status',
    'statusVersion', 'integrationEventVersion', 'orderedFromStatus', 'objectLimitOption', 'customObjectLimit',
    'expiresAt', 'createdBy', 'updatedBy', 'createdAt', 'updatedAt', '__v']);
  return Object.fromEntries(Object.entries(d).filter(([key]) => !excluded.has(key)));
}

async function projectLicenses(client) {
  const licenses = await docs(client, ['licensecustomers', 'license_customers']);
  for (const d of licenses) await upsert(client, 'license_customers', {
    id: id(d._id), tenant_id: id(d.tenantId), customer_name: d.customerName,
    normalized_customer_name: d.normalizedCustomerName, description: d.description || '', status: d.status,
    status_version: Number(d.statusVersion || 0), integration_event_version: Number(d.integrationEventVersion || 0),
    ordered_from_status: d.orderedFromStatus || '', object_limit_option: d.objectLimitOption || '1000',
    custom_object_limit: d.customObjectLimit ?? null, expires_at: date(d.expiresAt),
    details: json(licenseDetails(d), {}), created_by: id(d.createdBy), updated_by: id(d.updatedBy), ...stamps(d)
  });

  const clients = await docs(client, ['integrationclients', 'integration_clients']);
  for (const d of clients) await upsert(client, 'integration_clients', {
    id: id(d._id), name: d.name, key_prefix: d.keyPrefix, key_hash: d.keyHash, status: d.status || 'active',
    scopes: json(d.scopes, []), webhook_url: d.webhookUrl || '',
    webhook_secret_encrypted: d.webhookSecretEncrypted || '', webhook_enabled: Boolean(d.webhookEnabled),
    last_used_at: date(d.lastUsedAt), last_webhook_success_at: date(d.lastWebhookSuccessAt),
    revoked_at: date(d.revokedAt), created_by: id(d.createdBy), updated_by: id(d.updatedBy), ...stamps(d)
  });

  const events = await docs(client, ['licenseevents', 'license_events']);
  for (const d of events) await upsert(client, 'license_events', {
    id: id(d._id), event_id: d.eventId, event_type: d.eventType, license_id: id(d.licenseId),
    status_version: Number(d.statusVersion), previous_status: d.previousStatus, status: d.status,
    payload: json(d.payload, {}), actor: json(d.actor, {}), occurred_at: date(d.occurredAt),
    deliveries_ensured_at: date(d.deliveriesEnsuredAt), ...stamps(d)
  });

  const deliveries = await docs(client, ['webhookdeliveries', 'webhook_deliveries']);
  for (const d of deliveries) await upsert(client, 'webhook_deliveries', {
    id: id(d._id), event_id: id(d.eventId), client_id: id(d.clientId), status: d.status || 'pending',
    attempt_count: Number(d.attemptCount || 0), next_attempt_at: date(d.nextAttemptAt) || new Date(),
    locked_until: date(d.lockedUntil), delivered_at: date(d.deliveredAt), last_attempt_at: date(d.lastAttemptAt),
    last_status_code: d.lastStatusCode ?? null, last_error: d.lastError || '', ...stamps(d)
  });

  const requests = await docs(client, ['integrationrequests', 'integration_requests']);
  for (const d of requests) await upsert(client, 'integration_requests', {
    id: id(d._id), client_id: id(d.clientId), idempotency_key: d.idempotencyKey,
    request_fingerprint: d.requestFingerprint, status: d.status || 'processing',
    response_status: d.responseStatus ?? null, response_body: d.responseBody == null ? null : json(d.responseBody, null),
    expires_at: date(d.expiresAt), ...stamps(d)
  });
  return { licenses: licenses.length, clients: clients.length, events: events.length, deliveries: deliveries.length, requests: requests.length };
}

async function projectOperational(client) {
  const receipts = await docs(client, ['webhooktestreceipts', 'webhook_test_receipts']);
  for (const d of receipts) await upsert(client, 'webhook_test_receipts', {
    id: id(d._id), inbox_token_hash: d.inboxTokenHash, method: d.method || 'POST', path: d.path,
    headers: json(d.headers, {}), raw_body: d.rawBody || '',
    parsed_body: d.parsedBody == null ? null : json(d.parsedBody, null), byte_length: Number(d.byteLength || 0),
    received_at: date(d.receivedAt) || new Date(), expires_at: date(d.expiresAt), ...stamps(d)
  });
  const leases = await docs(client, ['scheduledjobleases', 'scheduled_job_leases']);
  for (const d of leases) await upsert(client, 'scheduled_job_leases', {
    id: id(d._id), name: d.name, holder: d.holder, locked_until: date(d.lockedUntil), ...stamps(d)
  });
  return { receipts: receipts.length, leases: leases.length };
}

async function projectAux(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const counts = {
      domains: await projectDomains(client),
      licenses: await projectLicenses(client),
      operational: await projectOperational(client)
    };
    await client.query('COMMIT');
    return counts;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function verifyAux(pool) {
  const client = await pool.connect();
  const checks = [
    ['domain_monitors', ['domainmonitors', 'domain_monitors']],
    ['domain_health_checks', ['domainhealthchecks', 'domain_health_checks']],
    ['domain_health_daily_rollups', ['domainhealthdailyrollups', 'domain_health_daily_rollups']],
    ['domain_page_speed_scans', ['domainpagespeedscans', 'domain_page_speed_scans']],
    ['domain_status_pdfs', ['domainstatuspdfs', 'domain_status_pdfs']],
    ['domain_status_report_snapshots', ['domainstatusreportsnapshots', 'domain_status_report_snapshots']],
    ['license_customers', ['licensecustomers', 'license_customers']],
    ['integration_clients', ['integrationclients', 'integration_clients']],
    ['license_events', ['licenseevents', 'license_events']],
    ['webhook_deliveries', ['webhookdeliveries', 'webhook_deliveries']],
    ['integration_requests', ['integrationrequests', 'integration_requests']],
    ['webhook_test_receipts', ['webhooktestreceipts', 'webhook_test_receipts']],
    ['scheduled_job_leases', ['scheduledjobleases', 'scheduled_job_leases']]
  ];
  try {
    const results = [];
    for (const [table, aliases] of checks) {
      const collection = await firstExistingCollection(client, aliases);
      const source = await client.query('SELECT count(*)::bigint AS count FROM mongo_source_documents WHERE collection_name=$1', [collection]);
      const target = await client.query(`SELECT count(*)::bigint AS count FROM ${table}`);
      results.push({ table, source: Number(source.rows[0].count), target: Number(target.rows[0].count) });
    }
    results.forEach((row) => { row.ok = row.source === row.target; });
    console.table(results);
    if (results.some((row) => !row.ok)) throw new Error('Auxiliary projection count verification failed');
    return results;
  } finally {
    client.release();
  }
}

module.exports = { projectAux, verifyAux };
