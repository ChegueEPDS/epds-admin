const crypto = require('crypto');
const IntegrationClient = require('../models/integrationClient');
const LicenseEvent = require('../models/licenseEvent');
const WebhookDelivery = require('../models/webhookDelivery');

function integrationLicensePayload(license) {
  const tenant = license.tenantId && typeof license.tenantId === 'object' ? license.tenantId : null;
  const objectLimit = license.objectLimitOption === 'unlimited'
    ? 'unlimited'
    : Number(license.objectLimitOption === 'custom' ? license.customObjectLimit : license.objectLimitOption);
  return {
    id: String(license._id),
    customerName: license.customerName,
    description: license.description || '',
    status: license.status,
    objectLimit: objectLimit === 'unlimited' || Number.isFinite(objectLimit) ? objectLimit : null,
    expiresAt: license.expiresAt,
    mobileApp: Boolean(license.mobileApp),
    mobileAppVersion: license.mobileAppVersion || '',
    tenantId: tenant?._id ? String(tenant._id) : (license.tenantId ? String(license.tenantId) : null),
    tenantName: tenant?.name || null,
    tenantDisplayName: tenant?.displayName || tenant?.name || null,
    licenseFile: license.licenseFile?.blobPath ? {
      fileName: license.licenseFile.fileName,
      contentType: license.licenseFile.contentType,
      size: license.licenseFile.size,
      uploadedAt: license.licenseFile.uploadedAt || null
    } : null,
    mobileAppFile: license.mobileAppFile?.blobPath ? {
      fileName: license.mobileAppFile.fileName,
      contentType: license.mobileAppFile.contentType,
      size: license.mobileAppFile.size,
      uploadedAt: license.mobileAppFile.uploadedAt || null
    } : null,
    updatedAt: license.updatedAt
  };
}

function presentEvent(event) {
  return {
    id: event.eventId,
    type: event.eventType,
    occurredAt: event.occurredAt,
    data: {
      previousStatus: event.previousStatus,
      status: event.status,
      license: event.payload
    }
  };
}

async function ensureDeliveries(event) {
  const clients = await IntegrationClient.find({
    status: 'active',
    webhookEnabled: true,
    webhookUrl: { $ne: '' },
    createdAt: { $lte: event.occurredAt }
  })
    .select('_id')
    .lean();
  if (!clients.length) {
    await LicenseEvent.updateOne({ _id: event._id }, { $set: { deliveriesEnsuredAt: new Date() } });
    return;
  }
  await WebhookDelivery.bulkWrite(clients.map((client) => ({
    updateOne: {
      filter: { eventId: event._id, clientId: client._id },
      update: { $setOnInsert: { status: 'pending', nextAttemptAt: new Date() } },
      upsert: true
    }
  })), { ordered: false });
  await LicenseEvent.updateOne({ _id: event._id }, { $set: { deliveriesEnsuredAt: new Date() } });
}

async function publishOrderedEvent(license, previousStatus, actor = { type: 'system' }) {
  if (license.status !== 'ordered') return null;
  const statusVersion = Number(license.statusVersion || 1);
  if (Number(license.integrationEventVersion || 0) >= statusVersion) return null;
  const eventPreviousStatus = license.orderedFromStatus || previousStatus || 'unknown';
  const eventId = crypto.randomUUID();
  let event;
  try {
    event = await LicenseEvent.create({
      eventId,
      eventType: 'license.ordered',
      licenseId: license._id,
      statusVersion,
      previousStatus: eventPreviousStatus,
      status: 'ordered',
      payload: integrationLicensePayload(license),
      actor
    });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    event = await LicenseEvent.findOne({ licenseId: license._id, statusVersion });
  }
  await ensureDeliveries(event);
  await license.constructor.updateOne(
    {
      _id: license._id,
      $or: [
        { integrationEventVersion: { $lt: statusVersion } },
        { integrationEventVersion: { $exists: false } }
      ]
    },
    { $set: { integrationEventVersion: statusVersion } }
  );
  license.integrationEventVersion = statusVersion;
  return event;
}

function transitionStatus(license, nextStatus) {
  const previousStatus = license.status;
  if (previousStatus !== nextStatus) {
    license.status = nextStatus;
    license.statusVersion = Number(license.statusVersion || 0) + 1;
    if (nextStatus === 'ordered') license.orderedFromStatus = previousStatus || 'unknown';
  }
  return previousStatus;
}

module.exports = { ensureDeliveries, integrationLicensePayload, presentEvent, publishOrderedEvent, transitionStatus };
