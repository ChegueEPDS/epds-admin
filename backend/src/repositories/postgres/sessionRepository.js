const mongoose = require('mongoose');
const { query, withTransaction } = require('../../postgres');

function present(row) {
  if (!row) return null;
  return {
    _id: row.id, id: row.id, userId: row.user_id, tenantId: row.tenant_id,
    clientType: row.client_type, refreshTokenHash: row.refresh_token_hash,
    previousRefreshTokenHash: row.previous_refresh_token_hash,
    previousRefreshTokenGraceUntil: row.previous_refresh_token_grace_until,
    revokedAt: row.revoked_at, expiresAt: row.expires_at,
    absoluteExpiresAt: row.absolute_expires_at, lastSeenAt: row.last_seen_at,
    userAgent: row.user_agent, ip: row.ip, createdAt: row.created_at, updatedAt: row.updated_at
  };
}

async function create(input, client = null) {
  const executor = client || { query };
  const sessionId = String(input.id || input._id || new mongoose.Types.ObjectId());
  const result = await executor.query(`
    INSERT INTO sessions
      (id,user_id,tenant_id,client_type,refresh_token_hash,previous_refresh_token_hash,
       previous_refresh_token_grace_until,revoked_at,expires_at,absolute_expires_at,
       last_seen_at,user_agent,ip,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,coalesce($11,now()),$12,$13,now(),now())
    RETURNING *`, [sessionId, String(input.userId), input.tenantId ? String(input.tenantId) : null,
    input.clientType || 'web', input.refreshTokenHash, input.previousRefreshTokenHash || null,
    input.previousRefreshTokenGraceUntil || null, input.revokedAt || null, input.expiresAt,
    input.absoluteExpiresAt || null, input.lastSeenAt || null, input.userAgent || '', input.ip || '']);
  return present(result.rows[0]);
}

async function findActiveById(sessionId, now = new Date()) {
  const result = await query(
    'SELECT * FROM sessions WHERE id=$1 AND revoked_at IS NULL AND expires_at>$2', [String(sessionId), now]
  );
  return present(result.rows[0]);
}

async function findForRefresh(refreshHash, now = new Date(), client = null) {
  const executor = client || { query };
  const result = await executor.query(`
    SELECT *,
      CASE WHEN refresh_token_hash=$1 THEN 'current' ELSE 'grace' END AS token_match
    FROM sessions
    WHERE revoked_at IS NULL AND expires_at>$2
      AND (refresh_token_hash=$1 OR
        (previous_refresh_token_hash=$1 AND previous_refresh_token_grace_until>$2))
    ORDER BY CASE WHEN refresh_token_hash=$1 THEN 0 ELSE 1 END
    LIMIT 1`, [refreshHash, now]);
  const session = present(result.rows[0]);
  if (session) session.tokenMatch = result.rows[0].token_match;
  return session;
}

async function rotate({ id, currentHash, nextHash, graceUntil, expiresAt, lastSeenAt, userAgent, ip }) {
  return withTransaction(async (client) => {
    const locked = await client.query('SELECT * FROM sessions WHERE id=$1 FOR UPDATE', [String(id)]);
    const row = locked.rows[0];
    if (!row || row.revoked_at || row.refresh_token_hash !== currentHash || new Date(row.expires_at) <= lastSeenAt) return null;
    const result = await client.query(`
      UPDATE sessions SET
        previous_refresh_token_hash=$2, previous_refresh_token_grace_until=$3,
        refresh_token_hash=$4, expires_at=$5, last_seen_at=$6,
        user_agent=$7, ip=$8, updated_at=now()
      WHERE id=$1 RETURNING *`, [String(id), currentHash, graceUntil, nextHash, expiresAt,
      lastSeenAt, userAgent || row.user_agent, ip || row.ip]);
    return present(result.rows[0]);
  }, { isolationLevel: 'READ COMMITTED' });
}

async function revoke(id, at = new Date()) {
  const result = await query(
    'UPDATE sessions SET revoked_at=coalesce(revoked_at,$2),updated_at=now() WHERE id=$1 RETURNING *',
    [String(id), at]
  );
  return present(result.rows[0]);
}

async function deleteExpired(now = new Date()) {
  const result = await query('DELETE FROM sessions WHERE expires_at<=$1 OR revoked_at IS NOT NULL', [now]);
  return result.rowCount;
}

module.exports = { create, findActiveById, findForRefresh, rotate, revoke, deleteExpired, present };
