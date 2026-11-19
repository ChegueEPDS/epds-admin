const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const accounts = require('../src/services/accountStore');
const sessions = require('../src/services/authSessionService');
const store = require('../src/services/mfaStore');
const policy = require('../src/services/mfaPolicy');
const totp = require('../src/services/mfaTotp');
const passkeys = require('../src/services/mfaPasskeys');

const userId = '000000000000000000000003';
const tenantId = '000000000000000000000001';

function response() {
  return {
    statusCode: 200, cookies: 0,
    status(code) { this.statusCode = code; return this; },
    set() { return this; },
    json(body) { this.body = body; return this; },
    cookie() { this.cookies++; return this; }
  };
}

test('local privileged accounts require MFA and reject pre-MFA sessions', async (t) => {
  let state = {};
  t.mock.method(store, 'read', async () => ({ state }));
  for (const role of ['SuperAdmin', 'Admin', 'Finance']) {
    const user = { _id: userId, role, loginMethod: 'password' };
    assert.equal(policy.required(user), true);
    await assert.rejects(policy.checkSession(user, {}), /two-step verification/);
    await policy.checkSession({ ...user, loginMethod: 'microsoft' }, {});
  }
  const user = { _id: userId, role: 'User', loginMethod: 'password' };
  assert.equal(policy.required(user), false);
  await policy.checkSession(user, {});
  state = { secret: 'encrypted', version: 'current' };
  await assert.rejects(policy.checkSession(user, { mfaVersion: 'old' }), /two-step verification/);
  await policy.checkSession(user, { mfaVersion: 'current' });
});

