const crypto = require('crypto');
const DomainHealthCheck = require('../models/domainHealthCheck');
const DomainHealthDailyRollup = require('../models/domainHealthDailyRollup');
const DomainStatusReportSnapshot = require('../models/domainStatusReportSnapshot');

const SNAPSHOT_MAX_AGE_MS = Number(process.env.DOMAIN_STATUS_SNAPSHOT_MAX_AGE_MS || 20 * 60 * 1000);
const LEASE_MS = Number(process.env.DOMAIN_STATUS_REBUILD_LEASE_MS || 5 * 60 * 1000);
const ROLLUP_RETENTION_DAYS = Number(process.env.DOMAIN_STATUS_ROLLUP_RETENTION_DAYS || 400);
const localBuilds = new Map();

function dayStart(value = new Date()) {
  const date = new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function reportEtag(report) {
  return `\"${crypto.createHash('sha256').update(JSON.stringify(report)).digest('base64url')}\"`;
}

async function rebuildDailyRollups(from = new Date(Date.now() - 31 * 86400000)) {
  const start = dayStart(from);
  const rows = await DomainHealthCheck.aggregate([
    { $match: { checkedAt: { $gte: start } } },
    { $project: {
      domainId: 1, checkedAt: 1, status: 1, ok: 1, responseMs: 1,
      day: { $dateTrunc: { date: '$checkedAt', unit: 'day', timezone: 'UTC' } }
    } },
    { $group: {
      _id: { domainId: '$domainId', day: '$day' },
      totalChecks: { $sum: 1 },
      okCount: { $sum: { $cond: [{ $eq: ['$status', 'ok'] }, 1, 0] } },
      warningCount: { $sum: { $cond: [{ $eq: ['$status', 'warning'] }, 1, 0] } },
      errorCount: { $sum: { $cond: [{ $or: [{ $eq: ['$status', 'error'] }, { $and: [{ $eq: ['$status', null] }, { $eq: ['$ok', false] }] }] }, 1, 0] } },
      responseMsSum: { $sum: { $cond: [{ $and: ['$ok', { $isNumber: '$responseMs' }] }, '$responseMs', 0] } },
      responseMsCount: { $sum: { $cond: [{ $and: ['$ok', { $isNumber: '$responseMs' }] }, 1, 0] } },
      responseMsSamples: { $push: { $cond: [{ $and: ['$ok', { $isNumber: '$responseMs' }] }, '$responseMs', '$$REMOVE'] } },
      firstCheckedAt: { $min: '$checkedAt' },
      lastCheckedAt: { $max: '$checkedAt' }
    } }
  ]).allowDiskUse(true);

  if (rows.length) {
    await DomainHealthDailyRollup.bulkWrite(rows.map((row) => ({
      updateOne: {
        filter: { domainId: row._id.domainId, day: row._id.day },
        update: { $set: {
          domainId: row._id.domainId,
          day: row._id.day,
          totalChecks: row.totalChecks,
          okCount: row.okCount,
          warningCount: row.warningCount,
          errorCount: row.errorCount,
          responseMsSum: row.responseMsSum,
          responseMsCount: row.responseMsCount,
          responseMsSamples: row.responseMsSamples,
          firstCheckedAt: row.firstCheckedAt,
          lastCheckedAt: row.lastCheckedAt
        } },
        upsert: true
      }
    })), { ordered: false });
  }
  await DomainHealthDailyRollup.deleteMany({ day: { $lt: dayStart(new Date(Date.now() - ROLLUP_RETENTION_DAYS * 86400000)) } });
  return rows.length;
}

async function acquireLease(ownerSlug) {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + LEASE_MS);
  try {
    const doc = await DomainStatusReportSnapshot.findOneAndUpdate(
      { ownerSlug, $or: [{ leaseUntil: null }, { leaseUntil: { $lt: now } }, { leaseUntil: { $exists: false } }] },
      { $set: { leaseUntil }, $setOnInsert: { generatedAt: new Date(0), report: {}, buildDurationMs: 0, ready: false } },
      { upsert: true, new: true }
    ).lean();
    return Boolean(doc);
  } catch (err) {
    if (err.code === 11000) return false;
    throw err;
  }
}

