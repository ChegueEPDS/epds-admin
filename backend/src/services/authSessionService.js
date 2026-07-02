const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/user');
const Tenant = require('../models/tenant');
const Session = require('../models/session');

const ACCESS_COOKIE = 'access_token';
const REFRESH_COOKIE = 'refresh_token';
const CSRF_COOKIE = 'csrf_token';

function parseDurationMs(input, fallbackMs) {
  const raw = String(input || '').trim();
  const m = raw.match(/^(\d+)\s*(ms|s|m|h|d)?$/i);
  if (!m) return fallbackMs;
  const n = Number(m[1]);
  const unit = (m[2] || 'ms').toLowerCase();
  return n * ({ ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 }[unit] || 1);
}

function randomToken(bytes = 48) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function mustJwtSecret() {
  if (!process.env.JWT_SECRET) throw new Error('Missing JWT_SECRET');
  return process.env.JWT_SECRET;
}

function accessTtl() {
  return process.env.ACCESS_TOKEN_TTL_WEB || '15m';
}

function refreshTtlMs() {
  return parseDurationMs(process.env.REFRESH_TOKEN_TTL_WEB || '12h', 12 * 3600000);
}

function absoluteTtlMs() {
  return parseDurationMs(process.env.SESSION_ABSOLUTE_TTL_WEB || '24h', 24 * 3600000);
}

function cookieSecure(req) {
  const explicit = String(process.env.AUTH_COOKIE_SECURE || '').trim();
  if (explicit) return explicit.toLowerCase() === 'true';
  return process.env.NODE_ENV === 'production' || req.secure || req.headers['x-forwarded-proto'] === 'https';
}

function cookieSameSite() {
  const value = String(process.env.AUTH_COOKIE_SAMESITE || 'lax').toLowerCase();
  return ['lax', 'strict', 'none'].includes(value) ? value : 'lax';
}

function cookieOptions(req, maxAge, httpOnly = true) {
  const opts = {
    httpOnly,
    secure: cookieSecure(req),
    sameSite: cookieSameSite(),
    path: '/',
    maxAge
  };
  const domain = String(process.env.AUTH_COOKIE_DOMAIN || '').trim();
  if (domain) opts.domain = domain;
  return opts;
}

function parseCookies(req) {
  return String(req.headers?.cookie || '').split(';').reduce((acc, part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return acc;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) acc[key] = decodeURIComponent(value);
    return acc;
  }, {});
}

async function buildUserContext(user, session = null) {
  const tenant = user.tenantId
    ? await Tenant.findById(user.tenantId).lean().select('name type plan features professionRbacEnabled')
    : null;

  return {
    id: String(user._id),
    userId: String(user._id),
    role: user.role,
    tenantId: user.tenantId ? String(user.tenantId) : null,
    tenantName: tenant?.name || null,
    tenantType: tenant?.type || null,
    firstName: user.firstName || '',
    lastName: user.lastName || '',
    email: user.email || '',
    nickname: user.nickname || null,
    azureId: user.azureId || null,
    plan: tenant?.plan || null,
    tenantFeatures: tenant?.features || {},
    professionRbacEnabled: Boolean(tenant?.professionRbacEnabled),
    permissions: ['*:*'],
    professions: user.professions || [],
    sessionId: session ? String(session._id) : null
  };
}

function buildSessionMetadata(session, accessToken = null) {
  const decoded = accessToken ? jwt.decode(accessToken) : null;
  return {
    sessionId: session ? String(session._id) : null,
    clientType: session?.clientType || null,
    accessExpiresAt: decoded?.exp ? new Date(decoded.exp * 1000).toISOString() : null,
    refreshExpiresAt: session?.expiresAt ? new Date(session.expiresAt).toISOString() : null,
    absoluteExpiresAt: session?.absoluteExpiresAt ? new Date(session.absoluteExpiresAt).toISOString() : null,
    serverNow: new Date().toISOString()
  };
}

