const mongoose = require('mongoose');

const DomainHealthDailyRollupSchema = new mongoose.Schema(
  {
    domainId: { type: mongoose.Schema.Types.ObjectId, ref: 'DomainMonitor', required: true },
    day: { type: Date, required: true },
    totalChecks: { type: Number, required: true },
    okCount: { type: Number, required: true },
    warningCount: { type: Number, required: true },
    errorCount: { type: Number, required: true },
    responseMsSum: { type: Number, required: true },
    responseMsCount: { type: Number, required: true },
    responseMsSamples: { type: [Number], default: [] },
    firstCheckedAt: { type: Date },
    lastCheckedAt: { type: Date }
  },
  { timestamps: true }
);

DomainHealthDailyRollupSchema.index({ domainId: 1, day: 1 }, { unique: true });
DomainHealthDailyRollupSchema.index({ day: 1 });

module.exports = mongoose.models.DomainHealthDailyRollup
  || mongoose.model('DomainHealthDailyRollup', DomainHealthDailyRollupSchema);
