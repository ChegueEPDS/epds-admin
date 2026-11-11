const mongoose = require('mongoose');
const { databaseEngine, query } = require('../postgres');
const Tenant = require('../models/tenant');
const { latestRates } = require('./mnbExchangeRates');
const { withJobLease } = require('./scheduledJobLeaseService');
const { DEFAULT_CURRENCY } = require('./tenantCurrency');
const { settings } = require('./workFields');
const { dashboard, dashboardDate } = require('./workDashboard');
const { workPeriodStart } = require('./workTurnover');

const maintenanceInterval = 5 * 60 * 1000;
const builds = new Map();
const collection = () => mongoose.connection.db.collection('work_dashboard_snapshots');

async function readState(tenantId) {
  if (databaseEngine() === 'postgresql') {
    const { rows } = await query(`SELECT s.revision, s.snapshot_key AS "snapshotKey", s.report,
      s.generated_at AS "generatedAt", t.default_currency AS currency, t.work_turnover_day AS "workTurnoverDay",
      t.work_field_settings->>'version' AS "settingsVersion"
      FROM tenants t LEFT JOIN work_dashboard_snapshots s ON s.tenant_id=t.id WHERE t.id=$1`, [tenantId]);
    return rows[0];
  }
  const [row, tenant] = await Promise.all([
    collection().findOne({ _id: tenantId }),
    Tenant.findById(tenantId).select('defaultCurrency workTurnoverDay workFieldSettings.version').lean()
  ]);
  return tenant && { ...row, currency: tenant.defaultCurrency, workTurnoverDay: tenant.workTurnoverDay,
    settingsVersion: tenant.workFieldSettings?.version };
}

async function readInputs(tenantId) {
  const [state, fx] = await Promise.all([readState(tenantId), latestRates()]);
  if (!state) throw Object.assign(new Error('Tenant not found.'), { statusCode: 404 });
  const asOf = dashboardDate();
  const periodStart = workPeriodStart(asOf, state.workTurnoverDay);
  const report = state.report?.periodStart === periodStart ? state.report : null;
  const currency = state.currency || DEFAULT_CURRENCY;
  const revision = String(state.revision ?? 0);
  // Bump the first value when the shape or calculation of the report changes.
  const key = JSON.stringify([3, revision, Number(state.settingsVersion ?? 0), currency,
    asOf, periodStart, fx.snapshot?.date ?? null, fx.refresh?.at ?? null]);
  // MongoDB work writes and invalidation are separate writes. Periodically
  // rebuild to recover from an interrupted invalidation.
  const expired = databaseEngine() !== 'postgresql' && Date.now() - new Date(state.generatedAt).getTime() >= 60 * 60 * 1000;
  return { state, report, asOf, periodStart, currency, fx, revision, key, fresh: Boolean(report && state.snapshotKey === key && !expired) };
}

async function saveSnapshot(tenantId, { revision, key, state }, report) {
  const generatedAt = new Date();
  if (databaseEngine() === 'postgresql') {
    await query(`INSERT INTO work_dashboard_snapshots (tenant_id, revision, snapshot_key, generated_at, report)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (tenant_id) DO UPDATE SET snapshot_key=EXCLUDED.snapshot_key,
        generated_at=EXCLUDED.generated_at, report=EXCLUDED.report
      WHERE work_dashboard_snapshots.revision=$2 AND work_dashboard_snapshots.generated_at IS NOT DISTINCT FROM $6`,
    [tenantId, revision, key, generatedAt, report, state.generatedAt ?? null]);
    return;
  }
  await collection().updateOne({ _id: tenantId }, { $setOnInsert: { revision: 0 } }, { upsert: true });
  await collection().updateOne({ _id: tenantId, revision: Number(revision), generatedAt: state.generatedAt ?? null },
    { $set: { snapshotKey: key, generatedAt, report } });
}

function queueBuild(tenantId) {
  if (builds.has(tenantId)) return builds.get(tenantId);
  const pending = withJobLease(`work-dashboard:${tenantId}`, maintenanceInterval, async () => {
    const inputs = await readInputs(tenantId);
    if (inputs.fresh) return;
    const config = await settings(tenantId);
    const report = await dashboard(tenantId, config, inputs.currency, inputs.fx, inputs.asOf, inputs.periodStart);
    await saveSnapshot(tenantId, inputs, report);
  }).finally(() => builds.delete(tenantId));
  builds.set(tenantId, pending);
  return pending;
}

async function getDashboardSnapshot(tenantId, wait) {
  let inputs = await readInputs(tenantId);
  if (!inputs.fresh) {
    const pending = queueBuild(tenantId).catch((error) => {
      console.error('[work-dashboard] snapshot refresh failed:', error.message);
      return { failed: true };
    });
    if (wait || !inputs.report) {
      const result = await pending;
      inputs = await readInputs(tenantId);
      if (result.failed && !inputs.fresh) {
        if (!inputs.report) throw Object.assign(new Error('The dashboard could not be calculated.'), { statusCode: 503 });
        return { ...inputs.report, snapshotAt: inputs.state.generatedAt, refreshing: false, refreshError: true };
      }
    }
  }
  const { state, report, fresh } = inputs;
  return report ? { ...report, snapshotAt: state.generatedAt, refreshing: !fresh } : { refreshing: true };
}

async function markMongoDashboardDirty(scope) {
  if (scope.tenantType === 'client') return;
  try {
    await collection().updateOne({ _id: String(scope.tenantId) }, { $inc: { revision: 1 } }, { upsert: true });
  } catch (error) {
    console.error('[work-dashboard] snapshot invalidation failed:', error.message);
  }
}

let timer;
function startWorkDashboardSnapshots() {
  if (timer) return;
  const run = () => void withJobLease('work-dashboard-maintenance', maintenanceInterval, async () => {
    const tenantIds = databaseEngine() === 'postgresql'
      ? (await query("SELECT id FROM tenants WHERE type='company' AND features->'workBoard'->>'enabled'='true'")).rows.map(({ id }) => id)
      : (await Tenant.find({ type: 'company', 'features.workBoard.enabled': true }).select('_id').lean()).map(({ _id }) => String(_id));
    for (const tenantId of tenantIds) {
      try {
        if (!(await readInputs(tenantId)).fresh) await queueBuild(tenantId);
      } catch (error) {
        console.error('[work-dashboard] snapshot maintenance failed:', error.message);
      }
    }
  }).catch((error) => console.error('[work-dashboard] maintenance failed:', error.message));
  setTimeout(run, 1000).unref();
  timer = setInterval(run, maintenanceInterval);
  timer.unref();
}

module.exports = { getDashboardSnapshot, markMongoDashboardDirty, startWorkDashboardSnapshots };
