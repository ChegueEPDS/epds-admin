const { query } = require('../../postgres');
const mongoose = require('mongoose');
const { DEFAULT_WORK_TURNOVER_DAY } = require('../../services/workTurnover');

function present(row) {
  if (!row) return null;
  return {
    _id: row.id, id: row.id, name: row.name, displayName: row.display_name,
    type: row.type, ownerUserId: row.owner_user_id,
    defaultCurrency: row.default_currency || 'HUF',
    workTurnoverDay: row.work_turnover_day ?? DEFAULT_WORK_TURNOVER_DAY,
    alignWorkSequence: row.align_work_sequence === true,
    seats: { max: Number(row.seats_max), used: Number(row.seats_used) },
    seatsManaged: row.seats_managed, features: row.features || {},
    professionRbacEnabled: Boolean(row.profession_rbac_enabled),
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

async function findById(id) {
  const result = await query('SELECT * FROM tenants WHERE id=$1', [String(id)]);
  return present(result.rows[0]);
}

async function findByName(name) {
  const result = await query('SELECT * FROM tenants WHERE name=lower($1)', [String(name).trim()]);
  return present(result.rows[0]);
}

async function list() {
  const result = await query('SELECT * FROM tenants ORDER BY display_name NULLS LAST, name');
  return result.rows.map(present);
}

async function save(input) {
  const result = await query(`
    INSERT INTO tenants
      (id,name,display_name,type,owner_user_id,seats_max,seats_used,seats_managed,features,
       profession_rbac_enabled,created_at,updated_at,default_currency,work_turnover_day,align_work_sequence)
    VALUES ($1,lower($2),$3,$4,$5,$6,$7,$8,$9::jsonb,$10,coalesce($11,now()),now(),coalesce($12,'HUF'),coalesce($13,'01-01'),coalesce($14,false))
    ON CONFLICT (id) DO UPDATE SET
      name=EXCLUDED.name, display_name=EXCLUDED.display_name, type=EXCLUDED.type,
      owner_user_id=EXCLUDED.owner_user_id, seats_max=EXCLUDED.seats_max,
      seats_used=EXCLUDED.seats_used, seats_managed=EXCLUDED.seats_managed,
      features=EXCLUDED.features, profession_rbac_enabled=EXCLUDED.profession_rbac_enabled,
      updated_at=now(), default_currency=coalesce($12,tenants.default_currency),
      work_turnover_day=coalesce($13,tenants.work_turnover_day), align_work_sequence=coalesce($14,tenants.align_work_sequence)
    RETURNING *`, [
    String(input.id || input._id || new mongoose.Types.ObjectId()), input.name, input.displayName || null, input.type || 'company',
    input.ownerUserId || null, Number(input.seats?.max || 0), Number(input.seats?.used || 0),
    input.seatsManaged || 'stripe', JSON.stringify(input.features || {}),
    Boolean(input.professionRbacEnabled), input.createdAt || null, input.defaultCurrency || null,
    input.workTurnoverDay ?? null, input.alignWorkSequence ?? null
  ]);
  return present(result.rows[0]);
}

module.exports = { findById, findByName, list, save, present };
