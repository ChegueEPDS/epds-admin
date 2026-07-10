const LicenseCustomer = require('../models/licenseCustomer');

let timer = null;

function todayUtcStart() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

async function expireLicenses() {
  return LicenseCustomer.updateMany(
    { status: 'active', expiresAt: { $lt: todayUtcStart() } },
    { $set: { status: 'expired' }, $inc: { statusVersion: 1 } }
  );
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