async function signAccessToken(user, session) {
  const ctx = await buildUserContext(user, session);
  const payload = {
    sub: ctx.userId,
    userId: ctx.userId,
    sid: String(session._id),
    role: ctx.role,
    tenantId: ctx.tenantId,
    tenantName: ctx.tenantName,
    tenantType: ctx.tenantType,
    firstName: ctx.firstName,
    lastName: ctx.lastName,
    azureId: ctx.azureId,
    tenantFeatures: ctx.tenantFeatures,
    permissions: ctx.permissions,
    type: 'access',
    typ: 'access',
    aud: process.env.JWT_AUDIENCE || 'epds-admin-api',
    iss: process.env.JWT_ISSUER || 'epds-admin-backend',
    jti: randomToken(16),
    v: 4
  };
  return jwt.sign(payload, mustJwtSecret(), { expiresIn: accessTtl() });
}

async function createSession({ user, req }) {
  const refreshToken = randomToken();
  const now = Date.now();
  const absoluteExpiresAt = new Date(now + absoluteTtlMs());
  const expiresAt = new Date(Math.min(now + refreshTtlMs(), absoluteExpiresAt.getTime()));
  const session = await Session.create({
    userId: user._id,
    tenantId: user.tenantId,
    clientType: 'web',
    refreshTokenHash: hashToken(refreshToken),
    expiresAt,
    absoluteExpiresAt,
    userAgent: String(req?.headers?.['user-agent'] || '').slice(0, 500),
    ip: String(req?.ip || req?.connection?.remoteAddress || '')
  });
  const accessToken = await signAccessToken(user, session);
  return {
    session,
    accessToken,
    refreshToken,
    user: await buildUserContext(user, session),
    sessionMeta: buildSessionMetadata(session, accessToken)
  };
}

async function rotateRefreshToken({ refreshToken, req }) {
  const now = Date.now();
  const nowDate = new Date(now);
  const refreshHash = hashToken(refreshToken);
  const graceMs = parseDurationMs(process.env.REFRESH_ROTATION_GRACE || '10s', 10000);
  let session = await Session.findOne({ refreshTokenHash: refreshHash, revokedAt: null, expiresAt: { $gt: nowDate } });

  if (!session) {
    session = await Session.findOne({
      previousRefreshTokenHash: refreshHash,
      previousRefreshTokenGraceUntil: { $gt: nowDate },
      revokedAt: null,
      expiresAt: { $gt: nowDate }
    });
    if (!session) throw new Error('Invalid refresh token');
    const user = await User.findById(session.userId);
    if (!user || !user.tenantId) throw new Error('Invalid session user');
    const accessToken = await signAccessToken(user, session);
    return {
      session,
      accessToken,
      refreshToken: null,
      user: await buildUserContext(user, session),
      sessionMeta: buildSessionMetadata(session, accessToken)
    };
  }

  if (session.absoluteExpiresAt && new Date(session.absoluteExpiresAt).getTime() <= now) {
    await Session.findByIdAndUpdate(session._id, { revokedAt: nowDate });
    throw new Error('Session absolute lifetime expired');
  }

  const user = await User.findById(session.userId);
  if (!user || !user.tenantId) throw new Error('Invalid session user');

  const nextRefreshToken = randomToken();
  session.previousRefreshTokenHash = refreshHash;
  session.previousRefreshTokenGraceUntil = new Date(now + graceMs);
  session.refreshTokenHash = hashToken(nextRefreshToken);
  session.expiresAt = new Date(Math.min(now + refreshTtlMs(), new Date(session.absoluteExpiresAt).getTime()));
  session.lastSeenAt = nowDate;
  session.userAgent = String(req?.headers?.['user-agent'] || session.userAgent || '').slice(0, 500);
  session.ip = String(req?.ip || req?.connection?.remoteAddress || session.ip || '');
  await session.save();

  const accessToken = await signAccessToken(user, session);
  return {
    session,
    accessToken,
    refreshToken: nextRefreshToken,
    user: await buildUserContext(user, session),
    sessionMeta: buildSessionMetadata(session, accessToken)
  };
}

