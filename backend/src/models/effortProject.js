const mongoose = require('mongoose');

const EffortProjectSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    normalizedName: { type: String, required: true, trim: true, lowercase: true },
    customer: { type: String, trim: true, default: '' },
    comment: { type: String, trim: true, default: '' },
    workItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkItem', index: true },
    workItemSnapshot: {
      workNumber: { type: String, trim: true, default: '' },
      name: { type: String, trim: true, default: '' },
      customer: { type: String, trim: true, default: '' }
    },
    status: { type: String, enum: ['open', 'closed'], default: 'open', index: true },
    closedAt: { type: Date },
    closedNetMs: { type: Number, min: 0, default: 0 },
    closedGrossMs: { type: Number, min: 0, default: 0 },
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

EffortProjectSchema.index({ tenantId: 1, createdBy: 1, status: 1, updatedAt: -1 });

module.exports = mongoose.models.EffortProject || mongoose.model('EffortProject', EffortProjectSchema);
