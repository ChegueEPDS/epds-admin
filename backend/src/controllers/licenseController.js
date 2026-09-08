const LicenseCustomer = require('../models/licenseCustomer');
const Tenant = require('../models/tenant');
const fileStorage = require('../services/fileStorageService');
const { normalizeMobileAppVersion, replaceLicenseFile, replaceMobileAppFile } = require('../services/licenseFileService');
const { publishOrderedEvent, transitionStatus } = require('../services/licenseIntegrationService');
const { todayUtcStart } = require('../services/licenseExpiryService');
const { pipeline } = require('stream/promises');

function licenseScopeQuery(scope) {
  if (canManageAllLicenses(scope)) return {};
  return scope?.tenantId ? { tenantId: scope.tenantId } : { tenantId: null };
}

function canManageAllLicenses(scope = {}) {
  if (scope.role === 'SuperAdmin') return true;
  return ['epds', 'developer', 'epds-admin'].includes(String(scope.tenantName || '').trim().toLowerCase());
}

function tenantLabel(tenant) {
  return String(tenant?.displayName || tenant?.name || '').trim();
}

function normalizeCustomerName(input) {
  return String(input || '').trim().replace(/\s+/g, ' ');
}

function requestLimit(value, fallback = 100, max = 200) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(1, Math.floor(parsed))) : fallback;
}

function safePathSegment(input, fallback = 'file') {
  return String(input || fallback)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._ -]+/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[/.\\]+$/g, '')
    .slice(0, 120) || fallback;
}

function cleanFileName(input) {
  return safePathSegment(input, 'license-file').replace(/[\\/]/g, '_');
}

