const mongoose = require('mongoose');
const User = require('../models/user');
const Tenant = require('../models/tenant');
const { databaseEngine, query } = require('../postgres');
const users = require('../repositories/postgres/userRepository');
const tenants = require('../repositories/postgres/tenantRepository');

const postgres = () => databaseEngine() === 'postgresql';
const columns = {
  _id: 'id', email: 'email', tenantId: 'tenant_id', additionalTenantIds: 'additional_tenant_ids', role: 'role', firstName: 'first_name',
  lastName: 'last_name', loginMethod: 'login_method', emailVerified: 'email_verified',
  azureId: 'azure_id', microsoftTenantId: 'microsoft_tenant_id', password: 'password',
  accountTokenHash: 'account_token_hash', accountTokenPurpose: 'account_token_purpose',
  accountTokenExpiresAt: 'account_token_expires_at', lastLoginAt: 'last_login_at'
};

async function updateAccount(where, changes, { liveToken = false, client, session } = {}) {
  const matched = liveToken ? { ...where, accountTokenExpiresAt: { $gt: new Date() } } : { ...where };
  if (!postgres()) {
    if (Array.isArray(matched.additionalTenantIds) && !matched.additionalTenantIds.length) {
      delete matched.additionalTenantIds;
      matched.$or = [{ additionalTenantIds: [] }, { additionalTenantIds: { $exists: false } }];
    }
    return User.findOneAndUpdate(matched, { $set: changes }, { new: true, session });
  }

  const parameters = [];
  const bind = (value) => {
    parameters.push(value);
    return `$${parameters.length}`;
  };
  const assignments = Object.entries(changes).map(([key, value]) => `${columns[key]}=${bind(value)}`);
  const predicates = Object.entries(where).map(([key, value]) => value == null
    ? `${columns[key]} IS NULL`
    : `${columns[key]}=${bind(value)}`);
  if (liveToken) predicates.push('account_token_expires_at>now()');
  const result = await (client || { query }).query(
    `UPDATE users SET ${assignments.join(',')},updated_at=now() WHERE ${predicates.join(' AND ')} RETURNING *`,
    parameters
  );
  return users.present(result.rows[0], true);
}

const findById = (id) => mongoose.isObjectIdOrHexString(id)
  ? (postgres() ? users.findById(id, { includePassword: true }) : User.findById(id))
  : null;
const findEmail = (email) => postgres() ? users.findByEmail(email, { includePassword: true }) : User.findOne({ email });
const findMicrosoft = (azureId) => postgres() ? users.findByAzureId(azureId) : User.findOne({ azureId });
const findTenant = (id) => mongoose.isObjectIdOrHexString(id)
  ? (postgres() ? tenants.findById(id) : Tenant.findById(id))
  : null;
const list = (tenantId) => postgres()
  ? (tenantId ? users.listByTenant(tenantId) : users.listAll())
  : User.find(tenantId ? { $or: [{ tenantId }, { additionalTenantIds: tenantId }] } : {}).populate('tenantId', 'name displayName').sort({ email: 1 });
const create = (input) => postgres() ? users.save(input) : User.create(input);

module.exports = { updateAccount, findById, findEmail, findMicrosoft, findTenant, list, create };
