const crypto = require('crypto');
const mongoose = require('mongoose');
const IntegrationRequest = require('../models/integrationRequest');
const LicenseCustomer = require('../models/licenseCustomer');
const LicenseEvent = require('../models/licenseEvent');
const { replaceLicenseFile } = require('../services/licenseFileService');
const { integrationLicensePayload, presentEvent } = require('../services/licenseIntegrationService');
const { sha256 } = require('../services/integrationSecurityService');
const { expireLicenses } = require('../services/licenseExpiryService');

function parseLimit(input) {
  const value = Number(input || 50);
  return Number.isInteger(value) ? Math.min(100, Math.max(1, value)) : 50;
}

function decodeCursor(input) {
  if (!input) return null;
  try {
    const value = Buffer.from(String(input), 'base64url').toString('utf8');
    return mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : null;
  } catch {
    return null;
  }
}

function encodeCursor(id) {
  return id ? Buffer.from(String(id)).toString('base64url') : null;
}

function decodeLicenseCursor(input) {
  if (!input) return null;
  try {
    const value = JSON.parse(Buffer.from(String(input), 'base64url').toString('utf8'));
    const updatedAt = parseDate(value.updatedAt);
    if (!updatedAt || !mongoose.Types.ObjectId.isValid(value.id)) return null;
    return { updatedAt, id: new mongoose.Types.ObjectId(value.id) };
  } catch {
    return null;
  }
}

function encodeLicenseCursor(license) {
  if (!license) return null;
  return Buffer.from(JSON.stringify({ updatedAt: license.updatedAt, id: String(license._id) })).toString('base64url');
}

function parseDate(input) {
  if (!input) return null;
  const date = new Date(String(input));
  return Number.isNaN(date.getTime()) ? null : date;
}

exports.listLicenses = async (req, res, next) => {
  try {
    await expireLicenses();
    const limit = parseLimit(req.query.limit);
    const cursor = decodeLicenseCursor(req.query.cursor);
    if (req.query.cursor && !cursor) return res.status(400).json({ error: 'Invalid cursor' });
    const updatedAfter = parseDate(req.query.updatedAfter);
    if (req.query.updatedAfter && !updatedAfter) return res.status(400).json({ error: 'Invalid updatedAfter date' });
    const query = {};
    if (cursor) {
      query.$or = [
        { updatedAt: { $gt: cursor.updatedAt } },
        { updatedAt: cursor.updatedAt, _id: { $gt: cursor.id } }
      ];
    } else if (updatedAfter) {
      query.updatedAt = { $gt: updatedAfter };
    }

    const rows = await LicenseCustomer.find(query)
      .sort({ updatedAt: 1, _id: 1 })
      .limit(limit + 1)
      .populate('tenantId', 'name displayName type')
      .lean();
    const hasMore = rows.length > limit;
    const licenses = rows.slice(0, limit);
    return res.json({
      data: licenses.map(integrationLicensePayload),
      nextCursor: hasMore ? encodeLicenseCursor(licenses[licenses.length - 1]) : null,
      hasMore
    });
  } catch (error) {
    return next(error);
  }
};

exports.listEvents = async (req, res, next) => {
  try {
    const limit = parseLimit(req.query.limit);
    const cursor = decodeCursor(req.query.cursor);
    if (req.query.cursor && !cursor) return res.status(400).json({ error: 'Invalid cursor' });
    const occurredAfter = parseDate(req.query.occurredAfter);
    if (req.query.occurredAfter && !occurredAfter) return res.status(400).json({ error: 'Invalid occurredAfter date' });
    const query = { eventType: 'license.ordered' };
    if (cursor) query._id = { $gt: cursor };
    if (occurredAfter) query.occurredAt = { $gt: occurredAfter };

    const rows = await LicenseEvent.find(query).sort({ _id: 1 }).limit(limit + 1).lean();
    const hasMore = rows.length > limit;
    const events = rows.slice(0, limit);
    return res.json({
      data: events.map(presentEvent),
      nextCursor: hasMore ? encodeCursor(events[events.length - 1]._id) : null,
      hasMore
    });
  } catch (error) {
    return next(error);
  }
};

exports.uploadLicenseFile = async (req, res, next) => {
  const idempotencyKey = String(req.get('idempotency-key') || '').trim();
  let requestRecord;
  try {
    if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 200) {
      return res.status(400).json({ error: 'Idempotency-Key must contain 16 to 200 characters' });
    }
    if (!req.file) return res.status(400).json({ error: 'No file provided' });
    const keyHash = sha256(idempotencyKey);
    const fingerprint = crypto.createHash('sha256')
      .update(String(req.params.id))
      .update(req.file.originalname || '')
      .update(req.file.buffer)
      .digest('hex');

    try {
      requestRecord = await IntegrationRequest.create({
        clientId: req.integrationClientId,
        idempotencyKey: keyHash,
        requestFingerprint: fingerprint,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      });
    } catch (error) {
      if (error?.code !== 11000) throw error;
      const existing = await IntegrationRequest.findOne({ clientId: req.integrationClientId, idempotencyKey: keyHash });
      if (!existing || existing.requestFingerprint !== fingerprint) {
        return res.status(409).json({ error: 'Idempotency-Key was already used for a different request' });
      }
      if (existing.status === 'completed') return res.status(existing.responseStatus).json(existing.responseBody);

      const completedLicense = await LicenseCustomer.findOne({
        _id: req.params.id,
        'licenseFile.integrationClientId': req.integrationClientId,
        'licenseFile.idempotencyKeyHash': keyHash
      }).select('+licenseFile.idempotencyKeyHash').populate('tenantId', 'name displayName type');
      if (completedLicense) {
        const responseBody = { data: integrationLicensePayload(completedLicense) };
        existing.status = 'completed';
        existing.responseStatus = 200;
        existing.responseBody = responseBody;
        await existing.save();
        return res.json(responseBody);
      }
      res.setHeader('Retry-After', '5');
      return res.status(409).json({ error: 'Request with this Idempotency-Key is still processing' });
    }

    const license = await LicenseCustomer.findById(req.params.id);
    if (!license) {
      await requestRecord.deleteOne();
      return res.status(404).json({ error: 'License not found' });
    }
    await replaceLicenseFile(license, req.file, {
      name: req.integrationClient.name,
      integrationClientId: req.integrationClientId,
      idempotencyKeyHash: keyHash
    });
    await license.populate('tenantId', 'name displayName type');
    const responseBody = { data: integrationLicensePayload(license) };
    requestRecord.status = 'completed';
    requestRecord.responseStatus = 200;
    requestRecord.responseBody = responseBody;
    await requestRecord.save();
    return res.json(responseBody);
  } catch (error) {
    if (requestRecord?._id && requestRecord.status !== 'completed') {
      await IntegrationRequest.deleteOne({ _id: requestRecord._id }).catch(() => {});
    }
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    return next(error);
  }
};
