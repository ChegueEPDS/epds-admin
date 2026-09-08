const EffortTask = require('../models/effortTask');
const models = [
  require('../models/domainHealthDailyRollup'),
  require('../models/domainStatusReportSnapshot'),
  require('../models/domainStatusPdf'),
  require('../models/scheduledJobLease'),
  require('../models/licenseEvent'),
  require('../models/licenseCustomer'),
  require('../models/workItem').WorkItem,
  require('../models/subWorkItem'),
  EffortTask
];
const { rebuildAllSnapshots, rebuildDailyRollups } = require('./domainStatusReadModelService');

function embeddedSessionLimit() {
  const configured = Number(process.env.EFFORT_EMBEDDED_SESSION_LIMIT || 100);
  return Number.isFinite(configured) ? Math.max(20, Math.floor(configured)) : 100;
}

async function compactLegacyEffortSessions({ dryRun = false } = {}) {
  const limit = embeddedSessionLimit();
  const cursor = EffortTask.find({ [`sessions.${limit}`]: { $exists: true } })
    .select('sessions archivedNetMs archivedSessionCount firstStartedAt')
    .lean()
    .cursor();
  let scanned = 0;
  let compacted = 0;
  let operations = [];
  for await (const task of cursor) {
    scanned += 1;
    const sessions = task.sessions || [];
    const removed = sessions.slice(0, -limit);
    const retained = sessions.slice(-limit);
    const firstStartedAt = task.firstStartedAt || sessions[0]?.startedAt || null;
    operations.push({ updateOne: {
      filter: { _id: task._id },
      update: { $set: {
        sessions: retained,
        archivedNetMs: Number(task.archivedNetMs || 0) + removed.reduce((sum, session) => sum + Number(session.durationMs || 0), 0),
        archivedSessionCount: Number(task.archivedSessionCount || 0) + removed.length,
        ...(firstStartedAt ? { firstStartedAt } : {})
      } }
    } });
    compacted += removed.length;
    if (!dryRun && operations.length >= 250) {
      await EffortTask.bulkWrite(operations, { ordered: false });
      operations = [];
    }
  }
  if (!dryRun && operations.length) await EffortTask.bulkWrite(operations, { ordered: false });
  return { scannedTasks: scanned, compactedSessions: compacted, dryRun, retainedPerTask: limit };
}

async function ensurePerformanceIndexes() {
  for (const model of models) await model.createIndexes();
  return models.map((model) => model.modelName);
}

async function runPerformanceMigration({ dryRun = false } = {}) {
  const effort = await compactLegacyEffortSessions({ dryRun });
  if (dryRun) return { effort, indexes: [], rollups: 0, snapshots: false };
  const indexes = await ensurePerformanceIndexes();
  const rollups = await rebuildDailyRollups();
  await rebuildAllSnapshots();
  return { effort, indexes, rollups, snapshots: true };
}

module.exports = { compactLegacyEffortSessions, ensurePerformanceIndexes, runPerformanceMigration };