test('Finance enrollment issues no session until TOTP succeeds, then consumes codes once', async (t) => {
  const oldKey = process.env.MFA_ENCRYPTION_KEY;
  process.env.MFA_ENCRYPTION_KEY = 'test-only-encryption-key-0123456789abcdef';
  t.after(() => {
    if (oldKey === undefined) delete process.env.MFA_ENCRYPTION_KEY;
    else process.env.MFA_ENCRYPTION_KEY = oldKey;
  });
  const user = {
    _id: userId, tenantId, role: 'Finance', loginMethod: 'password', emailVerified: true,
    email: 'finance@example.test', password: await bcrypt.hash('fixture password', 4)
  };

  let record = { revision: null, state: {} };
  let revision = 0;
  t.mock.method(store, 'read', async () => structuredClone(record));
  t.mock.method(store, 'replace', async (_id, previous, state) => {
    if (previous !== record.revision) return null;
    record = { revision: String(++revision), state: structuredClone(state) };
    return record.revision;
  });
  t.mock.method(accounts, 'findEmail', async () => user);
  t.mock.method(accounts, 'findById', async () => user);
  t.mock.method(accounts, 'findTenant', async () => ({ _id: tenantId }));
  t.mock.method(accounts, 'updateAccount', async () => user);
  const create = t.mock.method(sessions, 'createSession', async ({ mfaVersion }) => {
    assert.equal(mfaVersion, record.state.version);
    return { user };
  });
  t.mock.method(sessions, 'setAuthCookies', (res) => res.cookie());

  // RFC 6238's SHA-1 example at t=59, reduced to six digits.
  t.mock.method(totp, 'generateSecret', () => 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  t.mock.method(Date, 'now', () => 59000);
  const mfa = require('../src/controllers/mfaController');
  const auth = require('../src/controllers/authController');
  const invoke = async (handler, body) => {
    const res = response();
    await handler({ body, get: () => undefined }, res, (error) => { throw error; });
    return res;
  };
  const signIn = async () => {
    const res = await invoke(auth.login, { email: user.email, password: 'fixture password' });
    assert.equal(res.cookies, 0);
    assert.equal(res.body.user, undefined);
    return res.body.verification;
  };

  const enrollment = await signIn();
  assert.equal(enrollment.setup, true);
  assert.match((await invoke(mfa.loginSetup, enrollment)).body.qr, /^data:image\/png;base64,/);
  assert.equal(create.mock.callCount(), 0);
  assert.equal((await invoke(mfa.loginConfirm, { ...enrollment, code: '123456' })).statusCode, 400);
  const confirmed = await invoke(mfa.loginConfirm, { ...enrollment, code: '287082' });
  assert.equal(confirmed.cookies, 1);
  assert.equal(confirmed.body.recoveryCodes.length, 10);
  assert.ok(!JSON.stringify(record).includes(confirmed.body.recoveryCodes[0]));
  assert.equal(create.mock.callCount(), 1);
  assert.equal((await invoke(mfa.loginConfirm, { ...enrollment, code: '287082' })).statusCode, 410);

  const verification = await signIn();
  assert.equal(verification.setup, false);
  assert.equal((await invoke(mfa.loginVerify, { ...verification, method: 'totp', code: '287082' })).statusCode, 400);
  const code = confirmed.body.recoveryCodes[0];
  const checks = await Promise.all([1, 2].map(() =>
    invoke(mfa.loginVerify, { ...verification, method: 'recovery', code })));
  assert.equal(checks.filter((result) => result.cookies === 1).length, 1);
  assert.equal(record.state.recovery.length, 9);
  assert.equal((await invoke(mfa.loginVerify, { ...await signIn(), method: 'recovery', code })).statusCode, 400);

  const updated = await signIn();
  user.password = await bcrypt.hash('replacement fixture password', 4);
  assert.equal((await invoke(mfa.loginVerify, { ...updated, method: 'recovery', code: confirmed.body.recoveryCodes[1] })).statusCode, 410);
});

test('passkey options bind to the configured exact HTTPS origin and request device verification', async (t) => {
  const oldOrigin = process.env.MFA_WEBAUTHN_ORIGIN;
  process.env.MFA_WEBAUTHN_ORIGIN = 'https://admin.example.test';
  t.after(() => {
    if (oldOrigin === undefined) delete process.env.MFA_WEBAUTHN_ORIGIN;
    else process.env.MFA_WEBAUTHN_ORIGIN = oldOrigin;
  });
  assert.equal(passkeys.context({ get: () => 'https://other.example.test' }), null);
  assert.equal(passkeys.context({ get: () => 'http://admin.example.test' }), null);
  const context = passkeys.context({ get: () => 'https://admin.example.test' });
  const options = await passkeys.options({ _id: userId, email: 'finance@example.test' }, [], context, true);
  assert.equal(options.rp.id, 'admin.example.test');
  assert.equal(options.authenticatorSelection.userVerification, 'required');
  assert.ok(options.challenge);
});

test('the recommendation preference is saved for an optional local User only', async (t) => {
  const mfa = require('../src/controllers/mfaController');
  let record = { revision: null, state: {} };
  const user = { _id: userId, role: 'User', loginMethod: 'password', password: 'fixture hash' };
  t.mock.method(accounts, 'findById', async () => user);
  t.mock.method(store, 'read', async () => record);
  t.mock.method(store, 'replace', async (_id, previous, state) => {
    assert.equal(previous, record.revision);
    record = { revision: 'saved', state };
    return record.revision;
  });
  const req = { userId, get: () => undefined };
  const next = (error) => { throw error; };
  const dismissed = response();
  await mfa.dismiss(req, dismissed, next);
  assert.deepEqual(dismissed.body, { ok: true });
  const status = response();
  await mfa.status(req, status, next);
  assert.equal(status.body.recommendationDismissed, true);
  assert.equal(status.body.enabled, false);
  user.role = 'Finance';
  const denied = response();
  await mfa.dismiss(req, denied, next);
  assert.equal(denied.statusCode, 403);
  user.loginMethod = 'microsoft';
  const microsoft = response();
  await mfa.status(req, microsoft, next);
  assert.deepEqual(microsoft.body, { available: false });
});