async function rebuildSnapshot(owner = 'all') {
  const { buildPublicStatusReport } = require('./domainMonitorService');
  const slug = owner === 'all' ? 'all' : String(owner).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!(await acquireLease(slug))) return null;
  const startedAt = Date.now();
  try {
    const report = await buildPublicStatusReport({ owner });
    await DomainStatusReportSnapshot.updateOne({ ownerSlug: slug }, {
      $set: { report, generatedAt: new Date(report.generatedAt), buildDurationMs: Date.now() - startedAt, leaseUntil: null, ready: true }
    });
    const { ensureDailyPdf } = require('./domainStatusPdfCacheService');
    void ensureDailyPdf(report).catch((err) => console.error(`[domain-status-pdf] pre-generation failed for ${slug}:`, err.message));
    return report;
  } catch (err) {
    await DomainStatusReportSnapshot.updateOne({ ownerSlug: slug }, { $set: { leaseUntil: null } }).catch(() => {});
    throw err;
  }
}

function queueSnapshotRebuild(owner = 'all') {
  const key = owner || 'all';
  if (localBuilds.has(key)) return localBuilds.get(key);
  const promise = rebuildSnapshot(key)
    .catch((err) => console.error(`[domain-status] snapshot rebuild failed for ${key}:`, err.message))
    .finally(() => localBuilds.delete(key));
  localBuilds.set(key, promise);
  return promise;
}

async function rebuildAllSnapshots() {
  const report = await queueSnapshotRebuild('all');
  if (!report) return;
  const owners = [...new Set(report.domains.map((item) => item.domain.owner).filter(Boolean))];
  const now = new Date(report.generatedAt);
  const operations = owners.map((owner) => {
    const domains = report.domains.filter((item) => item.domain.owner === owner);
    const summary = domains.reduce((acc, item) => {
      acc.domainCount += 1;
      if (item.domain.displayStatus === 'error') acc.errorCount += 1;
      else if (item.domain.displayStatus === 'warning') acc.warningCount += 1;
      else if (item.domain.displayStatus === 'ok') acc.okCount += 1;
      return acc;
    }, { domainCount: 0, okCount: 0, warningCount: 0, errorCount: 0 });
    const ownerReport = { owner, ownerSlug: String(owner).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''), generatedAt: report.generatedAt, summary, domains };
    return { updateOne: { filter: { ownerSlug: ownerReport.ownerSlug }, update: { $set: { report: ownerReport, generatedAt: now, buildDurationMs: 0, leaseUntil: null, ready: true } }, upsert: true } };
  });
  if (operations.length) await DomainStatusReportSnapshot.bulkWrite(operations, { ordered: false });
  const { ensureDailyPdf } = require('./domainStatusPdfCacheService');
  await Promise.all(operations.map((operation) => ensureDailyPdf(operation.updateOne.update.$set.report)
    .catch((err) => console.error('[domain-status-pdf] owner pre-generation failed:', err.message))));
}

let maintenanceTimer;
function startDomainStatusReadModel() {
  if (maintenanceTimer) return;
  const initialDelay = Number(process.env.DOMAIN_STATUS_INITIAL_DELAY_MS || 30000);
  setTimeout(() => {
    void rebuildDailyRollups().catch((err) => console.error('[domain-status] initial rollup failed:', err.message));
    void rebuildAllSnapshots().catch((err) => console.error('[domain-status] initial snapshot failed:', err.message));
  }, initialDelay).unref?.();
  maintenanceTimer = setInterval(() => {
    void rebuildDailyRollups(new Date(Date.now() - 2 * 86400000))
      .catch((err) => console.error('[domain-status] rollup refresh failed:', err.message));
  }, 60 * 60 * 1000);
  maintenanceTimer.unref?.();
}

async function getStatusSnapshot(owner, { allowBuild = true } = {}) {
  const slug = owner === 'All' || owner === 'all' ? 'all' : String(owner).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  let snapshot = await DomainStatusReportSnapshot.findOne({ ownerSlug: slug, ready: true }).select('report generatedAt buildDurationMs').lean();
  const stale = !snapshot || Date.now() - new Date(snapshot.generatedAt).getTime() > SNAPSHOT_MAX_AGE_MS;
  if (!snapshot && allowBuild) {
    await queueSnapshotRebuild(owner === 'All' ? 'all' : owner);
    snapshot = await DomainStatusReportSnapshot.findOne({ ownerSlug: slug, ready: true }).select('report generatedAt buildDurationMs').lean();
  } else if (stale && allowBuild) {
    void queueSnapshotRebuild(owner === 'All' ? 'all' : owner);
  }
  return snapshot ? { report: snapshot.report, etag: reportEtag(snapshot.report), stale, buildDurationMs: snapshot.buildDurationMs } : null;
}

module.exports = { getStatusSnapshot, queueSnapshotRebuild, rebuildAllSnapshots, rebuildDailyRollups, reportEtag, startDomainStatusReadModel };
