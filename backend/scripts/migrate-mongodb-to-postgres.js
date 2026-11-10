/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { EJSON } = require('bson');
const { Pool } = require('pg');
const crypto = require('crypto');
const { projectCore, verifyCore } = require('./postgres-core-projector');
const { projectAux, verifyAux } = require('./postgres-aux-projector');

const SCHEMA_DIR = path.join(__dirname, '..', 'postgres');
const BATCH_SIZE = Math.max(10, Number(process.env.POSTGRES_MIGRATION_BATCH_SIZE || 250));

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function extendedJson(value) {
  return JSON.parse(EJSON.stringify(value, { relaxed: false }));
}

async function connectMongo() {
  await mongoose.connect(required('MONGODB_URI'), { autoIndex: false });
  return mongoose.connection.db;
}

function createPool() {
  return new Pool({
    connectionString: required('DATABASE_URL'),
    max: 4,
    statement_timeout: 120000,
    application_name: 'epds-admin-migration'
  });
}

async function applySchema(pool) {
  const sql = ['001_initial_schema.sql', '009_effort_board.sql']
    .map((file) => fs.readFileSync(path.join(SCHEMA_DIR, file), 'utf8'))
    .join('\n');
  await pool.query(sql);
  console.log('[postgres-migration] schema applied');
}

async function collectionNames(db) {
  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  return collections
    .map((item) => item.name)
    .filter((name) => !name.startsWith('system.'))
    .sort();
}

async function sourceCounts(db, names) {
  const result = {};
  for (const name of names) result[name] = await db.collection(name).countDocuments({});
  return result;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function archiveCollection(db, pool, name, runId) {
  const cursor = db.collection(name).find({}, { noCursorTimeout: true }).sort({ _id: 1 });
  let batch = [];
  let imported = 0;

  async function flush() {
    if (!batch.length) return;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const doc of batch) {
        await client.query(
          `INSERT INTO mongo_source_documents
             (collection_name, document_id, document, source_updated_at, imported_at, last_seen_run_id)
           VALUES ($1, $2, $3::jsonb, $4, now(), $5)
           ON CONFLICT (collection_name, document_id) DO UPDATE SET
             document = EXCLUDED.document,
             source_updated_at = EXCLUDED.source_updated_at,
             imported_at = now(),
             last_seen_run_id = EXCLUDED.last_seen_run_id`,
          [name, String(doc._id), JSON.stringify(extendedJson(doc)), doc.updatedAt || null, runId]
        );
      }
      await client.query('COMMIT');
      imported += batch.length;
      batch = [];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  for await (const doc of cursor) {
    batch.push(doc);
    if (batch.length >= BATCH_SIZE) await flush();
  }
  await flush();
  const removed = await pool.query(
    `DELETE FROM mongo_source_documents
      WHERE collection_name=$1 AND last_seen_run_id IS DISTINCT FROM $2`,
    [name, runId]
  );
  if (removed.rowCount) console.log(`[postgres-migration] removed stale ${name}: ${removed.rowCount}`);
  console.log(`[postgres-migration] archived ${name}: ${imported}`);
  return imported;
}

async function targetCounts(pool) {
  const { rows } = await pool.query(
    `SELECT collection_name, count(*)::bigint AS count
       FROM mongo_source_documents
      GROUP BY collection_name
      ORDER BY collection_name`
  );
  return Object.fromEntries(rows.map((row) => [row.collection_name, Number(row.count)]));
}

function compareCounts(source, target) {
  const names = [...new Set([...Object.keys(source), ...Object.keys(target)])].sort();
  return names.map((name) => ({
    collection: name,
    source: Number(source[name] || 0),
    target: Number(target[name] || 0),
    ok: Number(source[name] || 0) === Number(target[name] || 0)
  }));
}

async function verify(db, pool) {
  const names = await collectionNames(db);
  const source = await sourceCounts(db, names);
  const target = await targetCounts(pool);
  const comparison = compareCounts(source, target);
  for (const row of comparison) {
    if (!row.ok) continue;
    const sourceHash = crypto.createHash('sha256');
    const targetHash = crypto.createHash('sha256');
    const sourceCursor = db.collection(row.collection).find({}, { noCursorTimeout: true }).sort({ _id: 1 });
    for await (const doc of sourceCursor) {
      sourceHash.update(String(doc._id)).update('\0').update(stableJson(extendedJson(doc))).update('\n');
    }
    const archived = await pool.query(
      `SELECT document_id, document FROM mongo_source_documents
        WHERE collection_name=$1 ORDER BY document_id`, [row.collection]
    );
    for (const doc of archived.rows) {
      targetHash.update(doc.document_id).update('\0').update(stableJson(doc.document)).update('\n');
    }
    row.sourceSha256 = sourceHash.digest('hex');
    row.targetSha256 = targetHash.digest('hex');
    row.ok = row.sourceSha256 === row.targetSha256;
  }
  console.table(comparison);
  const failures = comparison.filter((row) => !row.ok);
  if (failures.length) throw new Error(`Archive verification failed for ${failures.length} collection(s)`);
  console.log(`[postgres-migration] verified ${comparison.length} collections`);
  return { source, target };
}

async function archive(db, pool) {
  const names = await collectionNames(db);
  const source = await sourceCounts(db, names);
  const run = await pool.query(
    `INSERT INTO migration_runs (source_database, source_counts)
     VALUES ($1, $2::jsonb) RETURNING id`,
    [db.databaseName, JSON.stringify(source)]
  );
  const runId = run.rows[0].id;
  try {
    for (const name of names) await archiveCollection(db, pool, name, runId);
    const result = await verify(db, pool);
    await pool.query(
      `UPDATE migration_runs
          SET completed_at = now(), status = 'completed', target_counts = $2::jsonb
        WHERE id = $1`,
      [runId, JSON.stringify(result.target)]
    );
  } catch (error) {
    await pool.query(
      `UPDATE migration_runs SET completed_at = now(), status = 'failed', error = $2 WHERE id = $1`,
      [runId, String(error.stack || error.message || error).slice(0, 10000)]
    ).catch(() => {});
    throw error;
  }
}

async function main() {
  const command = String(process.argv[2] || 'all').toLowerCase();
  const pool = createPool();
  let db;
  try {
    await pool.query('SELECT 1');
    if (command === 'schema' || command === 'all') await applySchema(pool);
    if (command === 'archive' || command === 'verify' || command === 'all') db = await connectMongo();
    if (command === 'archive' || command === 'all') await archive(db, pool);
    if (command === 'verify') await verify(db, pool);
    if (command === 'project' || command === 'all') {
      const counts = await projectCore(pool);
      console.log('[postgres-migration] core relational projection complete', counts);
      await verifyCore(pool);
      console.log('[postgres-migration] core relational projection verified');
      const auxiliaryCounts = await projectAux(pool);
      console.log('[postgres-migration] auxiliary relational projection complete', auxiliaryCounts);
      await verifyAux(pool);
      console.log('[postgres-migration] auxiliary relational projection verified');
    }
  } finally {
    if (db) await mongoose.disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('[postgres-migration] failed', error);
  process.exitCode = 1;
});
