const Tenant = require('../models/tenant');
const DomainMonitor = require('../models/domainMonitor');

const seededTenants = [
  { name: 'epds', displayName: 'EPDS' },
  { name: 'developer', displayName: 'Developer' },
  { name: 'epds-admin', displayName: 'EPDS Admin' },
  { name: 'exnb-exva', displayName: 'ExNB/EXVA' },
  { name: 'stahl', displayName: 'Stahl' },
  { name: 'veproil', displayName: 'Veproil' },
  { name: 'ind-ex', displayName: 'IndEx' },
  { name: 'robex', displayName: 'Robex' }
];

const seededDomains = [
  { domain: 'exnb.eu', tenantName: 'exnb-exva', owner: 'ExNB' },
  { domain: 'exva.hu', tenantName: 'exnb-exva', owner: 'EXVA' },
  { domain: 'rstahl.hu', tenantName: 'stahl', owner: 'Stahl' },
  { domain: 'veproil.hu', tenantName: 'veproil', owner: 'Veproil' },
  { domain: 'epds.hu', tenantName: 'epds', owner: 'EPDS' },
  { domain: 'ind-ex.ae', tenantName: 'ind-ex', owner: 'IndEx' },
  { domain: 'ind-ex.eu', tenantName: 'ind-ex', owner: 'IndEx' },
  { domain: 'robex.hu', tenantName: 'robex', owner: 'Robex' },
  { domain: 'robex.ro', tenantName: 'robex', owner: 'Robex' }
];

function defaultTenantFeatures() {
  return {
    mail: { enabled: false, edit: false, delete: false },
    domainHealth: { enabled: true, edit: false, delete: false },
    licenses: { enabled: false, edit: false, delete: false },
    effortTracking: { enabled: false, edit: false, delete: false }
  };
}

function isInternalLicenseTenant(name) {
  return ['epds', 'developer', 'epds-admin'].includes(String(name || '').trim().toLowerCase());
}

function normalizedBaseUrl(domain) {
  return `https://${String(domain || '').trim().toLowerCase()}`;
}

async function seedKnownTenants() {
  for (const seed of seededTenants) {
    const tenant = await Tenant.findOne({ name: seed.name });
    if (!tenant) {
      await Tenant.create({
        name: seed.name,
        displayName: seed.displayName,
        type: 'company',
        features: defaultTenantFeatures(),
        seats: { max: 0, used: 0 },
        seatsManaged: 'manual'
      });
      continue;
    }
    if (!tenant.displayName) {
      tenant.displayName = seed.displayName;
      await tenant.save();
    }
  }
}

async function seedKnownDomains() {
  const tenants = await Tenant.find({ name: { $in: seededTenants.map((tenant) => tenant.name) } }).lean();
  const tenantsByName = new Map(tenants.map((tenant) => [tenant.name, tenant]));

  await DomainMonitor.updateMany({ owner: 'ExNB/Exva' }, { $set: { owner: 'ExNB' } });
  await DomainMonitor.updateMany({ owner: 'Ind-Ex' }, { $set: { owner: 'IndEx' } });

  for (const seed of seededDomains) {
    const tenant = tenantsByName.get(seed.tenantName);
    if (!tenant) continue;
    const normalizedUrl = normalizedBaseUrl(seed.domain);
    await DomainMonitor.findOneAndUpdate(
      { normalizedUrl },
      {
        $set: {
          name: seed.domain,
          baseUrl: normalizedUrl,
          normalizedUrl,
          tenantId: tenant._id,
          enabled: true
        },
        $setOnInsert: {
          owner: seed.owner,
          healthConfig: {}
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }
}

async function normalizeTenantTypes() {
  await seedKnownTenants();

  await Tenant.updateMany(
    { $or: [{ type: { $exists: false } }, { type: { $nin: ['company', 'client'] } }] },
    { $set: { type: 'company' } }
  );

  const tenants = await Tenant.find();
  for (const tenant of tenants) {
    let changed = false;
    if (!tenant.displayName) {
      tenant.displayName = tenant.name;
      changed = true;
    }
    for (const key of ['mail', 'domainHealth', 'licenses', 'effortTracking']) {
      const value = tenant.features?.[key];
      if (typeof value === 'boolean') {
        tenant.set(`features.${key}`, { enabled: value, edit: value, delete: value });
        changed = true;
      } else if (!value || typeof value.enabled !== 'boolean') {
        const enabled = key === 'domainHealth';
        tenant.set(`features.${key}`, { enabled, edit: false, delete: false });
        changed = true;
      } else {
        if (typeof value.edit !== 'boolean') {
          tenant.set(`features.${key}.edit`, Boolean(value.enabled));
          changed = true;
        }
        if (typeof value.delete !== 'boolean') {
          tenant.set(`features.${key}.delete`, Boolean(value.enabled));
          changed = true;
        }
        if (!value.enabled && (value.edit || value.delete)) {
          tenant.set(`features.${key}.edit`, false);
          tenant.set(`features.${key}.delete`, false);
          changed = true;
        }
      }
    }
    if (isInternalLicenseTenant(tenant.name)) {
      tenant.set('features.licenses', { enabled: true, edit: true, delete: true });
      changed = true;
    } else if (tenant.type !== 'client' && tenant.features?.licenses?.enabled) {
      tenant.set('features.licenses', { enabled: false, edit: false, delete: false });
      changed = true;
    }
    if (changed) await tenant.save();
  }

  await seedKnownDomains();
}

module.exports = { normalizeTenantTypes };
