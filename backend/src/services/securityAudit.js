const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const { databaseEngine, query } = require('../postgres');

const financialFields = ['status', 'completionDate', 'invoiceDate', 'invoicePaymentDeadline', 'paidAt'];
const entityParams = ['id', 'taskId', 'subWorkId', 'documentId', 'fieldId', 'month'];
const downloads = /(?:\/export|\/pdf|\/license-file|\/mobile-app-file|\/documents\/:documentId\/file|\/custom-fields\/:fieldId\/file|\/import\/:id\/errors)$/;

function safeId(value) {
  return typeof value === 'string' && /^(?:[a-f0-9]{24}|\d{4}-\d{2})$/i.test(value) ? value : null;
}

function tagChange(req, action, before, after, fields, tenantId) {
  const changes = {};
  for (const field of fields) {
    const previous = before?.[field] == null ? null : String(before[field]);
    const current = after?.[field] == null ? null : String(after[field]);
    if (previous !== current) changes[field] = { before: previous, after: current };
  }
  if (Object.keys(changes).length) req.securityAudit = { action, changes, tenantId };
}

function financialChange(req, before, after, tenantId) {
  tagChange(req, 'finance.work_changed', before, after, financialFields, tenantId);
}

function eventFor(req, status) {
  if (!req.userId || !req.route?.path || typeof req.route.path !== 'string') return null;
  const route = req.route.path;
  const method = req.method;
  const detail = req.securityAudit;
  const completed = status >= 200 && status < 300;
  let action = detail?.action;
  if (!action && method === 'DELETE') action = 'record.deleted';
  if (!action && method === 'GET' && downloads.test(route)) action = 'data.exported';
  if (!action && method === 'POST' && route === '/admin/users/:id/recovery') action = 'account.recovery_sent';
  if (!action && method === 'POST' && route.endsWith('/revoke') && route.startsWith('/admin/')) action = 'admin.access_revoked';
  if (!action && method === 'PATCH' && route === '/admin/users/:id/role' && !completed) action = 'account.role_change';
  if (!action) return null;

  const targets = {};
  if (safeId(detail?.targetId)) targets.id = detail.targetId;
  for (const key of entityParams) {
    const value = safeId(req.params?.[key]);
    if (value) targets[key] = value;
  }
  return {
    id: randomUUID(), at: new Date().toISOString(), action,
    actorId: String(req.userId), actorRole: req.role || null,
    actorTenantId: safeId(req.scope?.actorTenantId),
    tenantId: safeId(detail?.tenantId || req.params?.tenantId || req.scope?.tenantId),
    route, targets, outcome: completed ? 'succeeded' : 'failed', status,
    changes: completed ? detail?.changes || {} : {}
  };
}

async function append(event) {
  // Ship this stream off the host with an append-only collector identity.
  process.stdout.write(JSON.stringify({ stream: 'security-audit', ...event }) + '\n');
  if (databaseEngine() === 'postgresql') {
    await query('INSERT INTO security_audit_events (id, occurred_at, event) VALUES ($1,$2,$3)',
      [event.id, event.at, JSON.stringify(event)]);
  } else {
    await mongoose.connection.collection('security_audit_events').insertOne({ _id: event.id, ...event });
  }
}

function persist(event) {
  return append(event).catch(() => {
    process.stderr.write(JSON.stringify({ stream: 'security-audit-error', eventId: event.id, reason: 'persist_failed' }) + '\n');
  });
}

async function recordImportedFinancialChanges(scope, actorId, rows) {
  for (const row of rows) {
    if (!row.id || !row.modified) continue;
    const req = {
      userId: actorId, role: scope.role, scope, params: { id: row.id },
      method: 'POST', route: { path: '/work-board/transfer/import' }
    };
    tagChange(req, 'finance.work_changed_by_import', row.previous, { ...row.previous, ...row.changes },
      financialFields, scope.tenantId);
    const event = eventFor(req, 200);
    if (event) await persist(event);
  }
}

function record(req, res, next) {
  res.on('finish', () => {
    const event = eventFor(req, res.statusCode);
    if (event) void persist(event);
  });
  next();
}

module.exports = { record, eventFor, tagChange, financialChange, recordImportedFinancialChanges };
