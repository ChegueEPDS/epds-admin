const assert = require('node:assert/strict');
const test = require('node:test');

process.env.INTEGRATION_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

const {
  apiKeyPrefix,
  decryptSecret,
  encryptSecret,
  generateApiKey,
  signWebhook
} = require('../src/services/integrationSecurityService');
const { validateLicenseFile, validateMobileAppFile } = require('../src/services/licenseFileService');
const { integrationLicensePayload, transitionStatus } = require('../src/services/licenseIntegrationService');
const { retryDelayMs } = require('../src/services/webhookWorkerService');
const { parseJson, safeHeaders, tokenHash } = require('../src/controllers/webhookTestController');

test('generated API keys expose only a lookup prefix and match their hash', () => {
  const generated = generateApiKey();
  assert.equal(apiKeyPrefix(generated.apiKey), generated.keyPrefix);
  assert.match(generated.apiKey, /^epds_live_[a-f0-9]{12}_[A-Za-z0-9_-]+$/);
  assert.equal(generated.keyHash.length, 64);
});

test('webhook secrets are encrypted at rest and signatures are deterministic', () => {
  const encrypted = encryptSecret('whsec_example');
  assert.notEqual(encrypted, 'whsec_example');
  assert.equal(decryptSecret(encrypted), 'whsec_example');
  assert.equal(
    signWebhook('secret', '123', '{"ok":true}'),
    signWebhook('secret', '123', '{"ok":true}')
  );
});

test('license files enforce supported content and size', () => {
  assert.equal(validateLicenseFile({ originalname: 'license.txt', buffer: Buffer.from('valid utf8') }).extension, '.txt');
  assert.equal(validateLicenseFile({ originalname: 'license.zip', buffer: Buffer.from('504b0304', 'hex') }).extension, '.zip');
  assert.throws(
    () => validateLicenseFile({ originalname: 'license.exe', buffer: Buffer.from('MZ') }),
    /Only ZIP, TXT and DOCX/
  );
  assert.throws(
    () => validateLicenseFile({ originalname: 'license.txt', buffer: Buffer.alloc(3 * 1024 * 1024 + 1) }),
    /3 MB/
  );
});

test('mobile app files enforce APK content and 100 MB size', () => {
  assert.equal(validateMobileAppFile({ originalname: 'mobile.apk', buffer: Buffer.from('504b0304', 'hex') }).extension, '.apk');
  assert.throws(
    () => validateMobileAppFile({ originalname: 'mobile.zip', buffer: Buffer.from('504b0304', 'hex') }),
    /Only APK/
  );
  assert.throws(
    () => validateMobileAppFile({ originalname: 'mobile.apk', buffer: Buffer.from('not-an-apk') }),
    /Invalid APK/
  );
  assert.throws(
    () => validateMobileAppFile({ originalname: 'mobile.apk', buffer: Buffer.alloc(100 * 1024 * 1024 + 1) }),
    /100 MB/
  );
});

test('ordered transitions increment a durable status version once', () => {
  const license = { status: 'active', statusVersion: 2 };
  assert.equal(transitionStatus(license, 'ordered'), 'active');
  assert.equal(license.statusVersion, 3);
  assert.equal(license.orderedFromStatus, 'active');
  assert.equal(transitionStatus(license, 'ordered'), 'ordered');
  assert.equal(license.statusVersion, 3);
});

test('license webhook payload exposes customer and license order details', () => {
  const payload = integrationLicensePayload({
    _id: '64f000000000000000000001',
    customerName: 'Example Customer',
    description: 'Prod',
    status: 'ordered',
    objectLimitOption: 'custom',
    customObjectLimit: 42,
    expiresAt: new Date('2027-12-31T00:00:00.000Z'),
    mobileApp: true,
    mobileAppVersion: '1.4.0',
    tenantId: '64f000000000000000000002',
    updatedAt: new Date('2026-07-10T10:00:00.000Z')
  });

  assert.equal(payload.customerName, 'Example Customer');
  assert.equal(payload.objectLimit, 42);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'objectLimitOption'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'customObjectLimit'), false);
  assert.equal(payload.expiresAt.toISOString(), '2027-12-31T00:00:00.000Z');
  assert.equal(payload.mobileApp, true);
  assert.equal(payload.mobileAppVersion, '1.4.0');
});

test('license webhook payload exposes unlimited object limits plainly', () => {
  const payload = integrationLicensePayload({
    _id: '64f000000000000000000003',
    customerName: 'Unlimited Customer',
    status: 'ordered',
    objectLimitOption: 'unlimited',
    expiresAt: new Date('2027-12-31T00:00:00.000Z'),
    mobileApp: false
  });

  assert.equal(payload.objectLimit, 'unlimited');
});


test('webhook retry backoff is exponential and capped', () => {
  assert.equal(retryDelayMs(1), 30_000);
  assert.equal(retryDelayMs(2), 60_000);
  assert.equal(retryDelayMs(99), 6 * 60 * 60 * 1000);
});

test('webhook test inbox validates tokens, redacts secrets and parses JSON safely', () => {
  assert.equal(tokenHash('short'), '');
  assert.equal(tokenHash('a'.repeat(32)).length, 64);
  assert.deepEqual(
    safeHeaders({ authorization: 'Bearer secret', cookie: 'session=secret', 'x-epds-event-id': 'evt_1' }),
    { authorization: '[redacted]', cookie: '[redacted]', 'x-epds-event-id': 'evt_1' }
  );
  assert.deepEqual(parseJson('{"ok":true}', 'application/json'), { ok: true });
  assert.equal(parseJson('not-json', 'application/json'), null);
});
