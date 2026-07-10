const WebhookTestReceipt = require('../models/webhookTestReceipt');
const { sha256 } = require('../services/integrationSecurityService');

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_RECEIPTS = 100;
const REDACTED_HEADERS = new Set(['authorization', 'cookie', 'proxy-authorization', 'set-cookie']);

function tokenHash(token) {
  const normalized = String(token || '').trim();
  return TOKEN_PATTERN.test(normalized) ? sha256(normalized) : '';
}

function safeHeaders(headers = {}) {
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => [
    name.toLowerCase(),
    REDACTED_HEADERS.has(name.toLowerCase()) ? '[redacted]' : String(value ?? '')
  ]));
}

function parseJson(rawBody, contentType) {
  if (!String(contentType || '').toLowerCase().includes('json') || !rawBody) return null;
  try { return JSON.parse(rawBody); } catch { return null; }
}

function requireToken(req, res) {
  const hash = tokenHash(req.params.token);
  if (!hash) {
    res.status(400).json({ error: 'Invalid webhook test inbox token' });
    return '';
  }
  return hash;
}

async function receive(req, res) {
  try {
    const inboxTokenHash = requireToken(req, res);
    if (!inboxTokenHash) return;
    const bodyBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    const rawBody = bodyBuffer.toString('utf8');
    const receipt = await WebhookTestReceipt.create({
      inboxTokenHash,
      method: req.method,
      path: req.originalUrl,
      headers: safeHeaders(req.headers),
      rawBody,
      parsedBody: parseJson(rawBody, req.headers['content-type']),
      byteLength: bodyBuffer.length,
      receivedAt: new Date(),
      expiresAt: new Date(Date.now() + RETENTION_MS)
    });

    const overflow = await WebhookTestReceipt.find({ inboxTokenHash })
      .sort({ receivedAt: -1, _id: -1 })
      .skip(MAX_RECEIPTS)
      .select('_id')
      .lean();
    if (overflow.length) {
      await WebhookTestReceipt.deleteMany({ _id: { $in: overflow.map((item) => item._id) } });
    }

    return res.status(202).json({ received: true, id: String(receipt._id) });
  } catch (error) {
    console.error('[webhook-test] receive failed:', error);
    return res.status(500).json({ error: 'Could not store webhook test request' });
  }
}

async function list(req, res) {
  try {
    const inboxTokenHash = requireToken(req, res);
    if (!inboxTokenHash) return;
    const receipts = await WebhookTestReceipt.find({ inboxTokenHash })
      .sort({ receivedAt: -1, _id: -1 })
      .limit(MAX_RECEIPTS)
      .lean();
    return res.json({ data: receipts.map(({ inboxTokenHash: ignored, ...receipt }) => receipt) });
  } catch (error) {
    console.error('[webhook-test] list failed:', error);
    return res.status(500).json({ error: 'Could not load webhook test requests' });
  }
}

async function clear(req, res) {
  try {
    const inboxTokenHash = requireToken(req, res);
    if (!inboxTokenHash) return;
    const result = await WebhookTestReceipt.deleteMany({ inboxTokenHash });
    return res.json({ deletedCount: result.deletedCount || 0 });
  } catch (error) {
    console.error('[webhook-test] clear failed:', error);
    return res.status(500).json({ error: 'Could not clear webhook test requests' });
  }
}

module.exports = { clear, list, parseJson, receive, safeHeaders, tokenHash };