function contentDispositionAttachment(fileName) {
  const ascii = cleanFileName(fileName).replace(/"/g, '');
  const encoded = encodeURIComponent(fileName).replace(/['()]/g, escape).replace(/\*/g, '%2A');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function userDisplayName(user) {
  return [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim()
    || String(user?.email || '').trim()
    || 'Unknown user';
}

function normalizeDateOnly(input) {
  const raw = String(input || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw ? null : date;
}

function httpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeObjectLimit(input, customInput) {
  const option = String(input || '').trim();
  if (!LicenseCustomer.objectLimitOptions.includes(option)) {
    throw httpError('Valid object limit is required');
  }

  if (option !== 'custom') {
    return { objectLimitOption: option, customObjectLimit: undefined };
  }

  const customObjectLimit = Number(customInput);
  if (!Number.isInteger(customObjectLimit) || customObjectLimit < 1) {
    throw httpError('Custom object limit must be a positive integer');
  }

  return { objectLimitOption: option, customObjectLimit };
}

function applyExpiredStatus(license) {
  if (license.status === 'active' && license.expiresAt && new Date(license.expiresAt) < todayUtcStart()) {
    transitionStatus(license, 'expired');
  }
}

function normalizeOptionalEnum(input, options, label) {
  const value = String(input || '').trim();
  if (!value) return undefined;
  if (!options.includes(value)) throw httpError(`Valid ${label} is required`);
  return value;
}

function normalizeOptionalPrice(input, label) {
  if (input === undefined || input === null || input === '') return 0;
  const value = Number(input);
  if (!Number.isInteger(value) || value < 0) throw httpError(`${label} must be a whole non-negative number`);
  return value;
}

function normalizeCurrency(input) {
  return normalizeOptionalEnum(input || 'HUF', LicenseCustomer.currencies, 'currency') || 'HUF';
}

function normalizeContacts(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((contact) => ({
      name: String(contact?.name || '').trim(),
      email: String(contact?.email || '').trim().toLowerCase(),
      phone: String(contact?.phone || '').trim(),
      area: normalizeOptionalEnum(contact?.area, LicenseCustomer.contactAreas, 'contact area')
    }))
    .filter((contact) => contact.name || contact.email || contact.phone || contact.area);
}

function normalizeVpnCredentials(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((credential) => ({
      username: String(credential?.username || '').trim(),
      password: String(credential?.password || '')
    }))
    .filter((credential) => credential.username || credential.password);
}

function normalizeAddressEnvironment(input) {
  return normalizeOptionalEnum(input || 'prod', LicenseCustomer.addressEnvironments, 'address environment') || 'prod';
}

function normalizeDatabaseAddresses(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => ({
      address: String(item?.address || '').trim(),
      environment: normalizeAddressEnvironment(item?.environment),
      databaseType: normalizeOptionalEnum(item?.databaseType, LicenseCustomer.databaseServerTypes, 'database server type')
    }))
    .filter((item) => item.address || item.databaseType);
}

function normalizeTypedAddresses(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => ({
      address: String(item?.address || '').trim(),
      environment: normalizeAddressEnvironment(item?.environment)
    }))
    .filter((item) => item.address);
}

function normalizeInfrastructureGroups(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => ({
      environment: normalizeAddressEnvironment(item?.environment),
      applicationServerAddress: String(item?.applicationServerAddress || '').trim(),
      applicationServerType: normalizeOptionalEnum(item?.applicationServerType, LicenseCustomer.applicationServerTypes, 'application server type'),
      databaseServerAddress: String(item?.databaseServerAddress || '').trim(),
      databaseServerType: normalizeOptionalEnum(item?.databaseServerType, LicenseCustomer.databaseServerTypes, 'database server type'),
      databaseName: String(item?.databaseName || '').trim(),
      databaseLoginName: String(item?.databaseLoginName || '').trim(),
      databaseAuthenticationMethod: normalizeOptionalEnum(
        item?.databaseAuthenticationMethod,
        LicenseCustomer.databaseAuthenticationMethods,
        'database authentication method'
      ),
      mailServer: String(item?.mailServer || '').trim(),
      mailServerPortProtocol: String(item?.mailServerPortProtocol || '').trim(),
      mailUsername: String(item?.mailUsername || '').trim(),
      mailSenderAddress: String(item?.mailSenderAddress || '').trim(),
      applicationAddress: String(item?.applicationAddress || '').trim()
    }))
    .filter((item) => (
      item.applicationServerAddress ||
      item.applicationServerType ||
      item.databaseServerAddress ||
      item.databaseServerType ||
      item.databaseName ||
      item.databaseLoginName ||
      item.databaseAuthenticationMethod ||
      item.mailServer ||
      item.mailServerPortProtocol ||
      item.mailUsername ||
      item.mailSenderAddress ||
      item.applicationAddress
    ));
}

function buildInfrastructureGroups(license, databaseAddresses, applicationAddresses) {
  const savedGroups = normalizeInfrastructureGroups(license.infrastructureGroups || []);
  if (savedGroups.length) return savedGroups;

  const byEnvironment = new Map();
  const ensureGroup = (environment) => {
    const key = normalizeAddressEnvironment(environment);
    if (!byEnvironment.has(key)) {
      byEnvironment.set(key, {
        environment: key,
        applicationServerAddress: '',
        applicationServerType: undefined,
        databaseServerAddress: '',
        databaseServerType: undefined,
        databaseName: '',
        databaseLoginName: '',
        databaseAuthenticationMethod: undefined,
        mailServer: '',
        mailServerPortProtocol: '',
        mailUsername: '',
        mailSenderAddress: '',
        applicationAddress: ''
      });
    }
    return byEnvironment.get(key);
  };

  if (license.applicationServerAddress || license.applicationServerType) {
    const group = ensureGroup('prod');
    group.applicationServerAddress = license.applicationServerAddress || '';
    group.applicationServerType = license.applicationServerType || undefined;
  }

  for (const item of databaseAddresses) {
    const group = ensureGroup(item.environment);
    if (!group.databaseServerAddress) group.databaseServerAddress = item.address || '';
    if (!group.databaseServerType) group.databaseServerType = item.databaseType || undefined;
  }

  for (const item of applicationAddresses) {
    const group = ensureGroup(item.environment);
    if (!group.applicationAddress) group.applicationAddress = item.address || '';
  }

  return Array.from(byEnvironment.values()).filter((item) => (
    item.applicationServerAddress ||
    item.applicationServerType ||
    item.databaseServerAddress ||
    item.databaseServerType ||
    item.databaseName ||
    item.databaseLoginName ||
    item.databaseAuthenticationMethod ||
    item.mailServer ||
    item.mailServerPortProtocol ||
    item.mailUsername ||
    item.mailSenderAddress ||
    item.applicationAddress
  ));
}

function presentLicense(license, options = {}) {
  const includeVpnCredentials = options.includeVpnCredentials !== false;
  const tenant = license.tenantId && typeof license.tenantId === 'object' ? license.tenantId : null;
  const objectLimit = license.objectLimitOption === 'custom'
    ? license.customObjectLimit
    : license.objectLimitOption === 'unlimited'
      ? 'unlimited'
      : Number(license.objectLimitOption);

  const databaseAddresses = (license.databaseAddresses || []).map((item) => ({
    address: item.address || '',
    environment: item.environment || 'prod',
    databaseType: item.databaseType || null
  }));
  const applicationAddresses = (license.applicationAddresses || []).map((item) => ({
    address: item.address || '',
    environment: item.environment || 'prod'
  }));
  const accessAddresses = (license.accessAddresses || []).slice(0, 1).map((item) => ({
    address: item.address || '',
    environment: 'prod'
  }));

  if (!databaseAddresses.length && (license.databaseServerAddress || license.databaseServerType)) {
    databaseAddresses.push({
      address: license.databaseServerAddress || '',
      environment: 'prod',
      databaseType: license.databaseServerType || null
    });
  }

  if (!applicationAddresses.length && license.applicationAddress) {
    applicationAddresses.push({
      address: license.applicationAddress,
      environment: 'prod'
    });
  }
  const infrastructureGroups = buildInfrastructureGroups(license, databaseAddresses, applicationAddresses);
  const licenseFile = license.licenseFile?.blobPath ? {
    fileName: license.licenseFile.fileName || 'license-file',
    blobPath: license.licenseFile.blobPath || '',
    blobUrl: license.licenseFile.blobUrl || '',
    contentType: license.licenseFile.contentType || '',
    size: license.licenseFile.size || 0,
    uploadedAt: license.licenseFile.uploadedAt || null,
    uploadedByName: license.licenseFile.uploadedByName || ''
  } : null;
  const mobileAppFile = license.mobileAppFile?.blobPath ? {
    fileName: license.mobileAppFile.fileName || 'mobile-app.apk',
    blobPath: license.mobileAppFile.blobPath || '',
    blobUrl: license.mobileAppFile.blobUrl || '',
    contentType: license.mobileAppFile.contentType || '',
    size: license.mobileAppFile.size || 0,
    uploadedAt: license.mobileAppFile.uploadedAt || null,
    uploadedByName: license.mobileAppFile.uploadedByName || ''
  } : null;

  return {
    id: String(license._id),
    customerName: license.customerName,
    description: license.description || '',
    status: license.status,
    objectLimitOption: license.objectLimitOption,
    customObjectLimit: license.customObjectLimit || null,
    objectLimit,
    expiresAt: license.expiresAt,
    databaseServerAddress: license.databaseServerAddress || '',
    databaseServerType: license.databaseServerType || null,
    applicationServerAddress: license.applicationServerAddress || '',
    applicationServerType: license.applicationServerType || null,
    applicationAddress: license.applicationAddress || '',
    databaseAddresses,
    applicationAddresses,
    infrastructureGroups,
    accessAddresses,
    mobileApp: Boolean(license.mobileApp),
    mobileAppVersion: license.mobileAppVersion || '',
    mobileAppFile,
    licensePrice: license.licensePrice || 0,
    licenseCurrency: license.licenseCurrency || 'HUF',
    supportPrice: license.supportPrice || 0,
    supportCurrency: license.supportCurrency || 'HUF',
    contacts: (license.contacts || []).map((contact) => ({
      name: contact.name || '',
      email: contact.email || '',
      phone: contact.phone || '',
      area: contact.area || null
    })),
    vpnApp: license.vpnApp || '',
    twoFactorApp: license.twoFactorApp || '',
    vpnCredentials: includeVpnCredentials ? (license.vpnCredentials || []).map((credential) => ({
      username: credential.username || '',
      password: credential.password || ''
    })) : [],
    licenseFile,
    notesHtml: license.notesHtml || '',
    tenantId: tenant?._id ? String(tenant._id) : (license.tenantId ? String(license.tenantId) : null),
    tenantName: tenant?.name || null,
    tenantDisplayName: tenantLabel(tenant) || null,
    createdAt: license.createdAt,
    updatedAt: license.updatedAt
  };
}

async function clientTenantFromPayload(body) {
  const tenantId = String(body?.tenantId || '').trim();
  if (!tenantId) throw httpError('Customer is required');
  const tenant = await Tenant.findOne({ _id: tenantId, type: 'client' });
  if (!tenant) throw httpError('Valid client customer is required', 404);
  return tenant;
}

function applyLicensePayload(license, body) {
  if (Object.prototype.hasOwnProperty.call(body, 'customerName')) {
    const customerName = normalizeCustomerName(body.customerName);
    if (!customerName) {
      throw httpError('Customer name is required');
    }
    license.customerName = customerName;
    license.normalizedCustomerName = customerName.toLowerCase();
  }

  if (Object.prototype.hasOwnProperty.call(body, 'description')) {
    const description = String(body.description || '').trim();
    if (description.length > 32) {
      throw httpError('Description can be at most 32 characters');
    }
    license.description = description;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'status')) {
    const status = String(body.status || '').trim().toLowerCase();
    if (!['active', 'inactive', 'expired', 'pending', 'ordered'].includes(status)) {
      throw httpError('Valid license status is required');
    }
    transitionStatus(license, status);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'objectLimitOption')) {
    const objectLimit = normalizeObjectLimit(body.objectLimitOption, body.customObjectLimit);
    license.objectLimitOption = objectLimit.objectLimitOption;
    license.customObjectLimit = objectLimit.customObjectLimit;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'expiresAt')) {
    const expiresAt = normalizeDateOnly(body.expiresAt);
    if (!expiresAt) {
      throw httpError('Valid expiry date is required');
    }
    license.expiresAt = expiresAt;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'databaseServerAddress')) {
    license.databaseServerAddress = String(body.databaseServerAddress || '').trim();
  }

  if (Object.prototype.hasOwnProperty.call(body, 'databaseServerType')) {
    license.databaseServerType = normalizeOptionalEnum(
      body.databaseServerType,
      LicenseCustomer.databaseServerTypes,
      'database server type'
    );
  }

  if (Object.prototype.hasOwnProperty.call(body, 'applicationServerAddress')) {
    license.applicationServerAddress = String(body.applicationServerAddress || '').trim();
  }

  if (Object.prototype.hasOwnProperty.call(body, 'applicationServerType')) {
    license.applicationServerType = normalizeOptionalEnum(
      body.applicationServerType,
      LicenseCustomer.applicationServerTypes,
      'application server type'
    );
  }

  if (Object.prototype.hasOwnProperty.call(body, 'applicationAddress')) {
    license.applicationAddress = String(body.applicationAddress || '').trim();
  }

  if (Object.prototype.hasOwnProperty.call(body, 'databaseAddresses')) {
    license.databaseAddresses = normalizeDatabaseAddresses(body.databaseAddresses);
    const firstDatabase = license.databaseAddresses[0];
    license.databaseServerAddress = firstDatabase?.address || '';
    license.databaseServerType = firstDatabase?.databaseType;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'applicationAddresses')) {
    license.applicationAddresses = normalizeTypedAddresses(body.applicationAddresses);
    license.applicationAddress = license.applicationAddresses[0]?.address || '';
  }

  if (Object.prototype.hasOwnProperty.call(body, 'infrastructureGroups')) {
    license.infrastructureGroups = normalizeInfrastructureGroups(body.infrastructureGroups);
    license.databaseAddresses = license.infrastructureGroups.map((item) => ({
      address: item.databaseServerAddress,
      environment: item.environment,
      databaseType: item.databaseServerType
    })).filter((item) => item.address || item.databaseType);
    license.applicationAddresses = license.infrastructureGroups.map((item) => ({
      address: item.applicationAddress,
      environment: item.environment
    })).filter((item) => item.address);

    const firstGroup = license.infrastructureGroups[0];
    license.applicationServerAddress = firstGroup?.applicationServerAddress || '';
    license.databaseServerAddress = firstGroup?.databaseServerAddress || '';
    license.databaseServerType = firstGroup?.databaseServerType;
    license.applicationServerType = firstGroup?.applicationServerType;
    license.applicationAddress = firstGroup?.applicationAddress || '';
  }

  if (Object.prototype.hasOwnProperty.call(body, 'accessAddresses')) {
    license.accessAddresses = normalizeTypedAddresses(body.accessAddresses)
      .slice(0, 1)
      .map((item) => ({ address: item.address, environment: 'prod' }));
  }

  if (Object.prototype.hasOwnProperty.call(body, 'mobileApp')) {
    license.mobileApp = body.mobileApp === true;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'mobileAppVersion')) {
    license.mobileAppVersion = normalizeMobileAppVersion(body.mobileAppVersion);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'licensePrice')) {
    license.licensePrice = normalizeOptionalPrice(body.licensePrice, 'License price');
  }

  if (Object.prototype.hasOwnProperty.call(body, 'licenseCurrency')) {
    license.licenseCurrency = normalizeCurrency(body.licenseCurrency);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'supportPrice')) {
    license.supportPrice = normalizeOptionalPrice(body.supportPrice, 'Support price');
  }

  if (Object.prototype.hasOwnProperty.call(body, 'supportCurrency')) {
    license.supportCurrency = normalizeCurrency(body.supportCurrency);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'contacts')) {
    license.contacts = normalizeContacts(body.contacts);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'vpnApp')) {
    license.vpnApp = String(body.vpnApp || '').trim();
  }

  if (Object.prototype.hasOwnProperty.call(body, 'twoFactorApp')) {
    license.twoFactorApp = String(body.twoFactorApp || '').trim();
  }

  if (Object.prototype.hasOwnProperty.call(body, 'vpnCredentials')) {
    license.vpnCredentials = normalizeVpnCredentials(body.vpnCredentials);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'notesHtml')) {
    license.notesHtml = String(body.notesHtml || '');
  }
}

