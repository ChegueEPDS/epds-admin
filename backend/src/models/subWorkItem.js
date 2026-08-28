const mongoose = require('mongoose');
const { WORK_STATUSES } = require('./workItem');

const SubWorkItemSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true },
    workItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkItem', required: true, index: true },
    sequenceNumber: { type: Number, required: true, min: 1 },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: '' },
    responsibleUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    responsible: { type: String, trim: true, default: '' },
    contributors: [{ type: String, trim: true }],
    status: { type: String, enum: WORK_STATUSES, default: 'inquiry', index: true },
    deadline: { type: Date },
    completedAt: { type: Date },
    plannedHours: { type: Number, min: 0, default: 0 },
    amount: { type: Number, min: 0, default: 0 },
    currency: { type: String, trim: true, uppercase: true, default: 'HUF' },
    performanceCertificateRequired: { type: Boolean, default: false },
    performanceCertificateSigned: { type: Boolean, default: false },
    invoiceNumber: { type: String, trim: true, default: '' },
    invoiceDate: { type: Date },
    invoicePaymentDeadline: { type: Date },
    paidAmount: { type: Number, min: 0, default: 0 },
    paidAt: { type: Date },
    archivedAt: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

SubWorkItemSchema.index({ tenantId: 1, workItemId: 1, sequenceNumber: 1 }, { unique: true });
SubWorkItemSchema.index({ tenantId: 1, workItemId: 1, status: 1 });

module.exports = mongoose.models.SubWorkItem || mongoose.model('SubWorkItem', SubWorkItemSchema);
