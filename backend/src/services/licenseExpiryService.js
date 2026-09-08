const LicenseCustomer = require('../models/licenseCustomer');
const { withJobLease } = require('./scheduledJobLeaseService');

let timer = null;

function todayUtcStart() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

async function expireLicenses() {
  const result = await withJobLease('license-expiry', 55 * 60 * 1000, () => LicenseCustomer.updateMany(
    { status: 'active', expiresAt: { $lt: todayUtcStart() } },
    { $set: { status: 'expired' }, $inc: { statusVersion: 1 } }
  ));
  return result.value;
}

function startLicenseExpiryScheduler() {
  if (timer) return;
  const intervalMs = Math.max(60_000, Number(process.env.LICENSE_EXPIRY_INTERVAL_MS || 60 * 60 * 1000));
  expireLicenses().catch((error) => console.error('[license-expiry] initial run failed:', error));
  timer = setInterval(() => {
    expireLicenses().catch((error) => console.error('[license-expiry] run failed:', error));
  }, intervalMs);
  timer.unref?.();
  console.log(`[license-expiry] started with ${intervalMs}ms interval`);
}

module.exports = { expireLicenses, startLicenseExpiryScheduler, todayUtcStart };
