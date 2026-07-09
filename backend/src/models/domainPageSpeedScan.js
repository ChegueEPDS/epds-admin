const mongoose = require('mongoose');

const DomainPageSpeedScanSchema = new mongoose.Schema(
  {
    domainId: { type: mongoose.Schema.Types.ObjectId, ref: 'DomainMonitor', required: true, index: true },
    checkedAt: { type: Date, required: true, default: Date.now },
    source: { type: String, enum: ['manual', 'scheduled'], default: 'manual', index: true },
    scans: { type: [mongoose.Schema.Types.Mixed], default: [] }
  },
  { timestamps: true }
);

DomainPageSpeedScanSchema.index({ domainId: 1, checkedAt: -1 });
DomainPageSpeedScanSchema.index({ checkedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 180 });

module.exports = mongoose.models.DomainPageSpeedScan || mongoose.model('DomainPageSpeedScan', DomainPageSpeedScanSchema);
