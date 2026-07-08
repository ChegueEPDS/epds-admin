const mongoose = require('mongoose');

const DOMAIN_OWNERS = ['Stahl', 'Robex', 'Veproil', 'ExNB/Exva', 'Ind-Ex', 'EPDS'];

const DomainMonitorSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    baseUrl: { type: String, required: true, trim: true },
    normalizedUrl: { type: String, required: true, trim: true, lowercase: true, unique: true },
    owner: { type: String, enum: DOMAIN_OWNERS, required: true, default: 'EPDS', index: true },
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true },
    enabled: { type: Boolean, default: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    lastCheckedAt: { type: Date },
    lastStatus: { type: String, enum: ['ok', 'warning', 'error', 'unknown'], default: 'unknown', index: true },
    lastResponseMs: { type: Number },
    lastStatusCode: { type: Number },
    lastError: { type: String },
    lastErrorType: { type: String },
    lastWarning: { type: String },
    lastWarningType: { type: String },
    lastFinalUrl: { type: String },
    lastRedirectCount: { type: Number },
    lastContentType: { type: String },
    lastContentLength: { type: Number },
    lastTlsValidTo: { type: Date },
    lastTlsDaysRemaining: { type: Number },
    currentIssueSince: { type: Date },
    lastFailureAt: { type: Date },
    lastRecoveryAt: { type: Date },
    healthConfig: {
      checkPath: { type: String, default: '' },
      expectedStatusMin: { type: Number, default: 200 },
      expectedStatusMax: { type: Number, default: 399 },
      timeoutMs: { type: Number, default: 10000 },
      warningResponseMs: { type: Number, default: 2500 },
      errorResponseMs: { type: Number, default: 10000 },
      followRedirects: { type: Boolean, default: true },
      tlsWarningDays: { type: Number, default: 30 }
    }
  },
  { timestamps: true }
);

DomainMonitorSchema.statics.owners = DOMAIN_OWNERS;

module.exports = mongoose.models.DomainMonitor || mongoose.model('DomainMonitor', DomainMonitorSchema);
