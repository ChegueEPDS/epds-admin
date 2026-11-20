const { createHash, randomUUID } = require('node:crypto');
const hasRecipientEmail = ({ email }) => typeof email === 'string' && email.length <= 254 &&
  /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(email);

function statusChange(work, previousStatus) {
  return {
    tenantId: String(work.tenantId), workId: String(work._id), workNumber: work.workNumber,
    name: work.name, previousStatus, status: work.status, changedAt: new Date()
  };
}

function statusRecipients(users, work) {
  const recipients = new Set();
  const keys = new Map();
  for (const user of users) {
    if (!hasRecipientEmail(user)) continue;
    const email = user.email.toLowerCase();
    if (String(user._id ?? user.id) === String(work.responsibleUserId)) recipients.add(email);
    const name = [user.firstName ?? user.first_name, user.lastName ?? user.last_name].join(' ').trim();
    for (const id of new Set([String(user._id ?? user.id), email, name.toLowerCase()].filter(Boolean))) {
      keys.set(id, keys.has(id) ? null : email);
    }
  }
  for (const contributor of work.contributors || []) {
    const email = keys.get(contributor.trim().toLowerCase());
    if (email) recipients.add(email);
  }
  return [...recipients];
}

function statusJobs(change, work, tenant, users) {
  const tenantName = tenant.displayName || tenant.name;
  const entity = tenant.workFieldSettings?.entities?.find(({ id }) => id === work.entityId)?.label;
  return statusRecipients(users, work).map((to) => ({
    id: randomUUID(), payload: { ...change, type: 'work-status', tenantName, customer: work.customer, entity, to }
  }));
}

async function recordPostgresStatus(client, work, previousStatus) {
  const change = statusChange(work, previousStatus);
  await client.query('INSERT INTO work_status_changes(tenant_id,work_id,changed_at,payload) VALUES($1,$2,$3,$4)',
    [change.tenantId, change.workId, change.changedAt, change]);
  if (!work.responsibleUserId && !work.contributors?.length) return;
  const { rows: [tenant] } = await client.query('SELECT name,display_name AS "displayName",work_field_settings AS "workFieldSettings" FROM tenants WHERE id=$1', [work.tenantId]);
  const { rows: users } = await client.query(`SELECT id,email,first_name,last_name FROM users
    WHERE tenant_id=$1 OR $1=ANY(additional_tenant_ids)`, [work.tenantId]);
  for (const { id, payload } of statusJobs(change, work, tenant, users)) {
    await client.query('INSERT INTO accounting_notification_outbox(id,payload) VALUES($1,$2)', [id, payload]);
  }
}

const calendar = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Budapest', year: 'numeric', month: 'numeric', day: 'numeric',
  hour: 'numeric', minute: 'numeric', hourCycle: 'h23'
});

function localClock(date) {
  const parts = Object.fromEntries(calendar.formatToParts(date).map(({ type, value }) => [type, Number(value)]));
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
}

function budapestInstant(clock) {
  const guess = new Date(clock);
  return new Date(clock - (localClock(guess) - clock));
}

function weeklyPeriod(now = new Date()) {
  const dayMs = 86_400_000;
  const local = new Date(localClock(now));
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  let cutoff = midnight - local.getUTCDay() * dayMs + dayMs - 60_000;
  if (+local < cutoff) cutoff -= 7 * dayMs;
  return { from: budapestInstant(cutoff - 7 * dayMs), to: budapestInstant(cutoff) };
}

function weeklyJob(tenant, admin, period, changes) {
  const tenantId = String(tenant._id ?? tenant.id);
  const key = createHash('sha256').update(JSON.stringify([tenantId, admin.email.toLowerCase(), period.to.toISOString()])).digest('hex');
  const id = [key.slice(0, 8), key.slice(8, 12), key.slice(12, 16), key.slice(16, 20), key.slice(20, 32)].join('-');
  return { id, payload: { type: 'work-weekly', tenantId, tenantName: tenant.displayName || tenant.display_name || tenant.name,
    to: admin.email, ...period, changes } };
}

module.exports = { hasRecipientEmail, statusChange, statusRecipients, statusJobs, recordPostgresStatus, weeklyPeriod, weeklyJob };
