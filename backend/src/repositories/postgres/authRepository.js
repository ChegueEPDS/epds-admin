const tenantRepository = require('./tenantRepository');
const userRepository = require('./userRepository');

const DEFAULT_FEATURES = {
  mail: { enabled: false, edit: false, delete: false },
  domainHealth: { enabled: true, edit: false, delete: false },
  licenses: { enabled: false, edit: false, delete: false },
  effortTracking: { enabled: false, edit: false, delete: false },
  workBoard: { enabled: false, edit: false, delete: false },
  projectTracker: { enabled: false, edit: false, delete: false },
  webhookTester: { enabled: false, edit: false, delete: false }
};

async function findPasswordUser(email) {
  return userRepository.findByEmail(email, { includePassword: true });
}

async function findMicrosoftUser(azureId, email) {
  return userRepository.findByAzureIdOrEmail(azureId, email);
}

async function saveUser(user, options = {}) {
  return userRepository.save(user, options);
}

async function ensureCompanyTenant(user, { name, displayName }) {
  let tenant = await tenantRepository.findByName(name);
  if (!tenant) tenant = await tenantRepository.save({
    name, displayName, type: 'company', features: DEFAULT_FEATURES,
    ownerUserId: user._id, seats: { max: 0, used: 0 }, seatsManaged: 'manual'
  });
  else if (!tenant.displayName) tenant = await tenantRepository.save({ ...tenant, displayName });
  if (String(user.tenantId || '') !== String(tenant._id)) user = await userRepository.save({ ...user, tenantId: tenant._id });
  return user;
}

module.exports = { findPasswordUser, findMicrosoftUser, saveUser, ensureCompanyTenant };
