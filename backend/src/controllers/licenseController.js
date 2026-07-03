const LicenseCustomer = require('../models/licenseCustomer');

function licenseScopeQuery(scope) {
  return scope?.tenantId ? { tenantId: scope.tenantId } : { tenantId: null };
}

function normalizeCustomerName(input) {
  return String(input || '').trim().replace(/\s+/g, ' ');
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
      databaseServerAddress: String(item?.databaseServerAddress || '').trim(),
      applicationAddress: String(item?.applicationAddress || '').trim()
    }))
    .filter((item) => item.applicationServerAddress || item.databaseServerAddress || item.applicationAddress);
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
        databaseServerAddress: '',
        applicationAddress: ''
      });
    }
    return byEnvironment.get(key);
  };

  if (license.applicationServerAddress) {
    ensureGroup('prod').applicationServerAddress = license.applicationServerAddress || '';
  }

  for (const item of databaseAddresses) {
    const group = ensureGroup(item.environment);
    if (!group.databaseServerAddress) group.databaseServerAddress = item.address || '';
  }

  for (const item of applicationAddresses) {
    const group = ensureGroup(item.environment);
    if (!group.applicationAddress) group.applicationAddress = item.address || '';
  }

  return Array.from(byEnvironment.values()).filter((item) => (
    item.applicationServerAddress || item.databaseServerAddress || item.applicationAddress
  ));
}

function presentLicense(license) {
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

  return {
    id: String(license._id),
    customerName: license.customerName,
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
    vpnCredentials: (license.vpnCredentials || []).map((credential) => ({
      username: credential.username || '',
      password: credential.password || ''
    })),
    notesHtml: license.notesHtml || '',
    tenantId: license.tenantId ? String(license.tenantId) : null,
    createdAt: license.createdAt,
    updatedAt: license.updatedAt
  };
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

  if (Object.prototype.hasOwnProperty.call(body, 'status')) {
    const status = String(body.status || '').trim().toLowerCase();
    if (!['active', 'inactive'].includes(status)) {
      throw httpError('Valid license status is required');
    }
    license.status = status;
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
      environment: item.environment
    })).filter((item) => item.address);
    license.applicationAddresses = license.infrastructureGroups.map((item) => ({
      address: item.applicationAddress,
      environment: item.environment
    })).filter((item) => item.address);

    const firstGroup = license.infrastructureGroups[0];
    license.applicationServerAddress = firstGroup?.applicationServerAddress || '';
    license.databaseServerAddress = firstGroup?.databaseServerAddress || '';
    license.databaseServerType = undefined;
    license.applicationServerType = undefined;
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
    const licenses = await LicenseCustomer.find(licenseScopeQuery(req.scope))
      .sort({ customerName: 1 })
      .lean();
    return res.json({ licenses: licenses.map(presentLicense), objectLimitOptions: LicenseCustomer.objectLimitOptions });
  } catch (err) {
    return next(err);
  }
};

exports.createLicense = async (req, res, next) => {
  try {
    const license = new LicenseCustomer({
      tenantId: req.scope?.tenantId,
      createdBy: req.userId
    });
    for (const field of ['customerName', 'status', 'objectLimitOption', 'expiresAt']) {
      if (!Object.prototype.hasOwnProperty.call(req.body || {}, field)) {
        throw httpError('Customer name, status, object limit and expiry date are required');
      }
    }
    applyLicensePayload(license, req.body || {});
    await license.save();
    return res.status(201).json({ license: presentLicense(license) });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Customer already has a license record' });
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    return next(err);
  }
};

exports.updateLicense = async (req, res, next) => {
  try {
    const license = await LicenseCustomer.findOne({ _id: req.params.id, ...licenseScopeQuery(req.scope) });
    if (!license) return res.status(404).json({ error: 'License not found' });

    applyLicensePayload(license, req.body || {});
    license.updatedBy = req.userId;
    await license.save();
    return res.json({ license: presentLicense(license) });
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
    await license.deleteOne();
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
};
