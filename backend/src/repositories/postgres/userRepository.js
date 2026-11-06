const { query } = require('../../postgres');
const mongoose = require('mongoose');

function present(row, includePassword = false) {
  if (!row) return null;
  const user = {
    _id: row.id, id: row.id, userId: row.id, azureId: row.azure_id,
    firstName: row.first_name, lastName: row.last_name, email: row.email,
    nickname: row.nickname, tenantId: row.tenant_id, role: row.role,
    professions: row.professions || [], emailVerified: Boolean(row.email_verified),
    lastLoginAt: row.last_login_at, createdAt: row.created_at, updatedAt: row.updated_at
  };
  if (includePassword) user.password = row.password;
  return user;
}

async function findById(id, options = {}) {
  const result = await query('SELECT * FROM users WHERE id=$1', [String(id)]);
  return present(result.rows[0], options.includePassword);
}

async function findByEmail(email, options = {}) {
  const result = await query('SELECT * FROM users WHERE email=lower($1)', [String(email).trim()]);
  return present(result.rows[0], options.includePassword);
}

async function findByAzureId(azureId) {
  const result = await query('SELECT * FROM users WHERE azure_id=$1', [String(azureId)]);
  return present(result.rows[0]);
}

async function listByTenant(tenantId) {
  const result = await query(
    'SELECT * FROM users WHERE tenant_id=$1 ORDER BY last_name,first_name,email', [String(tenantId)]
  );
  return result.rows.map((row) => present(row));
}
async function listAll(){const result=await query(`SELECT u.*,t.name tenant_name,t.display_name tenant_display_name FROM users u LEFT JOIN tenants t ON t.id=u.tenant_id ORDER BY u.email LIMIT 500`);return result.rows.map(row=>{const value=present(row);if(row.tenant_id)value.tenantId={_id:row.tenant_id,id:row.tenant_id,name:row.tenant_name,displayName:row.tenant_display_name};return value;});}

async function updateLastLogin(id, at = new Date()) {
  const result = await query('UPDATE users SET last_login_at=$2,updated_at=now() WHERE id=$1 RETURNING *', [String(id), at]);
  return present(result.rows[0]);
}

async function findByAzureIdOrEmail(azureId, email, options = {}) {
  const result = await query('SELECT * FROM users WHERE azure_id=$1 OR email=lower($2) LIMIT 1', [azureId, email]);
  return present(result.rows[0], options.includePassword);
}

async function save(input, options = {}) {
  const userId = String(input.id || input._id || new mongoose.Types.ObjectId());
  const result = await query(`
    INSERT INTO users
      (id,azure_id,first_name,last_name,email,nickname,tenant_id,role,professions,password,
       email_verified,last_login_at,created_at,updated_at)
    VALUES ($1,$2,$3,$4,lower($5),$6,$7,$8,$9::jsonb,$10,$11,$12,coalesce($13,now()),now())
    ON CONFLICT (id) DO UPDATE SET
      azure_id=EXCLUDED.azure_id,first_name=EXCLUDED.first_name,last_name=EXCLUDED.last_name,
      email=EXCLUDED.email,nickname=EXCLUDED.nickname,tenant_id=EXCLUDED.tenant_id,role=EXCLUDED.role,
      professions=EXCLUDED.professions,password=coalesce(EXCLUDED.password,users.password),email_verified=EXCLUDED.email_verified,
      last_login_at=EXCLUDED.last_login_at,updated_at=now()
    RETURNING *`, [userId, input.azureId || null, input.firstName, input.lastName, input.email,
    input.nickname || null, input.tenantId || null, input.role || 'User', JSON.stringify(input.professions || []),
    input.password === undefined ? null : input.password, input.emailVerified !== false,
    input.lastLoginAt || null, input.createdAt || null]);
  return present(result.rows[0], options.includePassword);
}

module.exports = { findById, findByEmail, findByAzureId, findByAzureIdOrEmail, listAll, listByTenant, updateLastLogin, save, present };
