const { activeEntities, accountingSettings } = require('../services/accountingNotifications');
const { tenantLogoError } = require('../services/tenantLogo');
const Tenant = require('../models/tenant');
const DomainMonitor = require('../models/domainMonitor');
const LicenseCustomer = require('../models/licenseCustomer');
const { DEFAULT_CURRENCY, validateDefaultCurrency } = require('../services/tenantCurrency');
const { DEFAULT_WORK_TURNOVER_DAY, workTurnoverError } = require('../services/workTurnover');

const INTERNAL_LICENSE_TENANTS = ['epds', 'developer', 'epds-admin'];

function normalizeTenantName(input) {
  return String(input || '').trim().toLowerCase();
}

function normalizeTenantDisplayName(input, fallback) {
  return String(input || fallback || '').trim();
}

function normalizeTenantType(input) {
  const type = String(input || 'company').trim().toLowerCase();
  return ['company', 'client', 'finance'].includes(type) ? type : null;
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
    effortTracking: normalizeFeature(input.effortTracking),
    workBoard: normalizeFeature(input.workBoard),
    webhookTester: normalizeFeature(input.webhookTester)
  };
}

function applyTenantFeaturePolicy(name, type, features) {
  const normalizedName = String(name || '').trim().toLowerCase();
  const normalized = {
    ...features,
    webhookTester: { enabled: Boolean(features.webhookTester?.enabled), edit: false, delete: false }
  };
  if (type === 'finance') return normalizeTenantFeatures();
  if (type === 'client') {
    return {
      mail: { enabled: false, edit: false, delete: false },
      domainHealth: {
        enabled: Boolean(normalized.domainHealth?.enabled),
        edit: Boolean(normalized.domainHealth?.enabled && normalized.domainHealth?.edit),
        delete: false
      },
      licenses: normalized.licenses || { enabled: false, edit: false, delete: false },
      effortTracking: { enabled: false, edit: false, delete: false },
      workBoard: { enabled: false, edit: false, delete: false },
      webhookTester: { enabled: false, edit: false, delete: false }
    };
  }
  if (INTERNAL_LICENSE_TENANTS.includes(normalizedName)) {
    return {
      ...normalized,
      licenses: { enabled: true, edit: true, delete: true }
    };
  }
  return {
    ...normalized,
    licenses: { enabled: false, edit: false, delete: false }
  };
}

