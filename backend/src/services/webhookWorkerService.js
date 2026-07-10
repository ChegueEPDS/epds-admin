const IntegrationClient = require('../models/integrationClient');
const LicenseEvent = require('../models/licenseEvent');
const WebhookDelivery = require('../models/webhookDelivery');
const LicenseCustomer = require('../models/licenseCustomer');
const { decryptSecret, signWebhook, validateWebhookUrl } = require('./integrationSecurityService');
const { ensureDeliveries, presentEvent, publishOrderedEvent } = require('./licenseIntegrationService');

const MAX_ATTEMPTS = 10;
let workerTimer = null;
let workerRunning = false;

function retryDelayMs(attemptCount) {
  return Math.min(6 * 60 * 60 * 1000, 30_000 * (2 ** Math.max(0, attemptCount - 1)));
}

async function claimDelivery() {
  const now = new Date();
  await WebhookDelivery.updateMany(
    { status: 'processing', lockedUntil: { $lt: now } },
    { $set: { status: 'pending', nextAttemptAt: now }, $unset: { lockedUntil: 1 } }
  );
  return WebhookDelivery.findOneAndUpdate(
    { status: 'pending', nextAttemptAt: { $lte: now } },
    { $set: { status: 'processing', lockedUntil: new Date(Date.now() + 60_000), lastAttemptAt: now } },
    { new: true, sort: { nextAttemptAt: 1 } }
  );
}

async function deliver(delivery) {
  const [client, event] = await Promise.all([
    IntegrationClient.findOne({ _id: delivery.clientId, status: 'active', webhookEnabled: true })
      .select('+webhookSecretEncrypted'),
    LicenseEvent.findById(delivery.eventId)
  ]);
  if (!client || !event || !client.webhookUrl) {
    delivery.status = 'dead';
    delivery.lastError = 'Integration client or event is unavailable';
    await delivery.save();
    return;
  }

  const body = JSON.stringify(presentEvent(event));
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const secret = decryptSecret(client.webhookSecretEncrypted);
  const signature = signWebhook(secret, timestamp, body);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let statusCode;
  let errorMessage = '';
  try {
    const webhookUrl = await validateWebhookUrl(client.webhookUrl);
    const response = await fetch(webhookUrl, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'user-agent': 'EPDS-Admin-Webhooks/1.0',
        'x-epds-event-id': event.eventId,
        'x-epds-timestamp': timestamp,
        'x-epds-signature': `v1=${signature}`
      },
      body
    });
    statusCode = response.status;
    delivery.attemptCount += 1;
    if (response.ok) {
      delivery.status = 'delivered';
      delivery.deliveredAt = new Date();
      delivery.lastStatusCode = response.status;
      delivery.lastError = '';
      delivery.lockedUntil = undefined;
      await delivery.save();
      await IntegrationClient.updateOne({ _id: client._id }, { $set: { lastWebhookSuccessAt: new Date() } });
      return;
    }
    errorMessage = `Webhook returned HTTP ${response.status}`;
  } catch (error) {
    delivery.attemptCount += 1;
    errorMessage = error?.name === 'AbortError' ? 'Webhook request timed out' : String(error?.message || error);
  } finally {
    clearTimeout(timeout);
  }

  delivery.lastStatusCode = statusCode;
  delivery.lastError = errorMessage.slice(0, 1000);
  delivery.lockedUntil = undefined;
  if (delivery.attemptCount >= MAX_ATTEMPTS) {
    delivery.status = 'dead';
  } else {
    delivery.status = 'pending';
    delivery.nextAttemptAt = new Date(Date.now() + retryDelayMs(delivery.attemptCount));
  }
  await delivery.save();
}

async function reconcileDeliveries() {
  const unpublished = await LicenseCustomer.find({
    status: 'ordered',
    $or: [
      { integrationEventVersion: { $exists: false } },
      { $expr: { $gt: ['$statusVersion', '$integrationEventVersion'] } }
    ]
  }).limit(250);
  for (const license of unpublished) {
    await publishOrderedEvent(license, license.orderedFromStatus, { type: 'system', name: 'Outbox reconciler' });
  }
  const recentEvents = await LicenseEvent.find({ occurredAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } })
    .sort({ occurredAt: -1 })
    .limit(1000);
  for (const event of recentEvents) await ensureDeliveries(event);
}

async function runWebhookWorker() {
  if (workerRunning) return;
  workerRunning = true;
  try {
    await reconcileDeliveries();
    for (let processed = 0; processed < 25; processed += 1) {
      const delivery = await claimDelivery();
      if (!delivery) break;
      await deliver(delivery);
    }
  } catch (error) {
    console.error('[webhook-worker] run failed:', error);
  } finally {
    workerRunning = false;
  }
}

function startWebhookWorker() {
  if (workerTimer || String(process.env.WEBHOOK_WORKER_ENABLED || 'true').toLowerCase() === 'false') return;
  const intervalMs = Math.max(5000, Number(process.env.WEBHOOK_WORKER_INTERVAL_MS || 15000));
  setTimeout(runWebhookWorker, 2000);
  workerTimer = setInterval(runWebhookWorker, intervalMs);
  workerTimer.unref?.();
  console.log(`[webhook-worker] started with ${intervalMs}ms interval`);
}

module.exports = { retryDelayMs, runWebhookWorker, startWebhookWorker };
