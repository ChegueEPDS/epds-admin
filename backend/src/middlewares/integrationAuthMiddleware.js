const crypto = require('crypto');
const IntegrationClient = require('../models/integrationClient');
const { databaseEngine } = require('../postgres');
const integrationRepository = require('../repositories/postgres/integrationRepository');
const { apiKeyPrefix, sha256 } = require('../services/integrationSecurityService');

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function requireIntegrationAuth(req, res, next) {
  try {
    const authorization = String(req.get('authorization') || '');
    const apiKey = String(req.get('x-api-key') || (authorization.startsWith('Bearer ') ? authorization.slice(7) : '')).trim();
    const prefix = apiKeyPrefix(apiKey);
    if (!prefix) return res.status(401).json({ error: 'Valid API key is required' });

    const client = databaseEngine() === 'postgresql'
      ? await integrationRepository.findClientByPrefix(prefix)
      : await IntegrationClient.findOne({ keyPrefix: prefix, status: 'active' }).select('+keyHash');
    if (!client || client.status !== 'active' || !safeEqual(client.keyHash, sha256(apiKey))) {
      return res.status(401).json({ error: 'Valid API key is required' });
    }
    req.integrationClient = client;
    req.integrationClientId = client._id;
    if (databaseEngine() === 'postgresql') {
      client.lastUsedAt = new Date();
      integrationRepository.saveClient(client).catch(() => {});
    } else IntegrationClient.updateOne({ _id: client._id }, { $set: { lastUsedAt: new Date() } }).catch(() => {});
    return next();
  } catch (error) {
    return next(error);
  }
}

function requireIntegrationScope(scope) {
  return (req, res, next) => {
    if (!req.integrationClient?.scopes?.includes(scope)) {
      return res.status(403).json({ error: `Missing integration scope: ${scope}` });
    }
    return next();
  };
}

module.exports = { requireIntegrationAuth, requireIntegrationScope };
