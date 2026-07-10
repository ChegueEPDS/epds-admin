const mongoose = require('mongoose');

const IntegrationRequestSchema = new mongoose.Schema(
  {
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'IntegrationClient', required: true },
    idempotencyKey: { type: String, required: true },
    requestFingerprint: { type: String, required: true },
    status: { type: String, enum: ['processing', 'completed'], default: 'processing' },
    responseStatus: { type: Number },
    responseBody: { type: mongoose.Schema.Types.Mixed },
    expiresAt: { type: Date, required: true, index: { expires: 0 } }
  },
  { timestamps: true }
);

IntegrationRequestSchema.index({ clientId: 1, idempotencyKey: 1 }, { unique: true });

module.exports = mongoose.models.IntegrationRequest || mongoose.model('IntegrationRequest', IntegrationRequestSchema);
