const mongoose = require('mongoose');

const IntegrationClientSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    keyPrefix: { type: String, required: true, unique: true, index: true },
    keyHash: { type: String, required: true, unique: true, select: false },
    status: { type: String, enum: ['active', 'revoked'], default: 'active', index: true },
    scopes: {
      type: [String],
      enum: ['licenses:read', 'licenses:file:write', 'events:read'],
      default: ['licenses:read', 'licenses:file:write', 'events:read']
    },
    webhookUrl: { type: String, trim: true, default: '' },
    webhookSecretEncrypted: { type: String, default: '', select: false },
    webhookEnabled: { type: Boolean, default: false },
    lastUsedAt: { type: Date },
    lastWebhookSuccessAt: { type: Date },
    revokedAt: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

module.exports = mongoose.models.IntegrationClient || mongoose.model('IntegrationClient', IntegrationClientSchema);
