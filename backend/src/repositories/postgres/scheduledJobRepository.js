const mongoose = require('mongoose');
const { query } = require('../../postgres');

async function acquire(name, holder, lockedUntil, now = new Date()) {
  const result = await query(`
    INSERT INTO scheduled_job_leases(id,name,holder,locked_until,created_at,updated_at)
    VALUES($1,$2,$3,$4,now(),now())
    ON CONFLICT(name) DO UPDATE SET holder=EXCLUDED.holder,locked_until=EXCLUDED.locked_until,updated_at=now()
    WHERE scheduled_job_leases.locked_until<=$5
    RETURNING holder,locked_until`,
  [String(new mongoose.Types.ObjectId()),name,holder,lockedUntil,now]);
  return result.rows[0]?.holder === holder;
}

async function release(name, holder) {
  const result = await query(`UPDATE scheduled_job_leases SET locked_until=to_timestamp(0),updated_at=now()
    WHERE name=$1 AND holder=$2`,[name,holder]);
  return result.rowCount > 0;
}

module.exports={acquire,release};
