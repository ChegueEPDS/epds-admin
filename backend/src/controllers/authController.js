const User = require('../models/user');
const Tenant = require('../models/tenant');
const { verifyMicrosoftAccessToken } = require('../services/microsoftTokenVerifier');
const {
  buildSessionMetadata,
  clearAuthCookies,
  createSession,
  getRefreshTokenFromRequest,
  revokeSession,
  rotateRefreshToken,
  setAuthCookies
} = require('../services/authSessionService');

function sendAuthResult(req, res, result) {
  setAuthCookies(res, req, result);
  return res.status(200).json({ user: result.user, session: result.sessionMeta });
}

function slugifyTenantName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\-_.]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 64) || 'epds-admin';
}

function allowedEmailDomains() {
  return String(process.env.EPDS_ADMIN_ALLOWED_EMAIL_DOMAINS || '')
    .split(',')
    .map((domain) => domain.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
}

function assertAllowedCompanyEmail(email) {
  const domains = allowedEmailDomains();
  if (!domains.length) return;
  const domain = String(email || '').split('@').pop()?.toLowerCase() || '';
  if (!domains.includes(domain)) {
    const err = new Error('This Microsoft account is outside the allowed company group.');
    err.statusCode = 403;
    throw err;
  }
}

function tenantNameFromEmail(email) {
  const domain = String(email || '').split('@').pop()?.toLowerCase() || '';
  const base = domain.split('.')[0] || process.env.EPDS_ADMIN_DEFAULT_TENANT_NAME || 'epds-admin';
  return slugifyTenantName(base);
}

async function ensureCompanyTenantForEmail(user, email) {
  const name = tenantNameFromEmail(email);
  let tenant = await Tenant.findOne({ name });
  if (!tenant) {
    tenant = await Tenant.create({
      name,
      type: 'company',
      plan: 'team',
      ownerUserId: user._id,
      seats: { max: 0, used: 0 },
      seatsManaged: 'manual'
    });
  }
  if (!user.tenantId || String(user.tenantId) !== String(tenant._id)) {
    user.tenantId = tenant._id;
    await user.save();
  }
  return user;
}

exports.microsoftLogin = async (req, res) => {
  try {
    const accessToken = req.body?.accessToken || req.body?.idToken;
    if (!accessToken) return res.status(400).json({ error: 'Microsoft token is required' });

    const decodedToken = await verifyMicrosoftAccessToken(accessToken);
    const email = String(decodedToken.upn || decodedToken.email || decodedToken.preferred_username || '').trim().toLowerCase();
    const azureId = decodedToken.oid || decodedToken.sub;
    if (!azureId) return res.status(400).json({ error: 'Azure ID is missing in the token' });
    if (!email) return res.status(400).json({ error: 'Email is missing in the Microsoft token' });
    assertAllowedCompanyEmail(email);

    let user = await User.findOne({ $or: [{ azureId }, { email }] });
    if (!user) {
      user = await User.create({
        azureId,
        firstName: decodedToken.given_name || decodedToken.name || 'User',
        lastName: decodedToken.family_name || '',
        email,
        role: 'User',
        emailVerified: true
      });
    } else {
      user.azureId = user.azureId || azureId;
      user.email = user.email || email;
      user.firstName = user.firstName || decodedToken.given_name || decodedToken.name || 'User';
      user.lastName = user.lastName || decodedToken.family_name || '';
      user.emailVerified = true;
      await user.save();
    }

    user = await ensureCompanyTenantForEmail(user, email);
    user.lastLoginAt = new Date();
    await user.save();

    const result = await createSession({ user, req });
    return sendAuthResult(req, res, result);
  } catch (error) {
    console.error('[auth] microsoft login failed:', error);
    return res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Microsoft login failed' });
  }
};

exports.me = async (req, res) => {
  return res.json({ user: req.user, session: buildSessionMetadata(req.session, null) });
};

exports.renewToken = async (req, res) => {
  try {
    const refreshToken = getRefreshTokenFromRequest(req);
    if (!refreshToken) return res.status(401).json({ error: 'No refresh token provided' });
    const result = await rotateRefreshToken({ refreshToken, req });
    return sendAuthResult(req, res, result);
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