exports.listLicenses = async (req, res, next) => {
  try {
    const includeVpnCredentials = req.scope?.tenantType !== 'client';
    const limit = requestLimit(req.query.limit);
    const licenses = await LicenseCustomer.find(licenseScopeQuery(req.scope))
      .sort({ customerName: 1 })
      .limit(limit)
      .populate('tenantId', 'name displayName type')
      .lean();
    const clientTenants = canManageAllLicenses(req.scope)
      ? await Tenant.find({ type: 'client' }).sort({ displayName: 1, name: 1 }).select('name displayName type').lean()
      : [];
    return res.json({
      licenses: licenses.map((license) => presentLicense(license, { includeVpnCredentials })),
      objectLimitOptions: LicenseCustomer.objectLimitOptions,
      clientTenants: clientTenants.map((tenant) => ({
        id: String(tenant._id),
        name: tenant.name,
        displayName: tenantLabel(tenant),
        type: tenant.type
      }))
    });
  } catch (err) {
    return next(err);
  }
};

exports.createLicense = async (req, res, next) => {
  try {
    const includeVpnCredentials = req.scope?.tenantType !== 'client';
    const payload = { ...(req.body || {}) };
    if (!includeVpnCredentials) delete payload.vpnCredentials;
    const clientTenant = canManageAllLicenses(req.scope) ? await clientTenantFromPayload(req.body || {}) : null;
    const license = new LicenseCustomer({
      tenantId: clientTenant?._id || req.scope?.tenantId,
      createdBy: req.userId
    });
    const previousStatus = license.status;
    for (const field of ['customerName', 'status', 'objectLimitOption', 'expiresAt']) {
      if (!Object.prototype.hasOwnProperty.call(req.body || {}, field)) {
        throw httpError('Customer name, status, object limit and expiry date are required');
      }
    }
    applyLicensePayload(license, payload);
    if (clientTenant) {
      license.customerName = tenantLabel(clientTenant);
      license.normalizedCustomerName = license.customerName.toLowerCase();
    }
    applyExpiredStatus(license);
    await license.save();
    await license.populate('tenantId', 'name displayName type');
    await publishOrderedEvent(license, previousStatus, {
      type: 'user', id: String(req.userId), name: userDisplayName(req.user)
    });
    return res.status(201).json({ license: presentLicense(license, { includeVpnCredentials }) });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Customer already has a license record' });
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    return next(err);
  }
};

