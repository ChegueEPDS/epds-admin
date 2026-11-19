const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { once } = require('node:events');

test('Finance access scopes tenants, records and writes to the billing workflow', {
  skip: !process.env.FINANCE_TEST_DATABASE_URL
}, async (t) => {
  process.env.DATABASE_ENGINE = 'postgresql';
  process.env.DATABASE_URL = process.env.FINANCE_TEST_DATABASE_URL;
  process.env.JWT_SECRET = 'finance-test-session-secret';
  const { query, closePostgres } = require('../src/postgres');
  const { connectDb } = require('../src/db');
  const { createSession } = require('../src/services/authSessionService');
  const mfaStore = require('../src/services/mfaStore');
  const tenants = require('../src/repositories/postgres/tenantRepository');
  const users = require('../src/repositories/postgres/userRepository');
  const works = require('../src/repositories/postgres/workBoardRepository');
  const app = require('../src/app');

  const tenantIds = [];
  const userIds = [];
  const quoteFixtures = new Map();
  let server;
  t.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await query('DELETE FROM sessions WHERE user_id=ANY($1::text[])', [userIds]);
    await query('DELETE FROM work_items WHERE tenant_id=ANY($1::text[])', [tenantIds]);
    await query('DELETE FROM users WHERE id=ANY($1::text[])', [userIds]);
    await query('DELETE FROM tenants WHERE id=ANY($1::text[])', [tenantIds]);
    for (const [id, original] of quoteFixtures) {
      if (original) await query('UPDATE mnb_exchange_rate_snapshots SET data=$2 WHERE id=$1', [id, original]);
      else await query('DELETE FROM mnb_exchange_rate_snapshots WHERE id=$1', [id]);
    }
    await closePostgres();
  });

  await query(await readFile(path.join(__dirname, '../postgres/001_initial_schema.sql'), 'utf8'));
  await connectDb();
  const rateToday = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Budapest' }).format(new Date());
  for (const date of new Set(['2026-11-10', rateToday])) {
    const id = 'history:' + date;
    quoteFixtures.set(id, (await query('SELECT data FROM mnb_exchange_rate_snapshots WHERE id=$1', [id])).rows[0]?.data);
    await query('INSERT INTO mnb_exchange_rate_snapshots(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data',
      [id, { date, rates: { EUR: { quote: '400', unit: 1 }, USD: { quote: '360', unit: 1 } } }]);
  }
  const suffix = randomBytes(6).toString('hex');
  async function tenant(label, type, enabled = false, grant = false) {
    const saved = await tenants.save({ name: label + '-' + suffix, displayName: label, type, features: {
      workBoard: { enabled, edit: true }, financeAccess: { enabled: grant }
    } });
    tenantIds.push(saved.id);
    return saved;
  }
  async function session(tenant, role, label) {
    const local = label === 'member';
    const user = await users.save({ tenantId: tenant.id, role, email: label + '-' + suffix + '@example.test',
      firstName: 'QA', lastName: 'User', loginMethod: local ? 'password' : 'microsoft' });
    userIds.push(user.id);
    const mfaVersion = local ? randomBytes(16).toString('hex') : null;
    if (local) {
      await assert.rejects(createSession({ user, req: {} }), /two-step verification/);
      await mfaStore.replace(user.id, null, { secret: 'fixture only', version: mfaVersion });
    }
    return createSession({ user, req: {}, mfaVersion });
  }

  const finance = await tenant('Pénzügy', 'finance', true, true);
  const allowed = await tenant('Engedélyezett', 'company', true, true);
  const denied = await tenant('Tiltott', 'company', true, false);
  const disabled = await tenant('Kikapcsolt', 'company', false, true);
  const member = await session(finance, 'Finance', 'member');
  const ordinaryFinance = await session(allowed, 'Finance', 'ordinary');
  const otherMember = await session(finance, 'User', 'non-finance');
  const billing = await works.createWork(allowed.id, null, { name: 'Billable', status: 'completed_billable',
    costAmount: 5, reporting: { nextAction: 'Internal' } });
  const ongoing = await works.createWork(allowed.id, null, { name: 'Ongoing', status: 'in_progress' });
  const archived = await works.createWork(allowed.id, null, { name: 'Archived', status: 'paid' });
  await works.archiveWork(allowed.id, archived.id, null);
  const other = await works.createWork(denied.id, null, { name: 'Other tenant', status: 'paid' });
  const existingInvoice = await works.createWork(allowed.id, null, { name: 'Existing invoice', status: 'invoiced' });
  const existingPayment = await works.createWork(allowed.id, null, { name: 'Existing payment', status: 'paid' });

  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port + '/api';
  function request(route, options = {}) {
    return fetch(base + route, {
      method: options.body === undefined ? 'GET' : 'PATCH',
      headers: { Authorization: 'Bearer ' + (options.session || member).accessToken,
        'Content-Type': 'application/json', ...options.headers },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
  }
  const list = '/finance/tenants/' + allowed.id + '/works';
  const item = list + '/' + billing.id;

  assert.equal((await (await request('/auth/me')).json()).user.tenantType, 'finance');
  const directory = await (await request('/finance/tenants')).json();
  assert.deepEqual(directory.tenants.filter(({ id }) => tenantIds.includes(id)), [{ id: allowed.id, name: allowed.displayName }]);
  assert.equal((await request('/finance/tenants', { session: ordinaryFinance })).status, 403);
  assert.equal((await request('/finance/tenants', { session: otherMember })).status, 403);
  assert.equal((await request('/work-board/options')).status, 403);
  assert.equal((await request('/work-board/dashboard', { headers: { 'X-Tenant-Context': allowed.id } })).status, 403);
  assert.equal((await request('/finance/tenants/' + denied.id + '/works/' + other.id)).status, 404);
  assert.equal((await request('/finance/tenants/' + disabled.id + '/works')).status, 404);

  const response = await (await request(list)).json();
  assert.deepEqual(new Set(response.works.map(({ id }) => id)), new Set([billing.id, existingInvoice.id, existingPayment.id]));
  assert.equal(response.pagination.total, 3);
  assert.equal(response.summary, undefined);
  assert.equal(response.works.find(({ id }) => id === billing.id).costAmount, undefined);
  assert.equal((await (await request(list + '?status=paid')).json()).works[0].id, existingPayment.id);
  assert.equal((await request(list + '?status=active')).status, 400);
  assert.equal((await request(list + '?status=deleted')).status, 400);
  for (const hidden of [ongoing, archived, other]) {
    assert.equal((await request(list + '/' + hidden.id + '?includeDeleted=true')).status, 404);
    assert.equal((await request(list + '/' + hidden.id, { body: { fieldRevision: 0, invoiceNumber: 'DENIED' } })).status, 404);
  }
  for (const changes of [{ totalAmount: 42 }, { reporting: { nextAction: 'DENIED' } }, { status: 'paid' }, { status: 'closed' }]) {
    assert.equal((await request(item, { body: { fieldRevision: 0, ...changes } })).status, 400);
  }
  const invoice = await request(item, { body: { fieldRevision: 0, status: 'invoiced', invoiceNumber: 'QA-1',
    invoiceDate: '2026-11-10' } });
  assert.equal(invoice.status, 200);
  assert.equal((await invoice.json()).work.fieldRevision, 1);
  assert.equal((await request(item, { body: { fieldRevision: 0, invoiceNumber: 'STALE' } })).status, 409);

  const concurrent = await Promise.all([
    request(item, { body: { fieldRevision: 1, status: 'paid' } }),
    request(item, { body: { fieldRevision: 1, status: 'paid' } })
  ]);
  assert.deepEqual(concurrent.map(({ status }) => status).sort(), [200, 409]);
  const persisted = await works.findWork(allowed.id, billing.id);
  assert.equal(persisted.status, 'paid');
  assert.equal(persisted.costAmount, 5);
  assert.equal(persisted.reporting.nextAction, 'Internal');

  const itemized = await works.createWork(allowed.id, null, { name: 'Dated entries', status: 'completed_billable', currency: 'USD', totalAmount: 100 });
  const itemizedRoute = list + '/' + itemized.id;
  await works.createSubWork(allowed.id, itemized.id, null, { name: 'Invoiced installment', status: 'invoiced',
    currency: 'USD', amount: 50, invoiceDate: '2026-11-10', paidAmount: 20, paidAt: '2026-11-10' });
  const withEntry = (await (await request(itemizedRoute)).json()).work;
  assert.deepEqual(withEntry.reporting, { invoicedAmount: 50, paidAmount: 20, paymentStatus: 'partially_paid' });
  for (const reporting of [{ invoicedAmount: 75 }, { paymentStatus: 'paid' }, { invoices: [] }]) {
    assert.equal((await request(itemizedRoute, { body: { fieldRevision: withEntry.fieldRevision, reporting } })).status, 400);
  }

  const lifecycle = await works.createWork(allowed.id, null, { name: 'Date defaults', status: 'in_progress', paymentDeadlineDays: 12 });
  const workflowItem = list + '/' + lifecycle.id;
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Budapest' }).format(new Date());
  const due = new Date(today);
  due.setUTCDate(due.getUTCDate() + 12);
  const complete = await request('/work-board/works/' + lifecycle.id, {
    session: ordinaryFinance, body: { status: 'completed_billable', fieldRevision: lifecycle.fieldRevision }
  });
  assert.equal(complete.status, 200);
  const completed = (await complete.json()).work;
  assert.equal(completed.completionDate.slice(0, 10), today);
  assert.equal(completed.invoicePaymentDeadline, due.toISOString());

  const issue = await request(workflowItem, { body: { status: 'invoiced', fieldRevision: completed.fieldRevision } });
  assert.equal(issue.status, 200);
  const issued = (await issue.json()).work;
  assert.equal(issued.invoiceDate.slice(0, 10), today);
  const pay = await request(workflowItem, { body: { status: 'paid', fieldRevision: issued.fieldRevision } });
  assert.equal(pay.status, 200);
  const paid = (await pay.json()).work;
  assert.equal(paid.paidAt.slice(0, 10), today);
  const correct = await request(workflowItem, { body: { fieldRevision: paid.fieldRevision,
    completionDate: '2026-10-24', paidAt: '2026-10-30' } });
  assert.equal(correct.status, 200);
  const corrected = (await correct.json()).work;
  assert.equal(corrected.paidAt.slice(0, 10), '2026-10-30');
  assert.equal(corrected.invoicePaymentDeadline.slice(0, 10), '2026-11-05');

  await tenants.save({ ...allowed, features: { ...allowed.features, financeAccess: { enabled: false } } });
  assert.equal((await request(item)).status, 404);
});
