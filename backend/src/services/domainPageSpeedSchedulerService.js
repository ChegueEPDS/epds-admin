const DomainMonitor = require('../models/domainMonitor');
const DomainPageSpeedScan = require('../models/domainPageSpeedScan');
const { storeDomainPageSpeedScan } = require('./pageSpeedService');
const { mapWithConcurrency, withJobLease } = require('./scheduledJobLeaseService');

const configuredDailyRuns = Number(process.env.PAGESPEED_DAILY_RUNS || 1);
const DAILY_RUNS = Number.isFinite(configuredDailyRuns) ? Math.max(1, Math.min(configuredDailyRuns, 2)) : 1;
const RUN_INTERVAL_MS = Math.floor((24 * 60 * 60 * 1000) / DAILY_RUNS);
const SCHEDULER_TICK_MS = 60 * 60 * 1000;

let schedulerTimer;
let isRunning = false;

async function shouldRunDomain(domainId) {
  const latest = await DomainPageSpeedScan.findOne({ domainId }).sort({ checkedAt: -1 }).select('checkedAt').lean();
  if (!latest?.checkedAt) return true;
  return Date.now() - new Date(latest.checkedAt).getTime() >= RUN_INTERVAL_MS;
}

async function runScheduledPageSpeedScans() {
  if (isRunning) return;
  isRunning = true;
  try {
    await withJobLease('domain-pagespeed-monitor', 12 * 60 * 60 * 1000, async () => {
      const domains = await DomainMonitor.find({ enabled: true }).sort({ name: 1 });
      const concurrency = Math.max(1, Math.min(4, Number(process.env.PAGESPEED_CONCURRENCY || 2)));
      await mapWithConcurrency(domains, concurrency, async (domain) => {
        try {
          if (await shouldRunDomain(domain._id)) await storeDomainPageSpeedScan(domain, 'scheduled');
        } catch (err) { console.error(`[pagespeed-monitor] ${domain.baseUrl} scan failed:`, err.message); }
      });
    });
  } catch (err) {
    console.error('[pagespeed-monitor] scheduled scans failed:', err.message);
  } finally {
    isRunning = false;
    const { rebuildAllSnapshots } = require('./domainStatusReadModelService');
    void rebuildAllSnapshots().catch((err) => console.error('[domain-status] post-pagespeed rebuild failed:', err.message));
  }
}

function startDomainPageSpeedScheduler() {
  if (schedulerTimer) return;
  const delay = Number(process.env.PAGESPEED_INITIAL_DELAY_MS || 60000);
  setTimeout(runScheduledPageSpeedScans, delay).unref?.();
  schedulerTimer = setInterval(runScheduledPageSpeedScans, SCHEDULER_TICK_MS);
  schedulerTimer.unref?.();
  console.log(`[pagespeed-monitor] scheduled ${DAILY_RUNS} time(s) per day`);
}

module.exports = {
  runScheduledPageSpeedScans,
  startDomainPageSpeedScheduler
};
