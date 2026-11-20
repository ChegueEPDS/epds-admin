const { databaseEngine, query } = require('../postgres');
const { WorkItem } = require('../models/workItem');
const WeeklyWorkSummary = require('../models/weeklyWorkSummary');
const { queueWeeklySummaries } = require('./weeklyWorkSummaries');
const { accountingMail, workStatusMail, weeklyWorkMail } = require('./mailTemplates');
const mail = require('./mailService');

const leaseMs = 5 * 60_000;
const nextAttempt = (attempts) => Date.now() + Math.min(leaseMs * 2 ** Math.min(attempts - 1, 10), 86_400_000);

async function claimPostgres() {
  const { rows: [job] } = await query(`WITH pending AS (
    SELECT id FROM accounting_notification_outbox WHERE sent_at IS NULL AND next_attempt_at <= now()
    ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT 1
  )
  UPDATE accounting_notification_outbox AS event SET attempts=event.attempts+1, next_attempt_at=now()+interval '5 minutes'
  FROM pending WHERE event.id=pending.id RETURNING event.*`);
  if (!job) return null;
  return {
    ...job,
    complete: () => query('UPDATE accounting_notification_outbox SET sent_at=now() WHERE id=$1 AND attempts=$2', [job.id, job.attempts]),
    retry: () => query('UPDATE accounting_notification_outbox SET next_attempt_at=$3 WHERE id=$1 AND attempts=$2',
      [job.id, job.attempts, new Date(nextAttempt(job.attempts))])
  };
}

async function claimMongo() {
  const now = new Date();
  const due = { nextAttemptAt: { $lte: now } };
  const work = await WorkItem.findOneAndUpdate({ accountingOutbox: { $elemMatch: due } }, {
    $inc: { 'accountingOutbox.$.attempts': 1 },
    $set: { 'accountingOutbox.$.nextAttemptAt': new Date(now.getTime() + leaseMs) }
  }, { returnDocument: 'before', timestamps: false })
    .select('accountingOutbox').lean();
  const event = work?.accountingOutbox?.find(({ nextAttemptAt }) => nextAttemptAt <= now);
  if (!event) return null;
  const job = { ...event, attempts: event.attempts + 1 };
  const identity = { id: job.id, attempts: job.attempts };
  const filter = { _id: work._id, accountingOutbox: { $elemMatch: identity } };
  return {
    ...job,
    complete: () => WorkItem.updateOne(filter, { $pull: { accountingOutbox: identity } }, { timestamps: false }),
    retry: () => WorkItem.updateOne(filter, {
      $set: { 'accountingOutbox.$.nextAttemptAt': new Date(nextAttempt(job.attempts)) }
    }, { timestamps: false })
  };
}

async function claimMongoWeekly() {
  const now = new Date();
  const job = await WeeklyWorkSummary.findOneAndUpdate({ sentAt: null, nextAttemptAt: { $lte: now } }, {
    $inc: { attempts: 1 }, $set: { nextAttemptAt: new Date(now.getTime() + leaseMs) }
  }, { returnDocument: 'after' }).lean();
  if (!job) return null;
  const filter = { _id: job._id, attempts: job.attempts };
  return {
    ...job, id: job._id,
    complete: () => WeeklyWorkSummary.updateOne(filter, { $set: { sentAt: new Date() }, $unset: { payload: 1 } }),
    retry: () => WeeklyWorkSummary.updateOne(filter, { $set: { nextAttemptAt: new Date(nextAttempt(job.attempts)) } })
  };
}

function workUrl({ tenantId, workId }) {
  const origin = process.env.EPDS_ADMIN_PUBLIC_URL || process.env.MFA_WEBAUTHN_ORIGIN ||
    process.env.CORS_ALLOWED_ORIGINS?.split(',')[0]?.trim();
  const url = new URL(`/project-tracker/open/${encodeURIComponent(tenantId)}`, origin);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
    throw new Error('Invalid public application URL');
  }
  url.searchParams.set('work', workId);
  return url.toString();
}

async function runAccountingNotifications() {
  const claim = databaseEngine() === 'postgresql' ? claimPostgres : async () => await claimMongoWeekly() || claimMongo();
  for (let index = 0; index < 20; index++) {
    const job = await claim();
    if (!job) return;
    if (job.payload.type === 'work-weekly' && !job.payload.changes.length) {
      await job.complete();
      continue;
    }
    try {
      const { payload } = job;
      const message = payload.type === 'work-weekly' ? weeklyWorkMail(payload, workUrl)
        : payload.type === 'work-status' ? workStatusMail(payload, workUrl(payload))
        : accountingMail(payload, workUrl(payload));
      await mail.sendMail({ ...message, to: job.payload.to });
    } catch (error) {
      await job.retry();
      console.error('[accounting-notifications] Send failed', { id: job.id, attempts: job.attempts, code: error.code, status: error.statusCode });
      continue;
    }
    await job.complete();
    console.info('[accounting-notifications] Sent', { id: job.id, workId: job.payload.workId });
  }
}

function startAccountingNotifications() {
  async function poll() {
    try {
      await queueWeeklySummaries().catch((error) => {
        console.error('[work-weekly-summary] Queueing failed', { code: error.code, name: error.name });
      });
      await runAccountingNotifications();
    } catch (error) {
      console.error('[accounting-notifications] Worker failed', { code: error.code, name: error.name });
    } finally {
      setTimeout(poll, 10_000).unref();
    }
  }
  setTimeout(poll, 1000).unref();
}

module.exports = { startAccountingNotifications };
