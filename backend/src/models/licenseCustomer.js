const mongoose = require('mongoose');

const OBJECT_LIMIT_OPTIONS = [
  '1000',
  '6000',
  '11000',
  '16000',
  '21000',
  '26000',
  '31000',
  'custom',
  'unlimited'
];

const DATABASE_SERVER_TYPES = ['MSSQL', 'PostgreSQL', 'Oracle'];
const DATABASE_AUTHENTICATION_METHODS = ['Native', 'Kerberos'];
const APPLICATION_SERVER_TYPES = ['Linux', 'Windows'];
const CONTACT_AREAS = ['IT', 'Üzlet', 'Beszerzés'];
const ADDRESS_ENVIRONMENTS = ['prod', 'test', 'dev'];
const CURRENCIES = ['HUF', 'EUR', 'USD'];

const LicenseCustomerSchema = new mongoose.Schema(
  {
    customerName: { type: String, required: true, trim: true },
    normalizedCustomerName: { type: String, required: true, trim: true, lowercase: true },
    description: { type: String, trim: true, maxlength: 32, default: '' },
    status: { type: String, enum: ['active', 'inactive', 'expired', 'pending', 'ordered'], required: true, default: 'active', index: true },
    statusVersion: { type: Number, min: 0, default: 0 },
    integrationEventVersion: { type: Number, min: 0, default: 0 },
    orderedFromStatus: { type: String, default: '' },
    objectLimitOption: {
      type: String,
      enum: OBJECT_LIMIT_OPTIONS,
      required: true,
      default: '1000'
    },
    customObjectLimit: { type: Number, min: 1 },
    expiresAt: { type: Date, required: true, index: true },
    databaseServerAddress: { type: String, trim: true, default: '' },
    databaseServerType: { type: String, enum: DATABASE_SERVER_TYPES },
    applicationServerAddress: { type: String, trim: true, default: '' },
    applicationServerType: { type: String, enum: APPLICATION_SERVER_TYPES },
    applicationAddress: { type: String, trim: true, default: '' },
    databaseAddresses: [{
      address: { type: String, trim: true, default: '' },
      environment: { type: String, enum: ADDRESS_ENVIRONMENTS, default: 'prod' },
      databaseType: { type: String, enum: DATABASE_SERVER_TYPES }
    }],
    applicationAddresses: [{
      address: { type: String, trim: true, default: '' },
      environment: { type: String, enum: ADDRESS_ENVIRONMENTS, default: 'prod' }
    }],
    infrastructureGroups: [{
      environment: { type: String, enum: ADDRESS_ENVIRONMENTS, default: 'prod' },
      applicationServerAddress: { type: String, trim: true, default: '' },
      applicationServerType: { type: String, enum: APPLICATION_SERVER_TYPES },
      databaseServerAddress: { type: String, trim: true, default: '' },
      databaseServerType: { type: String, enum: DATABASE_SERVER_TYPES },
      databaseName: { type: String, trim: true, default: '' },
      databaseLoginName: { type: String, trim: true, default: '' },
      databaseAuthenticationMethod: { type: String, enum: DATABASE_AUTHENTICATION_METHODS },
      mailServer: { type: String, trim: true, default: '' },
      mailServerPortProtocol: { type: String, trim: true, default: '' },
      mailUsername: { type: String, trim: true, default: '' },
      mailSenderAddress: { type: String, trim: true, default: '' },
      applicationAddress: { type: String, trim: true, default: '' }
    }],
    accessAddresses: [{
      address: { type: String, trim: true, default: '' },
      environment: { type: String, enum: ADDRESS_ENVIRONMENTS, default: 'prod' }
    }],
    mobileApp: { type: Boolean, default: false },
    mobileAppVersion: { type: String, trim: true, maxlength: 64, default: '' },
    licensePrice: { type: Number, min: 0, default: 0 },
    licenseCurrency: { type: String, enum: CURRENCIES, default: 'HUF' },
    supportPrice: { type: Number, min: 0, default: 0 },
    supportCurrency: { type: String, enum: CURRENCIES, default: 'HUF' },
    contacts: [{
      name: { type: String, trim: true, default: '' },
      email: { type: String, trim: true, lowercase: true, default: '' },
      phone: { type: String, trim: true, default: '' },
      area: { type: String, enum: CONTACT_AREAS }
    }],
    vpnApp: { type: String, trim: true, default: '' },
    twoFactorApp: { type: String, trim: true, default: '' },
    vpnCredentials: [{
      username: { type: String, trim: true, default: '' },
      password: { type: String, default: '' }
    }],
    licenseFile: {
      fileName: { type: String, trim: true, default: '' },
      blobPath: { type: String, trim: true, default: '' },
      blobUrl: { type: String, trim: true, default: '' },
      contentType: { type: String, trim: true, default: '' },
      size: { type: Number, min: 0, default: 0 },
      uploadedAt: { type: Date },
      uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      uploadedByName: { type: String, trim: true, default: '' },
      integrationClientId: { type: mongoose.Schema.Types.ObjectId, ref: 'IntegrationClient' },
      idempotencyKeyHash: { type: String, select: false }
    },
    mobileAppFile: {
      fileName: { type: String, trim: true, default: '' },
      blobPath: { type: String, trim: true, default: '' },
      blobUrl: { type: String, trim: true, default: '' },
      contentType: { type: String, trim: true, default: '' },
      size: { type: Number, min: 0, default: 0 },
      uploadedAt: { type: Date },
      uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      uploadedByName: { type: String, trim: true, default: '' },
      integrationClientId: { type: mongoose.Schema.Types.ObjectId, ref: 'IntegrationClient' },
      idempotencyKeyHash: { type: String, select: false }
    },
    notesHtml: { type: String, default: '' },
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

LicenseCustomerSchema.index(
  { tenantId: 1, normalizedCustomerName: 1 },
  { unique: true, partialFilterExpression: { tenantId: { $exists: true } } }
);

LicenseCustomerSchema.statics.objectLimitOptions = OBJECT_LIMIT_OPTIONS;
LicenseCustomerSchema.statics.databaseServerTypes = DATABASE_SERVER_TYPES;
LicenseCustomerSchema.statics.databaseAuthenticationMethods = DATABASE_AUTHENTICATION_METHODS;
LicenseCustomerSchema.statics.applicationServerTypes = APPLICATION_SERVER_TYPES;
LicenseCustomerSchema.statics.contactAreas = CONTACT_AREAS;
LicenseCustomerSchema.statics.addressEnvironments = ADDRESS_ENVIRONMENTS;
LicenseCustomerSchema.statics.currencies = CURRENCIES;

module.exports = mongoose.models.LicenseCustomer || mongoose.model('LicenseCustomer', LicenseCustomerSchema);
