const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function generateApiKey() {
  const prefix = crypto.randomBytes(6).toString('hex');
  const secret = crypto.randomBytes(32).toString('base64url');
  const apiKey = `epds_live_${prefix}_${secret}`;
  return { apiKey, keyPrefix: prefix, keyHash: sha256(apiKey) };
}

function generateWebhookSecret() {
  return `whsec_${crypto.randomBytes(32).toString('base64url')}`;
}

function encryptionKey() {
  const raw = String(process.env.INTEGRATION_SECRET_ENCRYPTION_KEY || '').trim();
  if (!raw) throw new Error('INTEGRATION_SECRET_ENCRYPTION_KEY is not configured');
  const decoded = Buffer.from(raw, 'base64');
  if (decoded.length !== 32) throw new Error('INTEGRATION_SECRET_ENCRYPTION_KEY must be a base64 encoded 32-byte key');
  return decoded;
}

function encryptSecret(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString('base64url')).join('.');
}

function decryptSecret(value) {
  const [ivRaw, tagRaw, encryptedRaw] = String(value || '').split('.');
  if (!ivRaw || !tagRaw || !encryptedRaw) throw new Error('Invalid encrypted integration secret');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivRaw, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, 'base64url')),
    decipher.final()
  ]).toString('utf8');
}

function apiKeyPrefix(apiKey) {
  const match = /^epds_live_([a-f0-9]{12})_[A-Za-z0-9_-]{30,}$/.exec(String(apiKey || '').trim());
  return match?.[1] || '';
}

function isPrivateIp(address) {
  if (net.isIPv4(address)) {
    const parts = address.split('.').map(Number);
    return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127);
  }
  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    return normalized === '::1' || normalized === '::' || normalized.startsWith('fc') ||
      normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') ||
      normalized.startsWith('fea') || normalized.startsWith('feb');
  }
  return true;
}

async function validateWebhookUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  let url;
  try { url = new URL(raw); } catch { throw new Error('Valid webhook URL is required'); }
  if (url.protocol !== 'https:') throw new Error('Webhook URL must use HTTPS');
  if (url.username || url.password || url.port) throw new Error('Webhook URL cannot contain credentials or a custom port');
  if (url.hostname === 'localhost' || url.hostname.endsWith('.local')) throw new Error('Private webhook hosts are not allowed');
  const addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((item) => isPrivateIp(item.address))) {
    throw new Error('Webhook host resolves to a private or invalid address');
  }
  return url.toString();
}

function signWebhook(secret, timestamp, body) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

module.exports = {
  apiKeyPrefix,
  decryptSecret,
  encryptSecret,
  generateApiKey,
  generateWebhookSecret,
  sha256,
  signWebhook,
  validateWebhookUrl
};
