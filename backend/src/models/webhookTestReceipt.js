const mongoose = require('mongoose');

const WebhookTestReceiptSchema = new mongoose.Schema(
  {
    inboxTokenHash: { type: String, required: true, index: true },
    method: { type: String, default: 'POST' },
    path: { type: String, required: true },
    headers: { type: mongoose.Schema.Types.Mixed, default: {} },
    rawBody: { type: String, default: '', maxlength: 262144 },
    parsedBody: { type: mongoose.Schema.Types.Mixed, default: null },
    byteLength: { type: Number, min: 0, default: 0 },
    receivedAt: { type: Date, default: Date.now, index: true },
    expiresAt: { type: Date, required: true }
  },
  { versionKey: false }
);

WebhookTestReceiptSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
WebhookTestReceiptSchema.index({ inboxTokenHash: 1, receivedAt: -1 });

module.exports = mongoose.models.WebhookTestReceipt || mongoose.model('WebhookTestReceipt', WebhookTestReceiptSchema);
