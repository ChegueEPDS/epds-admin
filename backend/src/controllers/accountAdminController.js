const { requestLanguage } = require('../services/uiLanguage');
const { tagChange } = require('../services/securityAudit');
const { canRecover, recoveryAvailable } = require('../services/accountRecovery');
const accounts = require('../services/accountStore');
const { sendAccountLink, clearToken, normalizeEmail, validEmail } = require('../services/accountInvitations');
const { ASSIGNABLE_ROLES, SUPERADMIN_EMAIL } = require('../services/accountRoles');

function membershipIds(user) {
  return [user.tenantId?._id || user.tenantId, ...(user.additionalTenantIds || [])].filter(Boolean).map(String);
}

function present(user, tenant = user.tenantId, scoped = false) {
  return {
    id: String(user._id), email: user.email, firstName: user.firstName, lastName: user.lastName,
    role: user.role, tenantId: scoped ? String(tenant._id) : membershipIds(user)[0] || null,
    tenantIds: scoped ? [String(tenant._id)] : membershipIds(user),
    canManage: !scoped || (user.role === 'User' && membershipIds(user).length === 1),
    tenantName: tenant?.name, tenantDisplayName: tenant?.displayName || tenant?.name,
    azureId: user.azureId, loginMethod: user.loginMethod || (user.azureId ? 'microsoft' : 'password'),
    pendingActivation: Boolean(user.loginMethod && !user.emailVerified),
    invitationExpiresAt: user.accountTokenPurpose === 'invite' ? user.accountTokenExpiresAt : null,
    lastLoginAt: user.lastLoginAt, createdAt: user.createdAt, updatedAt: user.updatedAt
  };
}

function canManage(req, user) {
  return req.role === 'SuperAdmin' || (req.scope.tenantId && membershipIds(user).length === 1 && membershipIds(user)[0] === req.scope.tenantId &&
    user.role === 'User');
}

function canAssign(req, tenantId, role) {
  return ASSIGNABLE_ROLES.includes(role) && (req.role === 'SuperAdmin' ||
    (tenantId === req.scope.tenantId && role === 'User'));
}

async function resolveAssignment(req, res, tenantId, role, tenantIds) {
  if (tenantIds !== undefined && (!Array.isArray(tenantIds) ||
      tenantIds.some((id) => typeof id !== 'string'))) {
    res.status(400).json({ error: 'Invalid tenant selection.' });
    return null;
  }
  const ids = [...new Set([tenantId, ...(tenantIds || [])])];
  if (ids.some((id) => !canAssign(req, id, role)) || (ids.length > 1 && req.role !== 'SuperAdmin')) {
    res.status(403).json({ error: 'Tenant or role is outside your access.' });
    return null;
  }
  const tenants = await Promise.all(ids.map(accounts.findTenant));
  if (tenants.some((tenant) => !tenant)) {
    res.status(404).json({ error: 'Tenant not found.' });
    return null;
  }
  if ((ids.length > 1 && role === 'Finance') || tenants.some((tenant) => tenant.type === 'finance' && role !== 'Finance')) {
    res.status(400).json({ error: 'Finance access requires a single tenant and the Finance role.' });
    return null;
  }
  return { tenant: tenants[0], additionalTenantIds: ids.slice(1) };
}

function finishError(error, res, next) {
  if (['23505', 11000].includes(error.code)) return res.status(409).json({ error: 'User already exists' });
  return next(error);
}

async function sendInvite(user, language) {
  try {
    return await sendAccountLink(user, 'invite', language);
  } catch {
    return false;
  }
}

exports.listUsers = async (req, res, next) => {
  try {
    if (req.role === 'Admin' && !req.scope.tenantId) return res.sendStatus(403);
    const users = await accounts.list(req.role === 'SuperAdmin' ? null : req.scope.tenantId);
    const ownTenant = req.role === 'Admin' ? await accounts.findTenant(req.scope.tenantId) : null;
    if (req.role === 'Admin' && !ownTenant) return res.sendStatus(403);
    res.json({ users: users.map((user) => present(user, ownTenant || user.tenantId, Boolean(ownTenant))) });
  } catch (error) { next(error); }
};

exports.createUser = async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const firstName = String(req.body?.firstName || '').trim();
    const lastName = String(req.body?.lastName || '').trim();
    const { tenantId, role, loginMethod } = req.body || {};
    if (!validEmail(email) || email === SUPERADMIN_EMAIL || !firstName || !lastName ||
        !['microsoft', 'password'].includes(loginMethod)) {
      return res.status(400).json({ error: 'Valid user data and a sign-in method are required.' });
    }
    const assignment = await resolveAssignment(req, res, tenantId, role, req.body?.tenantIds);
    if (!assignment) return;
    const { tenant, additionalTenantIds } = assignment;
    const user = await accounts.create({ email, firstName, lastName, tenantId, additionalTenantIds, role, loginMethod, emailVerified: false });
    const invitationSent = await sendInvite(user, requestLanguage(req));
    return res.status(201).json({ user: { ...present(await accounts.findById(String(user._id)), tenant), invitationSent } });
  } catch (error) { return finishError(error, res, next); }
};

