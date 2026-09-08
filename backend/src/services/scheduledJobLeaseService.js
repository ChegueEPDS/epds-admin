const crypto = require('crypto');
const ScheduledJobLease = require('../models/scheduledJobLease');

async function withJobLease(name, ttlMs, work, options = {}) {
  const now = new Date();
  const holder = `${process.pid}:${crypto.randomUUID()}`;
  try {
    const lease = await ScheduledJobLease.findOneAndUpdate(
      { name, $or: [{ lockedUntil: { $lte: now } }, { lockedUntil: { $exists: false } }] },
      { $set: { holder, lockedUntil: new Date(now.getTime() + ttlMs) } },
      { upsert: true, new: true }
    ).lean();
    if (!lease || lease.holder !== holder) return { acquired: false };
  } catch (error) {
    if (error.code === 11000) return { acquired: false };
    throw error;
  }
  let succeeded = false;
  try {
    const value = await work();
    succeeded = true;
    return { acquired: true, value };
  } finally {
    if (!(succeeded && options.holdOnSuccess)) {
      await ScheduledJobLease.updateOne(
        { name, holder },
        { $set: { lockedUntil: new Date(0) } }
      ).catch((error) => console.error(`[scheduler] failed to release ${name}:`, error.message));
    }
  }
}

async function mapWithConcurrency(items, concurrency, worker) {
  const queue = [...items];
  const requested = Number(concurrency);
  const safeConcurrency = Number.isFinite(requested) ? Math.max(1, Math.floor(requested)) : 1;
  const runners = Array.from({ length: Math.min(safeConcurrency, queue.length) }, async () => {
    while (queue.length) await worker(queue.shift());
  });
  await Promise.all(runners);
}

module.exports = { mapWithConcurrency, withJobLease };