exports.updateLicense = async (req, res, next) => {
  try {
    const includeVpnCredentials = req.scope?.tenantType !== 'client';
    const payload = { ...(req.body || {}) };
    if (!includeVpnCredentials) delete payload.vpnCredentials;
    const license = await LicenseCustomer.findOne({ _id: req.params.id, ...licenseScopeQuery(req.scope) });
    if (!license) return res.status(404).json({ error: 'License not found' });
    applyExpiredStatus(license);
    const previousStatus = license.status;
    const isGlobalManager = canManageAllLicenses(req.scope);
    const clientTenant = isGlobalManager && Object.prototype.hasOwnProperty.call(req.body || {}, 'tenantId')
      ? await clientTenantFromPayload(req.body || {})
      : isGlobalManager && license.tenantId
        ? await Tenant.findOne({ _id: license.tenantId, type: 'client' })
        : null;

    applyLicensePayload(license, payload);
    if (clientTenant) {
      license.tenantId = clientTenant._id;
      license.customerName = tenantLabel(clientTenant);
      license.normalizedCustomerName = license.customerName.toLowerCase();
    }
    applyExpiredStatus(license);
    license.updatedBy = req.userId;
    await license.save();
    await license.populate('tenantId', 'name displayName type');
    await publishOrderedEvent(license, previousStatus, {
      type: 'user', id: String(req.userId), name: userDisplayName(req.user)
    });
    return res.json({ license: presentLicense(license, { includeVpnCredentials }) });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Customer already has a license record' });
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    return next(err);
  }
};

