const DomainMonitor = require('../models/domainMonitor');
const DomainPageSpeedScan = require('../models/domainPageSpeedScan');
const { storeDomainPageSpeedScan } = require('./pageSpeedService');

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
    const domains = await DomainMonitor.find({ enabled: true }).sort({ name: 1 });
    for (const domain of domains) {
      try {
        if (!(await shouldRunDomain(domain._id))) continue;
        await storeDomainPageSpeedScan(domain, 'scheduled');
      } catch (err) {
        console.error(`[pagespeed-monitor] ${domain.baseUrl} scan failed:`, err.message);
      }
    }
  } catch (err) {
    console.error('[pagespeed-monitor] scheduled scans failed:', err.message);
  } finally {
    isRunning = false;
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
