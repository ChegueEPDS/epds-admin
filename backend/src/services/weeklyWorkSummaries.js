const { databaseEngine, query } = require('../postgres');
const Tenant = require('../models/tenant');
const User = require('../models/user');
const { WorkItem } = require('../models/workItem');
const WeeklyWorkSummary = require('../models/weeklyWorkSummary');
const { weeklyPeriod, weeklyJob, hasRecipientEmail } = require('./workStatusNotifications');

async function queuePostgres(period) {
  const { rows: tenants } = await query('SELECT id,name,display_name FROM tenants WHERE weekly_work_summary_since <= $1', [period.to]);
  for (const tenant of tenants) {
    const { rows: admins } = await query(`SELECT email FROM users WHERE role='Admin'
      AND (tenant_id=$1 OR $1=ANY(additional_tenant_ids))`, [tenant.id]);
    if (!admins.length) continue;
    const { rows } = await query(`SELECT payload FROM (
      SELECT DISTINCT ON (work_id) payload, changed_at, id FROM work_status_changes
      WHERE tenant_id=$1 AND changed_at >= $2 AND changed_at < $3
      ORDER BY work_id, changed_at DESC, id DESC
    ) latest ORDER BY changed_at DESC,id DESC`, [tenant.id, period.from, period.to]);
    if (!rows.length) continue;
    for (const admin of admins.filter(hasRecipientEmail)) {
      const { id, payload } = weeklyJob(tenant, admin, period, rows.map((row) => row.payload));
      await query('INSERT INTO accounting_notification_outbox(id,payload) VALUES($1,$2) ON CONFLICT (id) DO NOTHING', [id, payload]);
    }
  }
}

async function queueMongo(period) {
  const tenants = await Tenant.find({ weeklyWorkSummarySince: { $lte: period.to } }).select('name displayName').lean();
  for (const tenant of tenants) {
    const admins = await User.find({ role: 'Admin', $or: [{ tenantId: tenant._id }, { additionalTenantIds: tenant._id }] })
      .select('email').lean();
    if (!admins.length) continue;
    const dates = { $gte: period.from, $lt: period.to };
    const rows = await WorkItem.aggregate([
      { $match: { tenantId: tenant._id, statusHistory: { $elemMatch: { changedAt: dates } } } },
      { $unwind: { path: '$statusHistory', includeArrayIndex: 'position' } },
      { $match: { 'statusHistory.changedAt': dates } },
      { $sort: { 'statusHistory.changedAt': -1, position: -1 } },
      { $group: { _id: '$_id', payload: { $first: '$statusHistory.payload' } } },
      { $sort: { 'payload.changedAt': -1, _id: 1 } }
    ]);
    if (!rows.length) continue;
    for (const admin of admins.filter(hasRecipientEmail)) {
      const { id, payload } = weeklyJob(tenant, admin, period, rows.map((row) => row.payload));
      try {
        await WeeklyWorkSummary.updateOne({ _id: id },
          { $setOnInsert: { payload, nextAttemptAt: new Date(), attempts: 0 } }, { upsert: true });
      } catch (error) {
        if (error.code !== 11000) throw error;
      }
    }
  }
}

let lastCutoff;
async function queueWeeklySummaries() {
  const period = weeklyPeriod();
  if (lastCutoff === +period.to) return;
  await (databaseEngine() === 'postgresql' ? queuePostgres(period) : queueMongo(period));
  lastCutoff = +period.to;
}

module.exports = { queueWeeklySummaries };
