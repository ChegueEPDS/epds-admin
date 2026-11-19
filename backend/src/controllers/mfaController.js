const { randomBytes, createHash } = require('node:crypto');
const bcrypt = require('bcryptjs');
const QRCode = require('qrcode');
const accounts = require('../services/accountStore');
const store = require('../services/mfaStore');
const policy = require('../services/mfaPolicy');
const totp = require('../services/mfaTotp');
const passkeys = require('../services/mfaPasskeys');
const { createSession, setAuthCookies, revokeUserSessions } = require('../services/authSessionService');

const flowTtl = 5 * 60 * 1000;
const recentSessionMs = 10 * 60 * 1000;
const attemptLimit = 8;
const attemptWindow = 15 * 60 * 1000;
const token = (bytes = 32) => randomBytes(bytes).toString('base64url');
const digest = (value) => createHash('sha256').update(value).digest('hex');
const expired = (item) => !item || item.expiresAt <= Date.now();

class MfaError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => { throw new MfaError(status, message); };
const invalidFlow = () => fail(410, 'This verification step expired. Start again.');
const invalidCode = () => fail(400, 'That code did not work. Check the code and try again.');
const changed = () => fail(409, 'This step has changed in another window. Please try again.');
const handler = (fn) => async (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  try {
    await fn(req, res);
  } catch (error) {
    if (error instanceof MfaError) return res.status(error.status).json({ error: error.message });
    return next(error);
  }
};

async function save(ctx, state) {
  const revision = await store.replace(ctx.user._id, ctx.revision, state);
  if (!revision) changed();
  return revision;
}

function audit(user, event, method) {
  console.info('[account-security]', JSON.stringify({ at: new Date().toISOString(), userId: String(user._id), event, method }));
}

async function beginLogin(user, req) {
  if (!policy.isLocal(user)) return null;
  const { revision, state } = await store.read(user._id);
  if (!state.secret && !policy.required(user)) return null;
  const challenge = token();
  const login = { hash: digest(challenge), password: digest(user.password), expiresAt: Date.now() + flowTtl };
  if (!await store.replace(user._id, revision, { ...state, login })) return { retry: true };
  return {
    account: String(user._id), challenge,
    setup: !state.secret,
    passkey: passkeys.credentials(state, passkeys.context(req)).length > 0
  };
}

async function loginContext(req) {
  const { account, challenge } = req.body || {};
  if (typeof account !== 'string' || !/^[a-f0-9]{24}$/i.test(account) ||
      typeof challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) invalidFlow();
  const user = await accounts.findById(account);
  if (!user?.password || !policy.isLocal(user) || (user.loginMethod && !user.emailVerified) ||
      (user.role !== 'SuperAdmin' && !await accounts.findTenant(user.tenantId))) invalidFlow();
  const record = await store.read(user._id);
  const login = record.state.login;
  if (expired(login) || login.hash !== digest(challenge) || login.password !== digest(user.password)) invalidFlow();
  return { ...record, user };
}

async function profileContext(req) {
  const user = await accounts.findById(req.userId);
  if (!user || !user.password || !policy.isLocal(user)) fail(403, 'This account uses Microsoft sign-in.');
  return { ...await store.read(user._id), user };
}

async function checkPassword(ctx, req) {
  const password = req.body?.password;
  if (typeof password !== 'string' || Buffer.byteLength(password) > 72 ||
      !await bcrypt.compare(password, ctx.user.password)) fail(400, 'Enter your current password.');
}

function requireRecentSession(ctx, req) {
  if (ctx.state.secret && (req.session.mfaVersion !== ctx.state.version ||
      Date.now() - new Date(req.session.createdAt).getTime() > recentSessionMs || !req.session.createdAt)) {
    fail(403, 'Sign out and sign in again before changing your security settings.');
  }
}

function status(ctx, req) {
  return {
    available: true, enabled: Boolean(ctx.state.secret), required: policy.required(ctx.user),
    recommendationDismissed: Boolean(ctx.state.dismissed),
    recoveryRemaining: ctx.state.recovery?.length || 0,
    passkeyAvailable: Boolean(passkeys.context(req)),
    passkeys: (ctx.state.passkeys || []).map(({ id, name, createdAt }) => ({ id, name, createdAt }))
  };
}

async function attempt(ctx) {
  const now = Date.now();
  const previous = ctx.state.attempts;
  const attempts = expired(previous) ? { count: 1, expiresAt: now + attemptWindow }
    : { ...previous, count: previous.count + 1 };
  if (attempts.count > attemptLimit) fail(429, 'Too many verification attempts. Try again in 15 minutes.');
  const state = { ...ctx.state, attempts };
  return { ...ctx, state, revision: await save(ctx, state) };
}