exports.deleteLicense = async (req, res, next) => {
  try {
    const license = await LicenseCustomer.findOne({ _id: req.params.id, ...licenseScopeQuery(req.scope) });
    if (!license) return res.status(404).json({ error: 'License not found' });
    const blobPaths = [license.licenseFile?.blobPath, license.mobileAppFile?.blobPath].filter(Boolean);
    await license.deleteOne();
    for (const blobPath of blobPaths) {
      try { await fileStorage.deleteFile(blobPath); } catch (err) {
        console.warn('[license] deleted blob cleanup failed:', err?.message || err);
      }
    }
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
};

exports.uploadMobileAppFile = async (req, res, next) => {
  try {
    const license = await LicenseCustomer.findOne({ _id: req.params.id, ...licenseScopeQuery(req.scope) });
    if (!license) return res.status(404).json({ error: 'License not found' });
    if (!req.file) return res.status(400).json({ error: 'No file provided' });

    await replaceMobileAppFile(license, req.file, { userId: req.userId, name: userDisplayName(req.user) }, req.body?.version);
    await license.populate('tenantId', 'name displayName type');
    return res.json({ license: presentLicense(license, { includeVpnCredentials: req.scope?.tenantType !== 'client' }) });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    return next(err);
  }
};

exports.uploadLicenseFile = async (req, res, next) => {
  try {
    const license = await LicenseCustomer.findOne({ _id: req.params.id, ...licenseScopeQuery(req.scope) });
    if (!license) return res.status(404).json({ error: 'License not found' });
    if (!req.file) return res.status(400).json({ error: 'No file provided' });

    await replaceLicenseFile(license, req.file, { userId: req.userId, name: userDisplayName(req.user) });
    await license.populate('tenantId', 'name displayName type');
    return res.json({ license: presentLicense(license, { includeVpnCredentials: req.scope?.tenantType !== 'client' }) });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    return next(err);
  }
};

exports.orderLicense = async (req, res, next) => {
  try {
    const includeVpnCredentials = req.scope?.tenantType !== 'client';
    const license = await LicenseCustomer.findOne({ _id: req.params.id, ...licenseScopeQuery(req.scope) });
    if (!license) return res.status(404).json({ error: 'License not found' });
    applyExpiredStatus(license);
    const previousStatus = license.status;

    const objectLimit = normalizeObjectLimit(req.body?.objectLimitOption, req.body?.customObjectLimit);
    const expiresAt = normalizeDateOnly(req.body?.expiresAt);
    if (!expiresAt) throw httpError('Valid expiry date is required');

    const previousBlobPath = license.licenseFile?.blobPath || '';

    license.objectLimitOption = objectLimit.objectLimitOption;
    license.customObjectLimit = objectLimit.customObjectLimit;
    license.mobileApp = req.body?.mobileApp === true;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'mobileAppVersion')) {
      license.mobileAppVersion = normalizeMobileAppVersion(req.body.mobileAppVersion);
    }
    license.expiresAt = expiresAt;
    transitionStatus(license, 'ordered');
    license.licenseFile = {
      fileName: '',
      blobPath: '',
      blobUrl: '',
      contentType: '',
      size: 0,
      uploadedAt: undefined,
      uploadedBy: undefined,
      uploadedByName: ''
    };
    license.updatedBy = req.userId;
    await license.save();
    if (previousBlobPath) {
      try { await fileStorage.deleteFile(previousBlobPath); } catch (err) {
        console.warn('[license] ordered license blob cleanup failed:', err?.message || err);
      }
    }
    await license.populate('tenantId', 'name displayName type');
    await publishOrderedEvent(license, previousStatus, {
      type: 'user', id: String(req.userId), name: userDisplayName(req.user)
    });
    return res.json({ license: presentLicense(license, { includeVpnCredentials }) });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    return next(err);
  }
};

