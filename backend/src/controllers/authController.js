const { requestLanguage } = require('../services/uiLanguage');
const { canRecover, completeRecovery } = require('../services/accountRecovery');
const bcrypt = require('bcryptjs');
const accounts = require('../services/accountStore');
const { tokenAccount, sendAccountLink, clearToken, normalizeEmail, validEmail, validPassword } = require('../services/accountInvitations');
const { beginLogin } = require('./mfaController');
const { isLocal } = require('../services/mfaPolicy');
const { SUPERADMIN_EMAIL } = require('../services/accountRoles');
const { verifyMicrosoftAccessToken } = require('../services/microsoftTokenVerifier');
const {
  buildSessionMetadata,
  clearAuthCookies,
  createSession,
  getRefreshTokenFromRequest,
  revokeSession,
  revokeUserSessions,
  rotateRefreshToken,
  setAuthCookies
} = require('../services/authSessionService');

function sendAuthResult(req, res, result, cookieOptions) {
  setAuthCookies(res, req, result, cookieOptions);
  return res.status(200).json({ user: result.user, session: result.sessionMeta });
}

async function hasTenant(user) {
  return user?.role === 'SuperAdmin' || Boolean(await accounts.findTenant(user?.tenantId));
}

const invalidInvitation = (res) => res.status(403).json({ error: 'This invitation is invalid, expired or belongs to another account.' });

exports.invitationDetails = async (req, res, next) => {
  try {
    const user = await tokenAccount(req.body?.account, req.body?.token, 'invite');
    if (!user || user.emailVerified || !await hasTenant(user)) return invalidInvitation(res);
    res.set('Cache-Control', 'no-store').json({ loginMethod: user.loginMethod, email: user.email,
      ...(user.role === 'SuperAdmin' ? { minimumPasswordLength: 16 } : {}) });
  } catch (error) { next(error); }
};

exports.microsoftLogin = async (req, res, next) => {
  const accessToken = req.body?.accessToken || req.body?.idToken;
  if (typeof accessToken !== 'string' || accessToken.length > 16000) {
    return res.status(400).json({ error: 'Valid Microsoft token required.' });
  }
  let claims;
  try {
    claims = await verifyMicrosoftAccessToken(accessToken);
  } catch {
    return res.status(401).json({ error: 'Microsoft sign-in could not be verified.' });
  }

  try {
    const azureId = claims.oid || claims.sub;
    if (!azureId) return res.status(403).json({ error: 'Microsoft identity is unavailable.' });
    let user;
    if (req.body.invite !== undefined) {
      const invited = await tokenAccount(req.body.account, req.body.invite, 'invite');
      const microsoftEmails = [claims.upn, claims.email, claims.preferred_username].map(normalizeEmail);
      if (!invited || invited.emailVerified || invited.azureId || invited.loginMethod !== 'microsoft' ||
          !claims.oid || !claims.tid || !microsoftEmails.includes(invited.email) || !await hasTenant(invited)) {
        return invalidInvitation(res);
      }
      user = await accounts.updateAccount({
        _id: String(invited._id), email: invited.email, tenantId: invited.tenantId, azureId: null,
        accountTokenHash: invited.accountTokenHash, emailVerified: false, loginMethod: 'microsoft'
      }, {
        ...clearToken, azureId, microsoftTenantId: claims.tid, emailVerified: true, lastLoginAt: new Date()
      }, { liveToken: true });
      if (!user) return invalidInvitation(res);
    } else {
      const linked = await accounts.findMicrosoft(azureId);
      if (!linked || linked.loginMethod === 'password' || (linked.microsoftTenantId && linked.microsoftTenantId !== claims.tid)) {
        return res.status(403).json({ error: 'This Microsoft account needs an invitation from your administrator.' });
      }
      if (!await hasTenant(linked)) return res.status(403).json({ error: 'Ask your administrator to assign a tenant.' });
      user = await accounts.updateAccount({
        _id: String(linked._id), azureId, tenantId: linked.tenantId, microsoftTenantId: linked.microsoftTenantId || null
      }, { lastLoginAt: new Date() });
      if (!user) return res.status(409).json({ error: 'Account changed. Please sign in again.' });
    }
    return sendAuthResult(req, res, await createSession({ user, req }));
  } catch (error) {
    if (['23505', 11000].includes(error.code)) {
      return res.status(409).json({ error: 'This Microsoft account is already connected.' });
    }
    return next(error);
  }
};

