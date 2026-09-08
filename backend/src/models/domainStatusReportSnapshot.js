const mongoose = require('mongoose');

const DomainStatusReportSnapshotSchema = new mongoose.Schema(
  {
    ownerSlug: { type: String, required: true, unique: true, index: true },
    generatedAt: { type: Date, required: true },
    report: { type: mongoose.Schema.Types.Mixed, required: true },
    buildDurationMs: { type: Number, required: true },
    ready: { type: Boolean, default: false, index: true },
    leaseUntil: { type: Date, default: null }
  },
  { timestamps: true, minimize: false }
);

module.exports = mongoose.models.DomainStatusReportSnapshot
  || mongoose.model('DomainStatusReportSnapshot', DomainStatusReportSnapshotSchema);
