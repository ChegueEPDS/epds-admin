const fs = require('node:fs/promises');
const path = require('node:path');
const mongoose = require('mongoose');
const { databaseEngine, query, withTransaction } = require('../postgres');

const pg = () => databaseEngine() === 'postgresql';
const collection = () => mongoose.connection.db.collection('project_tracker_records');
const key = (tenantId, kind, id) => `${tenantId}:${kind}:${id}`;
const unpack = (row) => row ? { id: row.record_id, version: row.version, data: row.data } : null;

async function initialize() {
  if (!pg()) {
    await collection().createIndex({ tenant_id: 1, kind: 1, record_id: 1 });
    return;
  }
  await withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(2026110903)');
    const migrationId = '003_project_tracker';
    const marker = await client.query('SELECT id FROM app_schema_migrations WHERE id=$1', [migrationId]);
    if (marker.rowCount) return;
    await client.query(await fs.readFile(path.join(__dirname, '../../postgres/003_project_tracker.sql'), 'utf8'));
    await client.query('INSERT INTO app_schema_migrations(id) VALUES($1)', [migrationId]);
  });
}

async function get(tenantId, kind, id) {
  if (!pg()) return unpack(await collection().findOne({ _id: key(tenantId, kind, id) }));
  const result = await query('SELECT record_id,version,data FROM project_tracker_records WHERE tenant_id=$1 AND kind=$2 AND record_id=$3', [tenantId, kind, id]);
  return unpack(result.rows[0]);
}

async function list(tenantId, kind, ids = null, { summary = false } = {}) {
  if (ids && !ids.length) return [];
  if (!pg()) {
    const where = { tenant_id: tenantId, kind, ...(ids ? { record_id: { $in: ids } } : {}) };
    const projection = summary ? { 'data.audit': 0, 'data.remarks': 0, 'data.sharepoint': 0 } : undefined;
    return (await collection().find(where, { projection }).toArray()).map(unpack);
  }
  const result = await query(
    `SELECT record_id,version,${summary ? "data - 'audit' - 'remarks' - 'sharepoint' AS data" : 'data'}
      FROM project_tracker_records WHERE tenant_id=$1 AND kind=$2${ids ? ' AND record_id=ANY($3::text[])' : ''}`,
    ids ? [tenantId, kind, ids] : [tenantId, kind]
  );
  return result.rows.map(unpack);
}

async function save(tenantId, kind, id, version, data) {
  if (!Number.isInteger(version) || version < 0) throw Object.assign(new Error('A record version is required'), { statusCode: 400 });
  const updated = { id, version: version + 1, data };
  if (!pg()) {
    const _id = key(tenantId, kind, id);
    try {
      if (!version) {
        await collection().insertOne({ _id, tenant_id: tenantId, kind, record_id: id, version: 1, data });
        return updated;
      }
      const result = await collection().updateOne({ _id, version }, { $set: { data }, $inc: { version: 1 } });
      if (result.modifiedCount) return updated;
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
  } else {
    const result = version
      ? await query('UPDATE project_tracker_records SET version=version+1,data=$5,updated_at=now() WHERE tenant_id=$1 AND kind=$2 AND record_id=$3 AND version=$4', [tenantId, kind, id, version, JSON.stringify(data)])
      : await query('INSERT INTO project_tracker_records(tenant_id,kind,record_id,version,data) VALUES($1,$2,$3,1,$4) ON CONFLICT DO NOTHING', [tenantId, kind, id, JSON.stringify(data)]);
    if (result.rowCount) return updated;
  }
  throw Object.assign(new Error('This record changed. Reload before saving again.'), { statusCode: 409 });
}

module.exports = { initialize, get, list, save };
