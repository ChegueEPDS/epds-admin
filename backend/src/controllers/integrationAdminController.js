const IntegrationClient = require('../models/integrationClient');
const WebhookDelivery = require('../models/webhookDelivery');
const {
  encryptSecret,
  generateApiKey,
  generateWebhookSecret,
  validateWebhookUrl
} = require('../services/integrationSecurityService');

function presentClient(client, deliveryCounts = {}) {
  return {
    id: String(client._id),
    name: client.name,
    keyPrefix: client.keyPrefix,
    status: client.status,
    scopes: client.scopes || [],
    webhookUrl: client.webhookUrl || '',
    webhookEnabled: Boolean(client.webhookEnabled),
    lastUsedAt: client.lastUsedAt || null,
    lastWebhookSuccessAt: client.lastWebhookSuccessAt || null,
    revokedAt: client.revokedAt || null,
    deliveryCounts: {
      pending: deliveryCounts.pending || 0,
      delivered: deliveryCounts.delivered || 0,
      dead: deliveryCounts.dead || 0
    },
    lastDeliveryError: deliveryCounts.lastDeliveryError || '',
    lastDeliveryErrorAt: deliveryCounts.lastDeliveryErrorAt || null,
    createdAt: client.createdAt,
    updatedAt: client.updatedAt
  };
}

async function deliveryCountMap(clientIds) {
  const [rows, failures] = await Promise.all([
    WebhookDelivery.aggregate([
      { $match: { clientId: { $in: clientIds } } },
      { $group: { _id: { clientId: '$clientId', status: '$status' }, count: { $sum: 1 } } }
    ]),
    WebhookDelivery.find({ clientId: { $in: clientIds }, lastError: { $ne: '' } })
      .sort({ lastAttemptAt: -1 })
      .select('clientId lastError lastAttemptAt')
      .lean()
  ]);
  const result = new Map();
  for (const row of rows) {
    const clientId = String(row._id.clientId);
    const counts = result.get(clientId) || {};
    counts[row._id.status === 'processing' ? 'pending' : row._id.status] =
      (counts[row._id.status === 'processing' ? 'pending' : row._id.status] || 0) + row.count;
    result.set(clientId, counts);
  }
  for (const failure of failures) {
    const clientId = String(failure.clientId);
    const counts = result.get(clientId) || {};
    if (!counts.lastDeliveryError) {
      counts.lastDeliveryError = failure.lastError;
      counts.lastDeliveryErrorAt = failure.lastAttemptAt || null;
      result.set(clientId, counts);
    }
  }
  return result;
}

exports.listClients = async (req, res, next) => {
  try {
    const clients = await IntegrationClient.find().sort({ createdAt: -1 }).lean();
    const counts = await deliveryCountMap(clients.map((client) => client._id));
    return res.json({ clients: clients.map((client) => presentClient(client, counts.get(String(client._id)))) });
  } catch (error) {
    return next(error);
  }
};

exports.createClient = async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Integration name is required' });
    const webhookUrl = await validateWebhookUrl(req.body?.webhookUrl);
    const webhookEnabled = req.body?.webhookEnabled === true;
    if (webhookEnabled && !webhookUrl) return res.status(400).json({ error: 'Webhook URL is required when webhook is enabled' });

    const credentials = generateApiKey();
    const webhookSecret = generateWebhookSecret();
    const client = await IntegrationClient.create({
      name,
      keyPrefix: credentials.keyPrefix,
      keyHash: credentials.keyHash,
      webhookUrl,
      webhookEnabled,
      webhookSecretEncrypted: encryptSecret(webhookSecret),
      createdBy: req.userId,
      updatedBy: req.userId
    });
    return res.status(201).json({
      client: presentClient(client),
      credentials: { apiKey: credentials.apiKey, webhookSecret }
    });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ error: 'Integration key collision; retry creation' });
    if (/webhook|INTEGRATION_SECRET/i.test(error.message)) return res.status(400).json({ error: error.message });
    return next(error);
  }
};

exports.updateClient = async (req, res, next) => {
  try {
    const client = await IntegrationClient.findById(req.params.id);
    if (!client) return res.status(404).json({ error: 'Integration client not found' });
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Integration name is required' });
    const webhookUrl = await validateWebhookUrl(req.body?.webhookUrl);
    const webhookEnabled = req.body?.webhookEnabled === true;
    if (webhookEnabled && !webhookUrl) return res.status(400).json({ error: 'Webhook URL is required when webhook is enabled' });
    client.name = name;
    client.webhookUrl = webhookUrl;
    client.webhookEnabled = webhookEnabled;
    client.updatedBy = req.userId;
    await client.save();
    return res.json({ client: presentClient(client) });
  } catch (error) {
    if (/webhook/i.test(error.message)) return res.status(400).json({ error: error.message });
    return next(error);
  }
};

exports.rotateApiKey = async (req, res, next) => {
  try {
    const client = await IntegrationClient.findById(req.params.id).select('+keyHash');
    if (!client) return res.status(404).json({ error: 'Integration client not found' });
    if (client.status !== 'active') return res.status(409).json({ error: 'Revoked integration cannot be rotated' });
    const credentials = generateApiKey();
    client.keyPrefix = credentials.keyPrefix;
    client.keyHash = credentials.keyHash;
    client.updatedBy = req.userId;
    await client.save();
    return res.json({ client: presentClient(client), credentials: { apiKey: credentials.apiKey } });
  } catch (error) {
    return next(error);
  }
};

exports.rotateWebhookSecret = async (req, res, next) => {
  try {
    const client = await IntegrationClient.findById(req.params.id).select('+webhookSecretEncrypted');
    if (!client) return res.status(404).json({ error: 'Integration client not found' });
    if (client.status !== 'active') return res.status(409).json({ error: 'Revoked integration cannot be rotated' });
    const webhookSecret = generateWebhookSecret();
    client.webhookSecretEncrypted = encryptSecret(webhookSecret);
    client.updatedBy = req.userId;
    await client.save();
    return res.json({ client: presentClient(client), credentials: { webhookSecret } });
  } catch (error) {
    if (/INTEGRATION_SECRET/i.test(error.message)) return res.status(400).json({ error: error.message });
    return next(error);
  }
};

exports.revokeClient = async (req, res, next) => {
  try {
    const client = await IntegrationClient.findById(req.params.id);
    if (!client) return res.status(404).json({ error: 'Integration client not found' });
    client.status = 'revoked';
    client.webhookEnabled = false;
    client.revokedAt = new Date();
    client.updatedBy = req.userId;
    await client.save();
    await WebhookDelivery.updateMany(
      { clientId: client._id, status: { $in: ['pending', 'processing'] } },
      { $set: { status: 'dead', lastError: 'Integration client revoked' }, $unset: { lockedUntil: 1 } }
    );
    return res.json({ client: presentClient(client) });
  } catch (error) {
    return next(error);
  }
};

exports.retryFailedDeliveries = async (req, res, next) => {
  try {
    const client = await IntegrationClient.findOne({ _id: req.params.id, status: 'active' });
    if (!client) return res.status(404).json({ error: 'Active integration client not found' });
    const result = await WebhookDelivery.updateMany(
      { clientId: client._id, status: 'dead' },
      { $set: { status: 'pending', attemptCount: 0, nextAttemptAt: new Date(), lastError: '' }, $unset: { lockedUntil: 1 } }
    );
    return res.json({ retried: result.modifiedCount || 0 });
  } catch (error) {
    return next(error);
  }
};
