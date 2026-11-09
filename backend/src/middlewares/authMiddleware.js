const {
  authenticateAccessToken,
  getAccessTokenFromRequest,
  validateCsrf
} = require('../services/authSessionService');
const mongoose = require('mongoose');
const Tenant = require('../models/tenant');
const { databaseEngine } = require('../postgres');
const tenantRepository = require('../repositories/postgres/tenantRepository');

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
        actorTenantId: user.tenantId || null,
        tenantId: user.tenantId,
        tenantName: user.tenantName,
        tenantType: user.tenantType,
        tenantFeatures: user.tenantFeatures || {},
        sessionId: String(session._id)
      };

      const requestedTenantId = String(req.headers?.['x-tenant-context'] || '').trim();
      if (requestedTenantId) {
        if (user.role !== 'SuperAdmin') {
          return res.status(403).json({ error: 'Only SuperAdmin can select another tenant context' });
        }
        if (!mongoose.Types.ObjectId.isValid(requestedTenantId)) {
          return res.status(400).json({ error: 'Invalid tenant context' });
        }
        const selectedTenant = databaseEngine() === 'postgresql'
          ? await tenantRepository.findById(requestedTenantId)
          : await Tenant.findById(requestedTenantId).lean();
        if (!selectedTenant) {
          return res.status(404).json({ error: 'Selected tenant not found' });
        }
        req.scope.tenantId = String(selectedTenant._id);
        req.scope.tenantName = selectedTenant.displayName || selectedTenant.name;
        req.scope.tenantType = selectedTenant.type;
        req.scope.tenantFeatures = selectedTenant.features || {};
        req.tenantContext = selectedTenant;
      }
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
    if (req.role === 'SuperAdmin' && !req.scope?.tenantId) return next();
    if (!req.scope?.tenantId) {
      return res.status(403).json({ error: 'Tenant feature access required' });
    }
    const features = req.scope.tenantFeatures || {};
    if (['workBoard', 'projectTracker'].includes(featureKey) && req.scope.tenantType === 'client') {
      return res.status(403).json({ error: 'Tenant feature is disabled' });
    }
    if (featureKey === 'projectTracker' && !features.workBoard?.enabled) {
      return res.status(403).json({ error: 'Work Board is required' });
    }
    const feature = features[featureKey];
    if (!feature?.enabled) {
      return res.status(403).json({ error: 'Tenant feature is disabled' });
    }
    if (permission !== 'enabled' && !feature?.[permission]) {
      return res.status(403).json({ error: 'Tenant feature permission is disabled' });
    }
    return next();
  };
}

function requireTenantContext(req, res, next) {
  if (!req.scope?.tenantId) {
    return res.status(403).json({ error: 'Tenant context is required' });
  }
  return next();
}

function requireSuperAdmin(req, res, next) {
  if (req.role !== 'SuperAdmin') {
    return res.status(403).json({ error: 'SuperAdmin access required' });
  }
  return next();
}

module.exports = { requireAuth, requireEpdsEmail, requireAdminFeatureAccess, requireSuperAdmin, requireTenantFeature, requireTenantContext };
