const bcrypt = require('bcryptjs');
const User = require('../models/user');
const Tenant = require('../models/tenant');
const DomainMonitor = require('../models/domainMonitor');
const LicenseCustomer = require('../models/licenseCustomer');
const { ASSIGNABLE_ROLES, SUPERADMIN_EMAIL } = require('../services/userSeedService');

const INTERNAL_LICENSE_TENANTS = ['epds', 'developer', 'epds-admin'];

function normalizeRole(input) {
  const role = String(input || 'User').trim();
  return ASSIGNABLE_ROLES.includes(role) ? role : null;
}

function normalizeTenantName(input) {
  return String(input || '').trim().toLowerCase();
}

function normalizeTenantDisplayName(input, fallback) {
  return String(input || fallback || '').trim();
}

function normalizeTenantType(input) {
  const type = String(input || 'company').trim().toLowerCase();
  return ['company', 'client'].includes(type) ? type : null;
}

function normalizeTenantFeatures(input = {}) {
  const normalizeFeature = (value) => {
    if (typeof value === 'boolean') {
      return { enabled: value, edit: value, delete: value };
    }
    const enabled = Boolean(value?.enabled);
    return {
      enabled,
      edit: enabled && Boolean(value?.edit),
      delete: enabled && Boolean(value?.delete)
    };
  };
  return {
    mail: normalizeFeature(input.mail),
    domainHealth: normalizeFeature(input.domainHealth),
    licenses: normalizeFeature(input.licenses),
    effortTracking: normalizeFeature(input.effortTracking)
  };
}

function applyTenantFeaturePolicy(name, type, features) {
  const normalizedName = String(name || '').trim().toLowerCase();
  if (INTERNAL_LICENSE_TENANTS.includes(normalizedName)) {
    return {
      ...features,
      licenses: { enabled: true, edit: true, delete: true }
    };
  }
  if (type !== 'client') {
    return {
      ...features,
      licenses: { enabled: false, edit: false, delete: false }
    };
  }
  return features;
}

function defaultTenantFeatures() {
  return {
    mail: { enabled: false, edit: false, delete: false },
    domainHealth: { enabled: true, edit: false, delete: false },
    licenses: { enabled: false, edit: false, delete: false },
    effortTracking: { enabled: false, edit: false, delete: false }
  };
}

function tenantLabel(tenant) {
  return String(tenant?.displayName || tenant?.name || '').trim();
}

function defaultDomainOwnerForTenant(tenant) {
  if (tenant?.name === 'exnb-exva') return null;
  return tenantLabel(tenant) || null;
}

async function syncTenantReferences(tenant) {
  const label = tenantLabel(tenant);
  if (label) {
    await LicenseCustomer.updateMany(
      { tenantId: tenant._id },
      {
        $set: {
          customerName: label,
          normalizedCustomerName: label.toLowerCase()
        }
      }
    );
  }

  const domainOwner = defaultDomainOwnerForTenant(tenant);
  if (domainOwner) {
    await DomainMonitor.updateMany(
      { tenantId: tenant._id },
      { $set: { owner: domainOwner } }
    );
  }
}

function presentTenant(tenant) {
  return {
    id: String(tenant._id),
    name: tenant.name,
    displayName: tenant.displayName || tenant.name,
    type: tenant.type,
    features: normalizeTenantFeatures(tenant.features || {}),
    ownerUserId: tenant.ownerUserId ? String(tenant.ownerUserId) : null,
    createdAt: tenant.createdAt,
    updatedAt: tenant.updatedAt
  };
}

function presentUser(user) {
  const tenant = user.tenantId && typeof user.tenantId === 'object' ? user.tenantId : null;
  return {
    id: String(user._id),
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    tenantId: tenant?._id ? String(tenant._id) : (user.tenantId ? String(user.tenantId) : null),
    tenantName: tenant?.name || null,
    tenantDisplayName: tenant?.displayName || tenant?.name || null,
    azureId: user.azureId || null,
    lastLoginAt: user.lastLoginAt || null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

exports.listUsers = async (req, res) => {
  const users = await User.find()
    .sort({ email: 1 })
    .populate('tenantId', 'name displayName')
    .lean();
  res.json({ users: users.map(presentUser) });
};

exports.createUser = async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const firstName = String(req.body?.firstName || '').trim();
    const lastName = String(req.body?.lastName || '').trim();
    const tenantId = String(req.body?.tenantId || '').trim();
    const role = normalizeRole(req.body?.role);

    if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email is required' });
    if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    if (!firstName || !lastName) return res.status(400).json({ error: 'First name and last name are required' });
    if (!tenantId) return res.status(400).json({ error: 'Tenant is required' });
    if (!role) return res.status(400).json({ error: 'Valid role is required' });

    const tenant = await Tenant.findById(tenantId);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ error: 'User already exists' });

    const user = await User.create({
      email,
      firstName,
      lastName,
      tenantId: tenant._id,
      role: email === SUPERADMIN_EMAIL ? 'SuperAdmin' : role,
      password: await bcrypt.hash(password, 12),
      emailVerified: true
    });
    await user.populate('tenantId', 'name displayName');
    res.status(201).json({ user: presentUser(user) });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ error: 'User already exists' });
    console.error('[admin] create user failed:', error);
    res.status(500).json({ error: 'User creation failed' });
  }
};

