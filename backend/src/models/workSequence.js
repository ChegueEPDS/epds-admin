const mongoose = require('mongoose');

const WorkSequenceSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    key: { type: String, required: true, trim: true },
    value: { type: Number, required: true, min: 0, default: 0 }
  },
  { timestamps: true }
);

WorkSequenceSchema.index({ tenantId: 1, key: 1 }, { unique: true });

module.exports = mongoose.models.WorkSequence || mongoose.model('WorkSequence', WorkSequenceSchema);
