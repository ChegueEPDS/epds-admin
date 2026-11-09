const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { test } = require('node:test');
const bcrypt = require('bcryptjs');

const databaseUrl = process.env.PROJECT_TRACKER_QA_DATABASE_URL;
const mongoUrl = process.env.PROJECT_TRACKER_QA_MONGO_URL;

test('Project Tracker shares works, isolates tenants, imports idempotently and settles invoices', {
  skip: !databaseUrl && !mongoUrl
}, async (t) => {
  const postgres = Boolean(databaseUrl);
  const qaUrl = new URL(databaseUrl || mongoUrl);
  assert.match(qaUrl.pathname, /^\/epds_project_tracker_qa(?:_[a-z0-9]+)?$/, 'Use an empty isolated QA database');
  assert.ok(['127.0.0.1', 'localhost'].includes(qaUrl.hostname), 'Use an isolated local database');
  process.env.DATABASE_ENGINE = postgres ? 'postgresql' : 'mongodb';
  process.env.DATABASE_URL = databaseUrl || '';
  process.env.MONGODB_URI = mongoUrl || '';
  process.env.JWT_SECRET = 'isolated-project-tracker-test';
  const { query, closePostgres } = require('../src/postgres');
  const { connectDb } = require('../src/db');
  const app = require('../src/app');
  const project = '111111111111111111111111';
  const standalone = '222222222222222222222222';
  const client = '333333333333333333333333';
  const admin = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const finance = 'bbbbbbbbbbbbbbbbbbbbbbbb';
  const outsider = 'cccccccccccccccccccccccc';
  const enabled = { enabled: true, edit: true, delete: true };
  const hash = await bcrypt.hash('qa-only', 4);

  const tenants = [
    [project, 'tracker-qa', 'company', { workBoard: enabled, projectTracker: enabled }],
    [standalone, 'standalone-qa', 'company', { workBoard: enabled }],
    [client, 'client-qa', 'client', { workBoard: enabled, projectTracker: enabled }]
  ];
  const users = [
    [admin, project, 'admin', 'Admin'], [finance, project, 'finance', 'Finance'],
    [outsider, standalone, 'outsider', 'Admin'], ['dddddddddddddddddddddddd', client, 'client', 'Admin']
  ];
  if (postgres) {
    await query(await fs.readFile(path.join(__dirname, '../postgres/001_initial_schema.sql'), 'utf8'));
    await connectDb();
    await connectDb();
    for (const [id, name, type, features] of tenants) {
      await query('INSERT INTO tenants(id,name,type,features,created_at,updated_at) VALUES($1,$2,$3,$4,now(),now())', [id, name, type, JSON.stringify(features)]);
    }
    for (const [id, tenant, name, role] of users) {
      await query(`INSERT INTO users(id,first_name,last_name,email,tenant_id,role,password,created_at,updated_at)
        VALUES($1,$2,'QA',$3,$4,$5,$6,now(),now())`, [id, name, `${name}@example.test`, tenant, role, hash]);
    }
  } else {
    await connectDb();
    const Tenant = require('../src/models/tenant');
    const User = require('../src/models/user');
    await Promise.all([Tenant.init(), User.init(), require('../src/models/workSequence').init()]);
    await Tenant.insertMany(tenants.map(([_id, name, type, features]) => ({ _id, name, type, features })));
    await User.insertMany(users.map(([_id, tenantId, firstName, role]) =>
      ({ _id, tenantId, firstName, lastName: 'QA', role, email: `${firstName}@example.test`, password: hash })));
  }
  const server = app.listen(0, '127.0.0.1');
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    if (postgres) await closePostgres();
    else await require('mongoose').disconnect();
  });
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const root = `http://127.0.0.1:${server.address().port}/api`;
  async function request(method, route, auth, body, expected = 200) {
    const headers = {};
    if (auth) Object.assign(headers, auth);
    if (body && !(body instanceof FormData)) headers['content-type'] = 'application/json';
    const response = await fetch(root + route, { method, headers, body: body && (body instanceof FormData ? body : JSON.stringify(body)) });
    const type = response.headers.get('content-type') || '';
    const data = type.includes('json') ? await response.json() : await response.arrayBuffer();
    assert.equal(response.status, expected, `${method} ${route}: ${JSON.stringify(data)}`);
    return { response, data };
  }
  async function login(name) {
    const { response } = await request('POST', '/login', null, { email: `${name}@example.test`, password: 'qa-only' });
    const cookies = response.headers.getSetCookie().map((cookie) => cookie.split(';')[0]);
    const csrf = cookies.find((cookie) => cookie.startsWith('csrf_token=')).split('=')[1];
    return { cookie: cookies.join('; '), 'x-csrf-token': csrf };
  }

  const [administrator, accountant, other, customer] = await Promise.all(['admin', 'finance', 'outsider', 'client'].map(login));
  await request('GET', '/work-board/works', customer, null, 403);
  await request('GET', '/project-tracker/works', customer, null, 403);
  await request('GET', '/project-tracker/works', other, null, 403);
  await request('GET', '/work-fields/settings', other);
  const { data: setting } = await request('GET', '/work-fields/settings', administrator);
  const { data: saved } = await request('PUT', '/work-fields/settings', administrator, { version: setting.version, data: {
    ...setting.data, units: [{ id: 'eu', name: 'EU' }], fields: [{ id: 'custom1', target: 'work', type: 'number',
      label: 'Number', locations: ['boardEditor', 'trackerList'], options: [] }]
  } });
  assert.equal(saved.version, 1);
  const { data: created } = await request('POST', '/work-board/works', administrator, { name: 'QA work', status: 'in_progress',
    currency: 'EUR', totalAmount: 1000, responsibleUserId: admin }, 201);
  const id = created.work.id;
  await request('GET', `/work-fields/work/${id}`, other, null, 404);
  await request('PATCH', `/work-fields/work/${id}`, administrator, { version: 0, unitId: 'eu', custom: { custom1: 5 } });
  await request('PATCH', `/work-fields/work/${id}`, administrator, { version: 0, unitId: 'eu' }, 409);
  const { data: filtered } = await request('GET', '/work-board/works?unitId=eu', administrator);
  assert.deepEqual(filtered.works.map((work) => work.id), [id]);
  const { data: rows } = await request('GET', '/project-tracker/works', administrator);
  assert.equal(rows.rows[0].custom.custom1, 5);
  await request('PATCH', `/project-tracker/works/${id}/core`, administrator,
    { status: 'completed_billable', deadline: '2026-11-09', expectedUpdatedAt: '2020-01-01T00:00:00.000Z' }, 409);
  await request('PATCH', `/project-tracker/works/${id}/core`, administrator,
    { status: 'completed_billable', deadline: '2026-11-09', expectedUpdatedAt: created.work.updatedAt });
  const { data: work } = await request('GET', `/work-board/works/${id}`, administrator);
  assert.equal(work.work.status, 'completed_billable');
  await request('PATCH', `/project-tracker/works/${id}/core`, administrator, { status: 'cancelled' }, 400);
  const { data: milestone } = await request('POST', `/work-board/works/${id}/sub-works`, administrator,
    { name: 'Milestone', status: 'in_progress', currency: 'EUR', amount: 500 }, 201);
  const invoice = { version: 1, action: 'invoice', value: { number: 'QA-01', issued: '2026-10-01', due: '2026-10-10', amount: 900,
    allocations: [{ subWorkId: milestone.subWork.id, amount: 450 }] } };
  await request('PATCH', `/project-tracker/works/${id}`, administrator, invoice, 403);
  const { data: invoiced } = await request('PATCH', `/project-tracker/works/${id}`, accountant, invoice);
  const invoiceId = invoiced.data.invoices[0].id;
  assert.deepEqual(invoiced.data.invoices[0].allocations, [{ subWorkId: milestone.subWork.id, cents: 45000 }]);
  const { data: paid } = await request('PATCH', `/project-tracker/works/${id}`, accountant, { version: 2, action: 'payment',
    value: { invoiceId, date: '2026-10-02', amount: 400 } });
  assert.equal(paid.work.payment.receivable, 500);
  assert.equal(paid.work.stage, 'Completed');
  assert.equal(paid.work.payment.status, 'Partially paid');
  const { data: reconciled } = await request('PATCH', `/project-tracker/works/${id}`, accountant, { version: 3, action: 'reconcile' });
  assert.match(reconciled.data.reconciledOn, /^\d{4}-\d{2}-\d{2}$/);
  await request('PATCH', `/project-tracker/works/${id}`, administrator, { version: 4, action: 'review' });
  await request('PATCH', `/work-board/works/${id}`, administrator, { currency: 'AED' }, 409);

  if (process.env.PROJECT_TRACKER_QA_WORKBOOK) {
    const workbook = await fs.readFile(process.env.PROJECT_TRACKER_QA_WORKBOOK);
    const payload = (fields = {}) => {
      const form = new FormData();
      form.append('file', new Blob([workbook]), 'source.xlsx');
      form.append('source', 'isolated QA source');
      for (const [key, value] of Object.entries(fields)) form.append(key, value);
      return form;
    };
    const { data: preview } = await request('POST', '/project-tracker/import/preview', administrator, payload());
    assert.equal(preview.rows.length, 34);
    assert.equal(preview.questions, 25);
    const decisions = JSON.stringify(preview.rows.map((row) => ({ no: row.no, create: true })));
    const form = () => payload({ hash: preview.hash, decisions, questions: 'true' });
    const { data: result } = await request('POST', '/project-tracker/import/apply', administrator, form());
    assert.equal(result.questions, 25, JSON.stringify(result.results.filter((row) => row.error)));
    const { data: retry } = await request('POST', '/project-tracker/import/apply', administrator, form());
    assert.deepEqual(retry.results, result.results);
    assert.equal(retry.questions, 0);
    const { data: exported } = await request('GET', '/project-tracker/export', administrator);
    const excel = new (require('exceljs').Workbook)();
    await excel.xlsx.load(exported);
    assert.equal(excel.getWorksheet('Projects').rowCount, 36);
    assert.equal(excel.getWorksheet('Open Questions').rowCount, 26);
  }
});
