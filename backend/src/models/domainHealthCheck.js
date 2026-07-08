const mongoose = require('mongoose');

const DomainHealthCheckSchema = new mongoose.Schema(
  {
    domainId: { type: mongoose.Schema.Types.ObjectId, ref: 'DomainMonitor', required: true, index: true },
    checkedAt: { type: Date, required: true, default: Date.now },
    ok: { type: Boolean, required: true, index: true },
    status: { type: String, enum: ['ok', 'warning', 'error'], default: 'ok', index: true },
    statusCode: { type: Number },
    responseMs: { type: Number },
    finalUrl: { type: String },
    redirectCount: { type: Number },
    contentType: { type: String },
    contentLength: { type: Number },
    tlsValidTo: { type: Date },
    tlsDaysRemaining: { type: Number },
    errorType: { type: String },
    errorMessage: { type: String },
    warningType: { type: String },
    warningMessage: { type: String }
  },
  { timestamps: true }
);

DomainHealthCheckSchema.index({ domainId: 1, checkedAt: -1 });
DomainHealthCheckSchema.index({ checkedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

module.exports = mongoose.models.DomainHealthCheck || mongoose.model('DomainHealthCheck', DomainHealthCheckSchema);
