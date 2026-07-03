const mongoose = require('mongoose');

const EffortSessionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    startedAt: { type: Date, required: true },
    stoppedAt: { type: Date },
    durationMs: { type: Number, min: 0, default: 0 }
  },
  { _id: false }
);

const EffortTaskSchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'EffortProject', required: true, index: true },
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true },
    name: { type: String, required: true, trim: true },
    note: { type: String, trim: true, default: '' },
    status: { type: String, enum: ['open', 'closed'], default: 'open', index: true },
    sessions: [EffortSessionSchema],
    activeTimer: {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
      startedAt: { type: Date }
    },
    closedAt: { type: Date },
    closedNetMs: { type: Number, min: 0, default: 0 },
    closedGrossMs: { type: Number, min: 0, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

EffortTaskSchema.index({ tenantId: 1, projectId: 1, status: 1, updatedAt: -1 });
EffortTaskSchema.index({ tenantId: 1, 'activeTimer.userId': 1 });

module.exports = mongoose.models.EffortTask || mongoose.model('EffortTask', EffortTaskSchema);
