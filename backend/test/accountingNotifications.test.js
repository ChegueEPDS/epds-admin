const assert = require('node:assert/strict');
const { test } = require('node:test');
const { accountingSettings, billableNotification, enqueuePostgres } = require('../src/services/accountingNotifications');
const { accountingMail } = require('../src/services/mailTemplates');

const workFieldSettings = {
  entities: [{ id: 'engineering', label: 'Engineering' }, { id: 'legacy', label: 'Legacy', archived: true }]
};
const work = {
  _id: 'work-1', tenantId: 'tenant-1', entityId: 'engineering', workNumber: '2026-0042',
  name: 'Inspection <A>', totalAmount: 125000, currency: 'HUF', completionDate: '2026-11-20'
};

test('accounting routes require valid addresses for active units and reject an unmapped work', () => {
  const input = { mode: 'entity', language: 'hu', entityEmails: { engineering: ' invoices@example.com ' } };
  const settings = accountingSettings(input, workFieldSettings);
  const tenant = { name: 'epds', displayName: 'EPDS', workFieldSettings, accountingNotifications: settings };
  assert.equal(billableNotification(tenant, work).payload.to, 'invoices@example.com');
  assert.throws(() => billableNotification(tenant, { ...work, entityId: null }), { statusCode: 400 });
  assert.throws(() => accountingSettings({ ...input, entityEmails: {} }, workFieldSettings), { statusCode: 400 });
  assert.equal(billableNotification({ ...tenant, accountingNotifications: accountingSettings({ mode: 'off' }) }, work), null);
});

test('billable mail uses the queued tenant, recipient, and language', async () => {
  const statements = [];
  const client = {
    async query(sql, params) {
      statements.push({ sql, params });
      return { rows: [{ name: 'epds', displayName: 'EPDS', workFieldSettings,
        accountingNotifications: { mode: 'single', language: 'en', email: 'billing@example.com' } }] };
    }
  };
  await enqueuePostgres(client, work);
  assert.deepEqual(statements[0].params, [work.tenantId]);
  assert.match(statements[1].sql, /INSERT INTO accounting_notification_outbox/);
  const payload = statements[1].params[1];
  assert.equal(payload.to, 'billing@example.com');
  assert.equal(payload.workId, work._id);
  const url = 'https://panda.example.com/project-tracker/open/tenant-1?work=work-1';
  const message = accountingMail(payload, url);
  assert.match(message.subject, /Work ready for invoicing.*EPDS.*2026-0042/);
  assert.match(message.html, /Inspection &lt;A&gt;/);
  assert.equal(message.branding.action.url, url);
  assert.match(accountingMail({ ...payload, language: 'hu' }, url).subject, /Számlázható munka/);
});

test('PostgreSQL enqueues only when a successful update enters the billable status', async (t) => {
  const db = require('../src/postgres');
  let status = 'in_progress';
  let queued = 0;
  const transitions = [];
  let revisionMatches = true;
  const client = {
    async query(sql, params) {
      if (sql.startsWith('SELECT status')) {
        assert.match(sql, /FOR UPDATE/);
        return { rows: [{ status }] };
      }
      if (sql.startsWith('UPDATE work_items')) {
        if (!revisionMatches) return { rows: [] };
        status = params[2];
        return { rows: [{ id: work._id, tenant_id: work.tenantId, status }] };
      }
      if (sql.startsWith('SELECT name')) {
        return { rows: [{ name: 'EPDS', accountingNotifications: { mode: 'single', language: 'en', email: 'billing@example.com' } }] };
      }
      if (sql.startsWith('INSERT INTO work_status_changes')) {
        transitions.push(params[3]);
        return { rows: [] };
      }
      assert.match(sql, /INSERT INTO accounting_notification_outbox/);
      queued++;
      return { rows: [] };
    }
  };
  t.mock.method(db, 'withTransaction', (callback) => callback(client));
  const { updateWork } = require('../src/repositories/postgres/workBoardRepository');
  const update = () => updateWork(work.tenantId, work._id, null, { status: 'completed_billable' }, 1);

  revisionMatches = false;
  assert.equal(await update(), null);
  assert.equal(queued, 0);
  revisionMatches = true;
  await update();
  await update();
  assert.equal(queued, 1);
  assert.deepEqual(transitions.map(({ previousStatus, status }) => [previousStatus, status]), [
    ['in_progress', 'completed_billable']
  ]);
  await updateWork(work.tenantId, work._id, null, { status: 'invoiced' }, 2);
  assert.equal(queued, 1);
  assert.equal(transitions.at(-1).status, 'invoiced');
});
