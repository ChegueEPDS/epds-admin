const mongoose = require('mongoose');

const WebhookDeliverySchema = new mongoose.Schema(
  {
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'LicenseEvent', required: true, index: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'IntegrationClient', required: true, index: true },
    status: { type: String, enum: ['pending', 'processing', 'delivered', 'dead'], default: 'pending', index: true },
    attemptCount: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: Date.now, index: true },
    lockedUntil: { type: Date },
    deliveredAt: { type: Date },
    lastAttemptAt: { type: Date },
    lastStatusCode: { type: Number },
    lastError: { type: String, default: '', maxlength: 1000 }
  },
  { timestamps: true }
);

WebhookDeliverySchema.index({ eventId: 1, clientId: 1 }, { unique: true });
WebhookDeliverySchema.index({ status: 1, nextAttemptAt: 1 });

module.exports = mongoose.models.WebhookDelivery || mongoose.model('WebhookDelivery', WebhookDeliverySchema);
