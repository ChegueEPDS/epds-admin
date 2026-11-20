const { randomUUID } = require('node:crypto');

const BILLABLE = 'completed_billable';
const missingRecipient = 'Set the accounting email for this work’s organizational unit before marking it billable.';
const activeEntities = (config) => (config?.entities || []).filter((entity) => !entity.archived)
  .map(({ id, label }) => ({ id, label }));

function accountingSettings(input, catalog) {
  if (input === undefined) return undefined;
  if (input === null || input.mode === 'off') return null;
  const address = (value) => typeof value === 'string' && value.trim().length <= 254 &&
    /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(value.trim()) ? value.trim() : null;
  if (!['single', 'entity'].includes(input.mode) || !['hu', 'en'].includes(input.language)) {
    throw Object.assign(new Error('Invalid accounting notification settings.'), { statusCode: 400 });
  }
  if (input.mode === 'single') {
    const email = address(input.email);
    if (email) return { mode: input.mode, language: input.language, email };
  } else {
    const entities = activeEntities(catalog);
    const entries = entities.map(({ id }) => [id, address(input.entityEmails?.[id])]);
    if (entries.length && entries.every(([, email]) => email)) {
      return { mode: input.mode, language: input.language, entityEmails: Object.fromEntries(entries) };
    }
  }
  throw Object.assign(new Error('Enter a valid accounting email for each selected recipient.'), { statusCode: 400 });
}

function billableNotification(tenant, work) {
  const settings = tenant?.accountingNotifications;
  if (!settings) return null;
  const entity = (tenant.workFieldSettings?.entities || []).find(({ id }) => id === work.entityId);
  const to = settings.mode === 'single' ? settings.email :
    entity && settings.entityEmails?.[entity.id];
  if (!to) throw Object.assign(new Error(missingRecipient), { statusCode: 400 });
  return {
    id: randomUUID(),
    payload: {
      to, language: settings.language, tenantId: String(work.tenantId),
      tenantName: tenant.displayName || tenant.name, workId: String(work._id),
      workNumber: work.workNumber, name: work.name, customer: work.customer,
      entity: entity?.label, completionDate: work.completionDate, totalAmount: work.totalAmount, currency: work.currency
    }
  };
}

async function enqueuePostgres(client, work) {
  const { rows: [tenant] } = await client.query(`SELECT name, display_name AS "displayName",
    accounting_notifications AS "accountingNotifications", work_field_settings AS "workFieldSettings"
    FROM tenants WHERE id=$1`, [work.tenantId]);
  const event = billableNotification(tenant, work);
  if (event) {
    await client.query('INSERT INTO accounting_notification_outbox(id,payload) VALUES($1,$2)', [event.id, event.payload]);
  }
}

module.exports = { BILLABLE, activeEntities, accountingSettings, billableNotification, enqueuePostgres };
