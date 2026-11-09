const mongoose = require('mongoose');
const { databaseEngine, checkPostgresHealth } = require('./postgres');
const { ensureDomainCustomerSchema } = require('./services/domainSchemaMigrationService');
const { ensureWorkFieldSchema } = require('./services/workFieldSchema');
const { assertPostgresRuntimeReady } = require('./repositories/repositoryRegistry');

async function connectDb() {
  if (databaseEngine() === 'postgresql') {
    require('./repositories/postgres').registerImplementedRepositories();
    assertPostgresRuntimeReady();
    const health = await checkPostgresHealth(5000);
    if (!health.ok) throw new Error(`PostgreSQL connection failed: ${health.error || health.stateLabel}`);
    await ensureDomainCustomerSchema();
    await ensureWorkFieldSchema();
    console.log('[db] PostgreSQL connected');
    return;
  }
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('Missing MONGODB_URI');

  mongoose.set('strictQuery', true);
  await mongoose.connect(uri);
  console.log('[db] connected');
}

async function checkDbHealth(timeoutMs = 1500) {
  if (databaseEngine() === 'postgresql') return checkPostgresHealth(timeoutMs);
  const state = mongoose.connection.readyState;
  const stateLabel = ['disconnected', 'connected', 'connecting', 'disconnecting'][state] || 'unknown';
  if (state !== 1 || !mongoose.connection.db) {
    return { ok: false, state, stateLabel };
  }

  try {
    await Promise.race([
      mongoose.connection.db.admin().ping(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('MongoDB ping timed out')), timeoutMs))
    ]);
    return { ok: true, state, stateLabel };
  } catch (err) {
    return { ok: false, state, stateLabel, error: err.message };
  }
}

module.exports = { connectDb, checkDbHealth };
