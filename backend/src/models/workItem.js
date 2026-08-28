const mongoose = require('mongoose');

const WORK_STATUSES = [
  'inquiry',
  'offer',
  'in_progress',
  'completed_billable',
  'invoiced',
  'paid',
  'closed',
  'cancelled'
];

const WorkItemSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true },
    year: { type: Number, required: true, min: 2000, max: 9999 },
    sequenceNumber: { type: Number, required: true, min: 1 },
    workNumber: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'ClientCompany', index: true },
    customer: { type: String, trim: true, default: '' },
    responsibleUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    responsible: { type: String, trim: true, default: '' },
    contributors: [{ type: String, trim: true }],
    status: { type: String, enum: WORK_STATUSES, default: 'inquiry', index: true },
    deadline: { type: Date },
    description: { type: String, trim: true, default: '' },
    currency: { type: String, trim: true, uppercase: true, default: 'HUF' },
    totalAmount: { type: Number, min: 0, default: 0 },
    costAmount: { type: Number, min: 0, default: 0 },
    subcontractor: { type: String, trim: true, default: '' },
    paymentDeadlineDays: { type: Number, min: 0, default: 30 },
    offerDate: { type: Date },
    completionDate: { type: Date },
    invoiceDate: { type: Date },
    invoicePaymentDeadline: { type: Date },
    invoiceNumber: { type: String, trim: true, default: '' },
    contractSigned: { type: Boolean, default: false },
    performanceCertificate: { type: Boolean, default: false },
    archivedAt: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

WorkItemSchema.index({ tenantId: 1, year: 1, sequenceNumber: 1 }, { unique: true });
WorkItemSchema.index({ tenantId: 1, status: 1, deadline: 1 });

module.exports = {
  WorkItem: mongoose.models.WorkItem || mongoose.model('WorkItem', WorkItemSchema),
  WORK_STATUSES
};
