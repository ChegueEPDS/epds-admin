const {
  authenticateAccessToken,
  getAccessTokenFromRequest,
  validateCsrf
} = require('../services/authSessionService');

function requireAuth(req, res, next) {
  Promise.resolve()
    .then(async () => {
      const { token, source } = getAccessTokenFromRequest(req);
      if (!token) return res.status(401).json({ error: 'No token provided' });
      if (!validateCsrf(req, source)) return res.status(403).json({ error: 'Invalid CSRF token' });

      const { decoded, session, user } = await authenticateAccessToken(token);
      req.auth = decoded;
      req.session = session;
      req.user = user;
      req.userId = user.userId || user.id;
      req.role = user.role;
      req.scope = {
        userId: user.userId || user.id,
        role: user.role,
        tenantId: user.tenantId,
        tenantName: user.tenantName,
        tenantType: user.tenantType,
        sessionId: String(session._id)
      };
      return next();
    })
    .catch(() => res.status(401).json({ error: 'Invalid or expired token' }));
}

function requireEpdsEmail(req, res, next) {
  const email = String(req.user?.email || '').trim().toLowerCase();
  if (!email.endsWith('@epds.hu')) {
    return res.status(403).json({ error: 'EPDS email address required' });
  }
  return next();
}

function requireAdminFeatureAccess(req, res, next) {
  if (req.role === 'SuperAdmin') return next();
  if (!req.scope?.tenantId && !req.scope?.tenantName) {
    return res.status(403).json({ error: 'Admin feature access required' });
  }
  return next();
}

function requireTenantFeature(featureKey, permission = 'enabled') {
  return (req, res, next) => {
    if (req.role === 'SuperAdmin') return next();
    if (!req.scope?.tenantId) {
      return res.status(403).json({ error: 'Tenant feature access required' });
    }
    if (!req.user?.tenantFeatures?.[featureKey]?.enabled) {
      return res.status(403).json({ error: 'Tenant feature is disabled' });
    }
    if (permission !== 'enabled' && !req.user?.tenantFeatures?.[featureKey]?.[permission]) {
      return res.status(403).json({ error: 'Tenant feature permission is disabled' });
    }
    return next();
  };
}

function requireSuperAdmin(req, res, next) {
  if (req.role !== 'SuperAdmin') {
    return res.status(403).json({ error: 'SuperAdmin access required' });
  }
  return next();
}

module.exports = { requireAuth, requireEpdsEmail, requireAdminFeatureAccess, requireSuperAdmin, requireTenantFeature };
