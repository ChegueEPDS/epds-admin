const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const accountStore = require('../src/services/accountStore');
const mail = require('../src/services/mailService');
const { brandMail } = require('../src/services/mailTemplates');
const invitations = require('../src/services/accountInvitations');
const verifier = require('../src/services/microsoftTokenVerifier');
const sessions = require('../src/services/authSessionService');

const tenantId = '000000000000000000000001';
const otherTenantId = '000000000000000000000002';
const accountId = '000000000000000000000003';
const email = 'finance@example.test';

function response() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    set() { return this; },
    json(body) { this.body = body; return this; }
  };
}

function next(error) { throw error; }

test('invitation reissue replaces the old token and a failed delivery leaves the account available to retry', async (t) => {
  const previousUrl = process.env.EPDS_ADMIN_PUBLIC_URL;
  process.env.EPDS_ADMIN_PUBLIC_URL = 'https://admin.example.test';
  t.after(() => {
    if (previousUrl === undefined) delete process.env.EPDS_ADMIN_PUBLIC_URL;
    else process.env.EPDS_ADMIN_PUBLIC_URL = previousUrl;
  });
  let account = { _id: accountId, email, tenantId, role: 'Finance', loginMethod: 'microsoft', emailVerified: false };
  const links = [];
  const accountModel = require('../src/models/user');
  t.mock.method(accountModel, 'findById', async () => account);
  t.mock.method(accountModel, 'findOneAndUpdate', async (where, { $set }) => {
    for (const [key, value] of Object.entries(where)) assert.equal(account[key] ?? null, value ?? null);
    account = { ...account, ...$set };
    return account;
  });
  const delivery = t.mock.method(mail, 'sendMail', async (message) => {
    const { html } = brandMail(message, 'test-logo');
    const link = html.match(/href="([^"]+)"/)[1].replaceAll('&amp;', '&');
    links.push(new URLSearchParams(new URL(link).hash.slice(1)).get('invite'));
  });

  assert.equal(await invitations.sendAccountLink(account, 'invite'), true);
  assert.ok(await invitations.tokenAccount(accountId, links[0], 'invite'));
  assert.equal(await invitations.sendAccountLink(account, 'invite'), true);
  assert.equal(await invitations.tokenAccount(accountId, links[0], 'invite'), null);
  assert.ok(await invitations.tokenAccount(accountId, links[1], 'invite'));
  assert.notEqual(account.accountTokenHash, links[1]);
  delivery.mock.mockImplementation(async () => { throw Error('mail unavailable'); });
  assert.equal(await invitations.sendAccountLink(account, 'invite'), false);
  assert.equal(account.accountTokenHash, null);
  assert.equal(account.emailVerified, false);
});

test('Microsoft requires the matching invited identity, consumes the link, and honors the saved tenant', async (t) => {
  const token = 'a'.repeat(64);
  let account = {
    _id: accountId, email, tenantId, role: 'Finance', loginMethod: 'microsoft', emailVerified: false,
    accountTokenHash: createHash('sha256').update(token).digest('hex'),
    accountTokenPurpose: 'invite', accountTokenExpiresAt: new Date(Date.now() + 60000)
  };
  let claims = { tid: 'issuer', oid: 'identity', email: 'wrong@example.test' };
  t.mock.method(verifier, 'verifyMicrosoftAccessToken', async () => claims);
  t.mock.method(sessions, 'createSession', async ({ user }) => ({ user }));
  t.mock.method(sessions, 'setAuthCookies', () => {});
  const accountModel = require('../src/models/user');
  t.mock.method(accountModel, 'findById', async () => account);
  t.mock.method(accountStore, 'findTenant', async (id) => ({ _id: id }));
  t.mock.method(accountStore, 'findMicrosoft', async (id) => account.azureId === id ? account : null);
  t.mock.method(accountStore, 'updateAccount', async (where, changes) => {
    assert.equal(where.tenantId, account.tenantId);
    account = { ...account, ...changes };
    return account;
  });
  const auth = require('../src/controllers/authController');
  const signIn = async (payload) => {
    const res = response();
    await auth.microsoftLogin({ body: { accessToken: 'mock-verified-token', ...payload } }, res, next);
    return res;
  };
  assert.equal((await signIn({})).statusCode, 403);
  assert.equal((await signIn({ account: accountId, invite: token })).statusCode, 403);
  claims = { ...claims, email };
  assert.equal((await signIn({ account: accountId, invite: token })).body.user.tenantId, tenantId);
  assert.equal((await signIn({ account: accountId, invite: token })).statusCode, 403);
  claims = { ...claims, email: 'renamed@another.example' };
  assert.equal((await signIn({})).body.user.tenantId, tenantId);
  claims = { ...claims, tid: 'other-issuer' };
  assert.equal((await signIn({})).statusCode, 403);
});

test('tenant admins cannot create users in another tenant or assign privileged roles', async () => {
  const admin = require('../src/controllers/accountAdminController');
  const payload = { email, firstName: 'First', lastName: 'Last', loginMethod: 'microsoft' };
  for (const selection of [{ tenantId: otherTenantId, role: 'User' }, { tenantId, role: 'Admin' }, { tenantId, role: 'Finance' }, { tenantId, role: 'User', tenantIds: [otherTenantId] }]) {
    const res = response();
    await admin.createUser({ role: 'Admin', scope: { tenantId }, body: { ...payload, ...selection } }, res, next);
    assert.equal(res.statusCode, 403);
  }
});

test('password activation accepts one valid invitation and expires stale invitations', async (t) => {
  const bcrypt = require('bcryptjs');
  const token = 'b'.repeat(64);
  let account = {
    _id: accountId, email, tenantId, loginMethod: 'password', emailVerified: false,
    accountTokenHash: createHash('sha256').update(token).digest('hex'),
    accountTokenPurpose: 'invite', accountTokenExpiresAt: new Date(0)
  };
  t.mock.method(require('../src/models/user'), 'findById', async () => account);
  t.mock.method(accountStore, 'findTenant', async () => ({ _id: tenantId }));
  t.mock.method(accountStore, 'updateAccount', async (where, changes, options) => {
    assert.equal(where.accountTokenHash, account.accountTokenHash);
    assert.equal(options.liveToken, true);
    account = { ...account, ...changes };
    return account;
  });
  const auth = require('../src/controllers/authController');
  const password = 'fixture passphrase';
  const activate = async () => {
    const res = response();
    await auth.setPassword({ body: { account: accountId, token, purpose: 'invite', password } }, res, next);
    return res;
  };

  assert.equal((await activate()).statusCode, 403);
  account.accountTokenExpiresAt = new Date(Date.now() + 60000);
  assert.equal((await activate()).statusCode, 200);
  assert.equal(account.emailVerified, true);
  assert.equal(await bcrypt.compare(password, account.password), true);
  assert.equal((await activate()).statusCode, 403);
});