async function startSetup(ctx, binding) {
  const plain = totp.generateSecret();
  const setup = { secret: totp.encryptSecret(plain), binding, expiresAt: Date.now() + flowTtl };
  const issuer = 'EPDS Admin';
  const params = new URLSearchParams({ secret: plain, issuer });
  const uri = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(ctx.user.email)}?${params}`;
  const qr = await QRCode.toDataURL(uri, { width: 220, margin: 2 });
  await save(ctx, { ...ctx.state, setup });
  return { qr, key: plain };
}

function recoveryCodes() {
  const codes = Array.from({ length: 10 }, () => randomBytes(12).toString('hex').toUpperCase().match(/.{4}/g).join('-'));
  return { codes, recovery: codes.map((code) => digest(code.replaceAll('-', ''))) };
}

async function confirmSetup(ctx, binding, code, { login = false } = {}) {
  const setup = ctx.state.setup;
  if (expired(setup) || setup.binding !== binding) invalidFlow();
  const result = totp.verifyTotp(totp.decryptSecret(setup.secret), code);
  if (!result.ok) invalidCode();
  const { codes, recovery } = recoveryCodes();
  const version = token(16);
  const state = {
    ...ctx.state, secret: setup.secret, counter: result.counter, recovery, version,
    setup: null, login: null, attempts: null, registration: null
  };
  await save(ctx, state);
  audit(ctx.user, ctx.state.secret ? 'authenticator_replaced' : 'mfa_enabled', 'totp');
  if (!login) await revokeUserSessions(ctx.user._id);
  return { codes, version };
}

async function completeLogin(ctx, req, res, version, extra = {}) {
  const user = await accounts.updateAccount({
    _id: String(ctx.user._id), password: ctx.user.password, role: ctx.user.role,
    loginMethod: ctx.user.loginMethod, tenantId: ctx.user.tenantId, email: ctx.user.email
  }, { lastLoginAt: new Date() });
  if (!user) invalidFlow();
  const result = await createSession({ user, req, mfaVersion: version });
  setAuthCookies(res, req, result);
  res.json({ user: result.user, session: result.sessionMeta, ...extra });
}

exports.beginLogin = beginLogin;
exports.loginSetup = handler(async (req, res) => {
  const ctx = await loginContext(req);
  if (ctx.state.secret || !policy.required(ctx.user)) invalidFlow();
  res.json(await startSetup(ctx, ctx.state.login.hash));
});
exports.loginConfirm = handler(async (req, res) => {
  const ctx = await attempt(await loginContext(req));
  if (ctx.state.secret || !policy.required(ctx.user)) invalidFlow();
  const { codes, version } = await confirmSetup(ctx, ctx.state.login.hash, req.body?.code, { login: true });
  await completeLogin(ctx, req, res, version, { recoveryCodes: codes });
});

exports.loginVerify = handler(async (req, res) => {
  let ctx = await attempt(await loginContext(req));
  if (!ctx.state.secret) invalidFlow();
  const { method, code, response } = req.body;
  const state = { ...ctx.state, login: null, attempts: null };
  if (method === 'totp') {
    const result = totp.verifyTotp(totp.decryptSecret(state.secret), code, { lastUsedCounter: state.counter });
    if (!result.ok) invalidCode();
    state.counter = result.counter;
  } else if (method === 'recovery') {
    const normalized = typeof code === 'string' ? code.trim().toUpperCase().replace(/[\s-]/g, '') : '';
    const hash = /^[A-F0-9]{24}$/.test(normalized) ? digest(normalized) : null;
    if (!state.recovery.includes(hash)) invalidCode();
    state.recovery = state.recovery.filter((value) => value !== hash);
  } else if (method === 'passkey') {
    const relyingParty = passkeys.context(req);
    const pending = ctx.state.login.passkey;
    const key = passkeys.credentials(state, relyingParty).find((item) => item.id === response?.id);
    if (!key || expired(pending) || pending.origin !== relyingParty.origin) invalidFlow();
    const consumed = { ...ctx.state, login: { ...ctx.state.login, passkey: null } };
    ctx = { ...ctx, state: consumed, revision: await save(ctx, consumed) };
    const verified = await passkeys.verify(response, pending, key).catch(() => null);
    if (!verified?.verified || !verified.authenticationInfo.userVerified) {
      fail(400, 'That passkey could not be verified. Try again or choose another method.');
    }
    state.passkeys = state.passkeys.map((item) => item.id === key.id
      ? { ...item, counter: verified.authenticationInfo.newCounter } : item);
  } else {
    fail(400, 'Choose a verification method.');
  }
  await save(ctx, state);
  audit(ctx.user, 'mfa_sign_in', method);
  await completeLogin(ctx, req, res, state.version);
});

exports.loginPasskey = handler(async (req, res) => {
  const ctx = await loginContext(req);
  const relyingParty = passkeys.context(req);
  const keys = passkeys.credentials(ctx.state, relyingParty);
  if (!ctx.state.secret || !keys.length) fail(400, 'A passkey is unavailable. Choose another method.');
  const options = await passkeys.options(ctx.user, keys, relyingParty, false);
  const pending = { ...relyingParty, challenge: options.challenge, expiresAt: Date.now() + 120000 };
  await save(ctx, { ...ctx.state, login: { ...ctx.state.login, passkey: pending } });
  res.json(options);
});

exports.status = handler(async (req, res) => {
  const user = await accounts.findById(req.userId);
  if (!user?.password || !policy.isLocal(user)) return res.json({ available: false });
  res.json(status({ user, ...await store.read(user._id) }, req));
});

exports.dismiss = handler(async (req, res) => {
  const ctx = await profileContext(req);
  if (ctx.user.role !== 'User') fail(403, 'Two-step verification is required for this role.');
  await save(ctx, { ...ctx.state, dismissed: true });
  res.json({ ok: true });
});

exports.profileSetup = handler(async (req, res) => {
  const ctx = await profileContext(req);
  await checkPassword(ctx, req);
  requireRecentSession(ctx, req);
  res.json(await startSetup(ctx, String(req.session._id)));
});
exports.profileConfirm = handler(async (req, res) => {
  const ctx = await attempt(await profileContext(req));
  requireRecentSession(ctx, req);
  const { codes } = await confirmSetup(ctx, String(req.session._id), req.body?.code);
  res.json({ recoveryCodes: codes });
});

exports.profileRecovery = handler(async (req, res) => {
  const ctx = await profileContext(req);
  await checkPassword(ctx, req);
  requireRecentSession(ctx, req);
  if (!ctx.state.secret) fail(400, 'Set up your authenticator app first.');
  const { codes, recovery } = recoveryCodes();
  await save(ctx, { ...ctx.state, recovery });
  audit(ctx.user, 'recovery_codes_replaced');
  res.json({ recoveryCodes: codes });
});

exports.profileDisable = handler(async (req, res) => {
  const ctx = await profileContext(req);
  if (policy.required(ctx.user)) fail(403, 'Two-step verification is required for this role.');
  await checkPassword(ctx, req);
  requireRecentSession(ctx, req);
  if (!ctx.state.secret) fail(400, 'Two-step verification is already off.');
  await save(ctx, { dismissed: ctx.state.dismissed });
  await revokeUserSessions(ctx.user._id);
  audit(ctx.user, 'mfa_disabled');
  res.json({ ok: true });
});

exports.profilePasskey = handler(async (req, res) => {
  const ctx = await profileContext(req);
  await checkPassword(ctx, req);
  requireRecentSession(ctx, req);
  const relyingParty = passkeys.context(req);
  if (!ctx.state.secret || !relyingParty) fail(400, 'Set up your authenticator app first and use the configured sign-in site.');
  if ((ctx.state.passkeys?.length || 0) >= 10) fail(409, 'Remove an existing passkey before adding another.');
  const options = await passkeys.options(ctx.user, passkeys.credentials(ctx.state, relyingParty), relyingParty, true);
  const registration = {
    ...relyingParty, challenge: options.challenge, session: String(req.session._id), expiresAt: Date.now() + 120000
  };
  await save(ctx, { ...ctx.state, registration });
  res.json(options);
});
exports.profilePasskeyConfirm = handler(async (req, res) => {
  const ctx = await profileContext(req);
  requireRecentSession(ctx, req);
  const pending = ctx.state.registration;
  if (expired(pending) || pending.session !== String(req.session._id) ||
      pending.origin !== passkeys.context(req)?.origin) invalidFlow();
  const updated = { ...ctx, state: { ...ctx.state, registration: null } };
  updated.revision = await save(ctx, updated.state);
  const verified = await passkeys.verify(req.body?.response, pending).catch(() => null);
  if (!verified?.verified) fail(400, 'The passkey could not be added. Please try again.');
  const { id, publicKey, counter, transports } = verified.registrationInfo.credential;
  if ((updated.state.passkeys?.length || 0) >= 10 ||
      updated.state.passkeys?.some((key) => key.id === id)) fail(409, 'This passkey cannot be added again or the limit has been reached.');
  const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 80) : '';
  const key = { id, publicKey: Buffer.from(publicKey).toString('base64url'), counter, transports,
    rpId: pending.rpId, name: name || 'Passkey', createdAt: new Date().toISOString() };
  const state = { ...updated.state, passkeys: [...(updated.state.passkeys || []), key] };
  await save(updated, state);
  audit(updated.user, 'passkey_added', 'passkey');
  res.json(status({ ...updated, state }, req));
});

exports.profilePasskeyRemove = handler(async (req, res) => {
  const ctx = await profileContext(req);
  await checkPassword(ctx, req);
  requireRecentSession(ctx, req);
  const keys = ctx.state.passkeys || [];
  if (!keys.some((key) => key.id === req.body?.id)) fail(404, 'This passkey was not found.');
  const state = { ...ctx.state, passkeys: keys.filter((key) => key.id !== req.body?.id) };
  await save(ctx, state);
  audit(ctx.user, 'passkey_removed', 'passkey');
  res.json(status({ ...ctx, state }, req));
});