exports.login = async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = req.body?.password;
    const denied = () => res.status(401).json({ error: 'Invalid email or password.' });
    if (!email || typeof password !== 'string' || !password) return denied();

    const account = await accounts.findEmail(email);
    if (!account?.password || (account.loginMethod && !account.emailVerified) || !isLocal(account) ||
        !await bcrypt.compare(password, account.password)) return denied();
    if (!await hasTenant(account)) return res.status(403).json({ error: 'Ask your administrator to assign a tenant.' });
    const verification = await beginLogin(account, req);
    if (verification?.retry) return res.status(409).json({ error: 'Sign-in changed in another window. Please try again.' });
    if (verification) return res.set('Cache-Control', 'no-store').json({ verification });
    const user = await accounts.updateAccount({
      _id: String(account._id), email, password: account.password, tenantId: account.tenantId,
      role: account.role, loginMethod: account.loginMethod
    }, { lastLoginAt: new Date() });
    if (!user) return denied();
    return sendAuthResult(req, res, await createSession({ user, req }));
  } catch (error) { next(error); }
};

exports.requestPasswordReset = async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const user = validEmail(email) && email !== SUPERADMIN_EMAIL ? await accounts.findEmail(email) : null;
    const pendingRecovery = user?.accountTokenPurpose === 'recovery' && new Date(user.accountTokenExpiresAt) > new Date();
    if (!pendingRecovery && user?.password && user.role !== 'SuperAdmin' && user.loginMethod !== 'microsoft' && await hasTenant(user)) {
      sendAccountLink(user, 'reset', requestLanguage(req)).catch(() => {});
    }
    return res.json({ ok: true });
  } catch (error) { next(error); }
};

exports.setPassword = async (req, res, next) => {
  try {
    const { account, token, purpose, password } = req.body || {};
    if (!validPassword(password)) return res.status(400).json({ error: 'Use at least 8 characters and at most 72 UTF-8 bytes.' });
    if (purpose === 'recovery') {
      const user = await tokenAccount(account, token, purpose);
      if (!canRecover(user) || !await hasTenant(user)) return invalidInvitation(res);
      if (await bcrypt.compare(password, user.password)) {
        return res.status(400).json({ error: 'Choose a different password from your previous password.' });
      }
      if (!await completeRecovery(user, await bcrypt.hash(password, 12))) return invalidInvitation(res);
      req.userId = String(user._id);
      req.role = user.role;
      req.securityAudit = { action: 'account.recovered', tenantId: String(user.tenantId), targetId: String(user._id) };
      return res.set('Cache-Control', 'no-store').json({ ok: true });
    }
    if (!['invite', 'reset'].includes(purpose)) return invalidInvitation(res);
    const user = await tokenAccount(account, token, purpose);
    if (!user || !await hasTenant(user) || (purpose === 'invite'
      ? user.loginMethod !== 'password' || user.emailVerified
      : !user.password || user.loginMethod === 'microsoft' || user.role === 'SuperAdmin' || user.email === SUPERADMIN_EMAIL)) {
      return invalidInvitation(res);
    }

    if (user.role === 'SuperAdmin' && password.length < 16) {
      return res.status(400).json({ error: 'Use at least 16 characters and at most 72 UTF-8 bytes.' });
    }

    const saved = await accounts.updateAccount({
      _id: account, email: user.email, role: user.role, loginMethod: user.loginMethod,
      tenantId: user.tenantId, accountTokenHash: user.accountTokenHash,
      emailVerified: user.emailVerified, password: user.password || null
    }, { ...clearToken, password: await bcrypt.hash(password, 12), emailVerified: true }, { liveToken: true });
    if (!saved) return invalidInvitation(res);
    if (purpose === 'reset') await revokeUserSessions(account);
    return res.json({ ok: true });
  } catch (error) { next(error); }
};

exports.me = async (req, res) => {
  return res.json({ user: req.user, session: buildSessionMetadata(req.session, null) });
};

exports.renewToken = async (req, res) => {
  try {
    const refreshToken = getRefreshTokenFromRequest(req);
    if (!refreshToken) return res.status(401).json({ error: 'No refresh token provided' });
    const result = await rotateRefreshToken({ refreshToken, req });
    return sendAuthResult(req, res, result, { preserveCsrf: true });
  } catch (error) {
    clearAuthCookies(res, req);
    return res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
};

exports.logout = async (req, res) => {
  try {
    if (req.session?._id) await revokeSession(req.session._id);
  } finally {
    clearAuthCookies(res, req);
  }
  return res.json({ ok: true });
};