function defaultTenantFeatures(type = 'company') {
  return {
    mail: { enabled: false, edit: false, delete: false },
    domainHealth: { enabled: type !== 'client', edit: false, delete: false },
    licenses: { enabled: false, edit: false, delete: false },
    effortTracking: { enabled: false, edit: false, delete: false },
    workBoard: { enabled: false, edit: false, delete: false },
    webhookTester: { enabled: false, edit: false, delete: false }
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
    logoDataUrl: tenant.logoDataUrl ?? null,
    weeklyWorkSummary: Boolean(tenant.weeklyWorkSummarySince),
    accountingNotifications: tenant.accountingNotifications ?? null,
    accountingEntities: activeEntities(tenant.workFieldSettings),
    defaultCurrency: tenant.defaultCurrency || DEFAULT_CURRENCY,
    workTurnoverDay: tenant.workTurnoverDay ?? DEFAULT_WORK_TURNOVER_DAY,
    alignWorkSequence: tenant.alignWorkSequence === true,
    features: normalizeTenantFeatures(tenant.features || {}),
    financeAccess: tenant.features?.financeAccess?.enabled === true,
    ownerUserId: tenant.ownerUserId ? String(tenant.ownerUserId) : null,
    createdAt: tenant.createdAt,
    updatedAt: tenant.updatedAt
  };
}

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
      req.body?.features ? normalizeTenantFeatures(req.body.features) : defaultTenantFeatures(type)
    );
    if (!name) return res.status(400).json({ error: 'Tenant name is required' });
    if (!type) return res.status(400).json({ error: 'Valid tenant type is required' });
    const currency = req.body?.defaultCurrency === undefined ? DEFAULT_CURRENCY : validateDefaultCurrency(req.body.defaultCurrency);
    if (!currency) return res.status(400).json({ error: 'Select an available default currency.' });
    const logoDataUrl = req.body?.logoDataUrl;
    const logoError = tenantLogoError(logoDataUrl);
    if (logoError) return res.status(400).json({ error: logoError });

    const { workTurnoverDay, alignWorkSequence } = req.body || {};
    const turnoverError = workTurnoverError({ workTurnoverDay, alignWorkSequence });
    if (turnoverError) return res.status(400).json({ error: turnoverError });

    const existing = await Tenant.findOne({ name });
    if (existing) return res.status(409).json({ error: 'Tenant already exists' });

    const tenant = await Tenant.create({
      name,
      displayName,
      type,
      logoDataUrl,
      weeklyWorkSummarySince: req.body?.weeklyWorkSummary === true ? new Date() : null,
      accountingNotifications: accountingSettings(req.body?.accountingNotifications),
      defaultCurrency: currency,
      workTurnoverDay,
      alignWorkSequence,
      features: { ...features, financeAccess: { enabled: type !== 'finance' && req.body?.financeAccess === true } },
      seats: { max: 0, used: 0 },
      seatsManaged: 'manual'
    });
    return res.status(201).json({ tenant: presentTenant(tenant) });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ error: 'Tenant already exists' });
    if (error.statusCode === 400) return res.status(400).json({ error: error.message });
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

    const logoDataUrl = req.body?.logoDataUrl;
    const logoError = tenantLogoError(logoDataUrl);
    if (logoError) return res.status(400).json({ error: logoError });

    const { workTurnoverDay, alignWorkSequence } = req.body || {};
    const turnoverError = workTurnoverError({ workTurnoverDay, alignWorkSequence });
    if (turnoverError) return res.status(400).json({ error: turnoverError });

    if ((type === 'finance') !== (tenant.type === 'finance')) {
      return res.status(400).json({ error: 'Create a separate Finance tenant.' });
    }
    const existing = await Tenant.findOne({ name, _id: { $ne: tenant._id } });
    if (existing) return res.status(409).json({ error: 'Tenant already exists' });

    const accountingNotifications = accountingSettings(req.body?.accountingNotifications, tenant.workFieldSettings);
    if (typeof req.body?.weeklyWorkSummary === 'boolean') {
      tenant.weeklyWorkSummarySince = req.body.weeklyWorkSummary ? tenant.weeklyWorkSummarySince || new Date() : null;
    }
    if (accountingNotifications !== undefined) tenant.accountingNotifications = accountingNotifications;
    tenant.name = name;
    tenant.displayName = displayName;
    tenant.type = type;
    if (logoDataUrl !== undefined) tenant.logoDataUrl = logoDataUrl;
    if (req.body?.defaultCurrency !== undefined) {
      const currency = validateDefaultCurrency(req.body.defaultCurrency, tenant.defaultCurrency);
      if (!currency) return res.status(400).json({ error: 'Select an available default currency.' });
      tenant.defaultCurrency = currency;
    }
    if (workTurnoverDay !== undefined) tenant.workTurnoverDay = workTurnoverDay;
    if (alignWorkSequence !== undefined) tenant.alignWorkSequence = alignWorkSequence;
    const financeAccess = req.body?.financeAccess ?? tenant.features?.financeAccess?.enabled;
    tenant.features = { ...features, financeAccess: { enabled: type !== 'finance' && financeAccess === true } };
    await tenant.save();
    await syncTenantReferences(tenant);
    return res.json({ tenant: presentTenant(tenant) });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ error: 'Tenant already exists' });
    if (error.statusCode === 400) return res.status(400).json({ error: error.message });
    console.error('[admin] update tenant failed:', error);
    return res.status(500).json({ error: 'Tenant update failed' });
  }
};
