const mongoose = require('mongoose');

const LicenseEventSchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true, unique: true, index: true },
    eventType: { type: String, enum: ['license.ordered'], required: true, index: true },
    licenseId: { type: mongoose.Schema.Types.ObjectId, ref: 'LicenseCustomer', required: true, index: true },
    statusVersion: { type: Number, required: true },
    previousStatus: { type: String, required: true },
    status: { type: String, required: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    actor: {
      type: { type: String, enum: ['user', 'integration', 'system'], required: true },
      id: { type: String, default: '' },
      name: { type: String, default: '' }
    },
    occurredAt: { type: Date, required: true, default: Date.now, index: true },
    deliveriesEnsuredAt: { type: Date, default: null, index: true }
  },
  { timestamps: true }
);

LicenseEventSchema.index({ occurredAt: 1, _id: 1 });
LicenseEventSchema.index({ licenseId: 1, statusVersion: 1 }, { unique: true });

module.exports = mongoose.models.LicenseEvent || mongoose.model('LicenseEvent', LicenseEventSchema);