exports.activateLicense = async (req, res, next) => {
  try {
    const includeVpnCredentials = req.scope?.tenantType !== 'client';
    const license = await LicenseCustomer.findOne({ _id: req.params.id, ...licenseScopeQuery(req.scope) });
    if (!license) return res.status(404).json({ error: 'License not found' });
    if (!license.licenseFile?.blobPath) return res.status(400).json({ error: 'License file is required before activation' });

    transitionStatus(license, 'active');
    license.updatedBy = req.userId;
    await license.save();
    await license.populate('tenantId', 'name displayName type');
    return res.json({ license: presentLicense(license, { includeVpnCredentials }) });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    return next(err);
  }
};

exports.downloadLicenseFile = async (req, res, next) => {
  try {
    if (req.scope?.tenantType === 'client') {
      return res.status(403).json({ error: 'Client tenants cannot download license files' });
    }
    const license = await LicenseCustomer.findOne({ _id: req.params.id, ...licenseScopeQuery(req.scope) }).lean();
    if (!license) return res.status(404).json({ error: 'License not found' });
    if (!license.licenseFile?.blobPath) return res.status(404).json({ error: 'License file not found' });

    const download = await fileStorage.openDownloadStream(license.licenseFile.blobPath, req.headers.range);
    const fileName = license.licenseFile.fileName || 'license-file';
    res.status(download.partial ? 206 : 200);
    res.setHeader('Content-Type', license.licenseFile.contentType || 'application/octet-stream');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', download.end - download.start + 1);
    if (download.partial) res.setHeader('Content-Range', `bytes ${download.start}-${download.end}/${download.size}`);
    res.setHeader('Content-Disposition', contentDispositionAttachment(fileName));
    await pipeline(download.stream, res);
    return undefined;
  } catch (err) {
    if (err.statusCode === 416) {
      res.setHeader('Content-Range', `bytes */${err.size}`);
      return res.status(416).end();
    }
    if (res.headersSent) return res.destroy(err);
    return next(err);
  }
};

exports.downloadMobileAppFile = async (req, res, next) => {
  try {
    const license = await LicenseCustomer.findOne({ _id: req.params.id, ...licenseScopeQuery(req.scope) }).lean();
    if (!license) return res.status(404).json({ error: 'License not found' });
    if (!license.mobileAppFile?.blobPath) return res.status(404).json({ error: 'Mobile app file not found' });

    const download = await fileStorage.openDownloadStream(license.mobileAppFile.blobPath, req.headers.range);
    const fileName = license.mobileAppFile.fileName || 'mobile-app.apk';
    res.status(download.partial ? 206 : 200);
    res.setHeader('Content-Type', license.mobileAppFile.contentType || 'application/vnd.android.package-archive');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', download.end - download.start + 1);
    if (download.partial) res.setHeader('Content-Range', `bytes ${download.start}-${download.end}/${download.size}`);
    res.setHeader('Content-Disposition', contentDispositionAttachment(fileName));
    await pipeline(download.stream, res);
    return undefined;
  } catch (err) {
    if (err.statusCode === 416) {
      res.setHeader('Content-Range', `bytes */${err.size}`);
      return res.status(416).end();
    }
    if (res.headersSent) return res.destroy(err);
    return next(err);
  }
};