exports.resend = async (req, res, next) => {
  try {
    const user = await accounts.findById(req.params.id);
    if (!user || !canManage(req, user)) return res.status(404).json({ error: 'User not found.' });
    if (user.role === 'SuperAdmin' || !user.loginMethod || user.emailVerified || !await accounts.findTenant(user.tenantId)) {
      return res.status(409).json({ error: 'This account has no pending invitation.' });
    }
    if (!await sendInvite(user, requestLanguage(req))) return res.status(503).json({ error: 'Invitation could not be sent. Please retry.' });
    const updated = await accounts.findById(req.params.id);
    res.json({ user: present(updated, await accounts.findTenant(updated.tenantId)) });
  } catch (error) { next(error); }
};

async function editUser(req, res, next, onlyRole) {
  try {
    const user = await accounts.findById(req.params.id);
    if (!user || !canManage(req, user) || user.email === SUPERADMIN_EMAIL || user.role === 'SuperAdmin') {
      return res.status(404).json({ error: 'Editable user not found.' });
    }
    const role = req.body?.role;
    const tenantId = onlyRole ? String(user.tenantId || '') : req.body?.tenantId;
    const assignment = await resolveAssignment(req, res, tenantId, role, onlyRole ? membershipIds(user) : req.body?.tenantIds ?? (req.role === 'SuperAdmin' ? user.additionalTenantIds : []));
    if (!assignment) return;
    const { tenant, additionalTenantIds } = assignment;
    const changes = { role, tenantId, additionalTenantIds };
    if (!onlyRole && !user.azureId) {
      const email = normalizeEmail(req.body?.email);
      const firstName = String(req.body?.firstName || '').trim();
      const lastName = String(req.body?.lastName || '').trim();
      if (!validEmail(email) || email === SUPERADMIN_EMAIL || !firstName || !lastName) {
        return res.status(400).json({ error: 'Valid email and name are required.' });
      }
      Object.assign(changes, { email, firstName, lastName });
      if (email !== user.email) Object.assign(changes, clearToken);
    }
    const saved = await accounts.updateAccount({
      _id: req.params.id, tenantId: user.tenantId, additionalTenantIds: user.additionalTenantIds || [], role: user.role, email: user.email, azureId: user.azureId || null
    }, changes);
    if (!saved) return res.status(409).json({ error: 'User changed. Reload and try again.' });
    tagChange(req, 'account.role_or_tenant_changed', user, saved, ['role', 'tenantId', 'additionalTenantIds'], tenantId);
    return res.json({ user: present(saved, tenant) });
  } catch (error) { return finishError(error, res, next); }
}

exports.updateUser = (req, res, next) => editUser(req, res, next, false);
exports.updateUserRole = (req, res, next) => editUser(req, res, next, true);

exports.tenantOptions = async (req, res, next) => {
  if (req.role === 'SuperAdmin') return require('./adminControllerFacade').listTenants(req, res, next);
  try {
    const tenant = await accounts.findTenant(req.scope.tenantId);
    return res.json({ tenants: tenant ? [{
      id: String(tenant._id), name: tenant.name, displayName: tenant.displayName, type: tenant.type
    }] : [] });
  } catch (error) { next(error); }
};

exports.recoverAccount = async (req, res, next) => {
  try {
    const user = await accounts.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    if (!canRecover(user) || !await accounts.findTenant(user.tenantId)) {
      return res.status(409).json({ error: 'Only active local accounts can be recovered here.' });
    }
    if (user.accountTokenPurpose === 'recovery' && new Date(user.accountTokenExpiresAt) > new Date(Date.now() + 29 * 60000)) {
      return res.status(429).json({ error: 'A recovery link was just sent. Wait one minute before sending another.' });
    }
    if (!await recoveryAvailable()) {
      return res.status(503).json({ error: 'Account recovery requires a transaction-capable database.' });
    }
    const sent = await sendAccountLink(user, 'recovery', requestLanguage(req)).catch(() => false);
    if (!sent) return res.status(503).json({ error: 'Recovery link could not be sent. Check mail delivery and try again.' });
    req.securityAudit = { action: 'account.recovery_sent', tenantId: String(user.tenantId) };
    return res.json({ ok: true });
  } catch (error) { next(error); }
};