exports.updateUserRole = async (req, res) => {
  const role = normalizeRole(req.body?.role);
  if (!role) return res.status(400).json({ error: 'Valid role is required' });

  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (String(user.email || '').toLowerCase() === SUPERADMIN_EMAIL) {
    return res.status(400).json({ error: 'SuperAdmin role cannot be changed' });
  }

  user.role = role;
  await user.save();
  await user.populate('tenantId', 'name displayName');
  return res.json({ user: presentUser(user) });
};

exports.updateUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (String(user.email || '').toLowerCase() === SUPERADMIN_EMAIL) {
      return res.status(400).json({ error: 'SuperAdmin user cannot be edited' });
    }

    const role = normalizeRole(req.body?.role);
    if (!role) return res.status(400).json({ error: 'Valid role is required' });
    user.role = role;

    const isMicrosoftUser = Boolean(user.azureId);
    if (!isMicrosoftUser) {
      const email = String(req.body?.email || '').trim().toLowerCase();
      const firstName = String(req.body?.firstName || '').trim();
      const lastName = String(req.body?.lastName || '').trim();
      const tenantId = String(req.body?.tenantId || '').trim();
      const password = String(req.body?.password || '');

      if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email is required' });
      if (!firstName || !lastName) return res.status(400).json({ error: 'First name and last name are required' });
      if (!tenantId) return res.status(400).json({ error: 'Tenant is required' });

      const tenant = await Tenant.findById(tenantId);
      if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

      const existing = await User.findOne({ email, _id: { $ne: user._id } });
      if (existing) return res.status(409).json({ error: 'User already exists' });

      user.email = email;
      user.firstName = firstName;
      user.lastName = lastName;
      user.tenantId = tenant._id;
      if (password) {
        if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
        user.password = await bcrypt.hash(password, 12);
      }
    }

    await user.save();
    await user.populate('tenantId', 'name displayName');
    return res.json({ user: presentUser(user) });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ error: 'User already exists' });
    console.error('[admin] update user failed:', error);
    return res.status(500).json({ error: 'User update failed' });
  }
};

exports.listTenants = async (req, res) => {
  const tenants = await Tenant.find().sort({ name: 1 }).lean();
  res.json({ tenants: tenants.map(presentTenant) });
};

exports.createTenant = async (req, res) => {
  try {
    const name = normalizeTenantName(req.body?.name);
    const displayName = normalizeTenantDisplayName(req.body?.displayName, req.body?.name);
    const type = normalizeTenantType(req.body?.type);
    const features = applyTenantFeaturePolicy(
      name,
      type,
      req.body?.features ? normalizeTenantFeatures(req.body.features) : defaultTenantFeatures()
    );
    if (!name) return res.status(400).json({ error: 'Tenant name is required' });
    if (!type) return res.status(400).json({ error: 'Valid tenant type is required' });

    const existing = await Tenant.findOne({ name });
    if (existing) return res.status(409).json({ error: 'Tenant already exists' });

    const tenant = await Tenant.create({
      name,
      displayName,
      type,
      features,
      seats: { max: 0, used: 0 },
      seatsManaged: 'manual'
    });
    return res.status(201).json({ tenant: presentTenant(tenant) });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ error: 'Tenant already exists' });
    console.error('[admin] create tenant failed:', error);
    return res.status(500).json({ error: 'Tenant creation failed' });
  }
};

exports.updateTenant = async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    const name = normalizeTenantName(req.body?.name);
    const displayName = normalizeTenantDisplayName(req.body?.displayName, req.body?.name);
    const type = normalizeTenantType(req.body?.type);
    const features = applyTenantFeaturePolicy(name, type, normalizeTenantFeatures(req.body?.features));
    if (!name) return res.status(400).json({ error: 'Tenant name is required' });
    if (!type) return res.status(400).json({ error: 'Valid tenant type is required' });

    const existing = await Tenant.findOne({ name, _id: { $ne: tenant._id } });
    if (existing) return res.status(409).json({ error: 'Tenant already exists' });

    tenant.name = name;
    tenant.displayName = displayName;
    tenant.type = type;
    tenant.features = features;
    await tenant.save();
    await syncTenantReferences(tenant);
    return res.json({ tenant: presentTenant(tenant) });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ error: 'Tenant already exists' });
    console.error('[admin] update tenant failed:', error);
    return res.status(500).json({ error: 'Tenant update failed' });
  }
};