async function authenticateAccessToken(token) {
  const decoded = jwt.verify(token, mustJwtSecret(), {
    audience: process.env.JWT_AUDIENCE || 'epds-admin-api',
    issuer: process.env.JWT_ISSUER || 'epds-admin-backend'
  });
  if (decoded.type !== 'access' && decoded.typ !== 'access') throw new Error('Wrong token type');
  if (!decoded.sid) throw new Error('Missing session');

  const session = await Session.findOne({ _id: decoded.sid, revokedAt: null, expiresAt: { $gt: new Date() } }).lean();
  if (!session) throw new Error('Session revoked or expired');
  if (session.absoluteExpiresAt && new Date(session.absoluteExpiresAt).getTime() <= Date.now()) {
    await Session.findByIdAndUpdate(session._id, { revokedAt: new Date() });
    throw new Error('Session absolute lifetime expired');
  }

  const user = await User.findById(session.userId).lean();
  if (!user || !user.tenantId) throw new Error('Invalid session user');
  return { decoded, session, user: await buildUserContext(user, session) };
}

function setAuthCookies(res, req, result) {
  const refreshMs = Math.max(0, new Date(result.session.expiresAt).getTime() - Date.now());
  const accessMs = parseDurationMs(accessTtl(), 15 * 60000);
  res.cookie(ACCESS_COOKIE, result.accessToken, cookieOptions(req, accessMs, true));
  if (result.refreshToken) {
    res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOptions(req, refreshMs, true));
    res.cookie(CSRF_COOKIE, randomToken(24), cookieOptions(req, refreshMs, false));
  }
}

function clearAuthCookies(res, req) {
  res.clearCookie(ACCESS_COOKIE, cookieOptions(req, 0, true));
  res.clearCookie(REFRESH_COOKIE, cookieOptions(req, 0, true));
  res.clearCookie(CSRF_COOKIE, cookieOptions(req, 0, false));
}

function getAccessTokenFromRequest(req) {
  const authHeader = req.headers?.authorization || req.headers?.Authorization || '';
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice(7).trim();
    if (bearer && bearer !== 'cookie-session') return { token: bearer, source: 'bearer' };
  }
  const cookies = parseCookies(req);
  return cookies[ACCESS_COOKIE] ? { token: cookies[ACCESS_COOKIE], source: 'cookie' } : { token: null, source: null };
}

function getRefreshTokenFromRequest(req) {
  const cookies = parseCookies(req);
  return req.body?.refreshToken || req.headers?.['x-refresh-token'] || cookies[REFRESH_COOKIE] || null;
}

function validateCsrf(req, tokenSource) {
  const configured = String(process.env.AUTH_REQUIRE_CSRF || '').trim().toLowerCase();
  const required = configured ? configured === 'true' : process.env.NODE_ENV === 'production';
  if (!required || tokenSource !== 'cookie') return true;
  if (['GET', 'HEAD', 'OPTIONS'].includes(String(req.method || '').toUpperCase())) return true;
  const cookies = parseCookies(req);
  return Boolean(cookies[CSRF_COOKIE] && req.headers['x-csrf-token'] && cookies[CSRF_COOKIE] === String(req.headers['x-csrf-token']));
}

async function revokeSession(sessionId) {
  if (sessionId) await Session.findByIdAndUpdate(sessionId, { revokedAt: new Date() });
}

module.exports = {
  authenticateAccessToken,
  buildSessionMetadata,
  clearAuthCookies,
  createSession,
  getAccessTokenFromRequest,
  getRefreshTokenFromRequest,
  revokeSession,
  rotateRefreshToken,
  setAuthCookies,
  validateCsrf
};
