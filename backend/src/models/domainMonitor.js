const mongoose = require('mongoose');

const DomainMonitorSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    baseUrl: { type: String, required: true, trim: true },
    normalizedUrl: { type: String, required: true, trim: true, lowercase: true, unique: true },
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
    currentIssueSince: { type: Date },
    lastFailureAt: { type: Date },
    lastRecoveryAt: { type: Date }
  },
  { timestamps: true }
);

module.exports = mongoose.models.DomainMonitor || mongoose.model('DomainMonitor', DomainMonitorSchema);
