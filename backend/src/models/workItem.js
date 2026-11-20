const { statusChange, statusJobs } = require('../services/workStatusNotifications');
const User = require('./user');
const { BILLABLE, billableNotification } = require('../services/accountingNotifications');
const Tenant = require('./tenant');
const mongoose = require('mongoose');

const WORK_STATUSES = [
  'inquiry',
  'offer',
  'to_start',
  'in_progress',
  'on_hold',
  'completed_billable',
  'invoiced',
  'paid',
  'closed',
  'cancelled',
  'lost'
];

const WorkItemSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    year: { type: Number, required: true, min: 2000, max: 9999 },
    sequenceNumber: { type: Number, required: true, min: 1 },
    workNumber: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'ClientCompany', index: true },
    customer: { type: String, trim: true, default: '' },
    entityId: { type: String, default: null },
    serviceTypeId: { type: String, default: null },
    responsibleUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    responsible: { type: String, trim: true, default: '' },
    contributors: [{ type: String, trim: true }],
    status: { type: String, enum: WORK_STATUSES, default: 'inquiry', index: true },
    deadline: { type: Date },
    description: { type: String, trim: true, default: '' },
    customFields: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    reporting: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    currency: { type: String, trim: true, uppercase: true, default: 'HUF' },
    totalAmount: { type: Number, min: 0, default: 0 },
    costAmount: { type: Number, min: 0, default: 0 },
    subcontractor: { type: String, trim: true, default: '' },
    paymentDeadlineDays: { type: Number, min: 0, default: 30 },
    offerDate: { type: Date },
    completionDate: { type: Date },
    invoiceDate: { type: Date },
    paidAt: { type: Date },
    invoicePaymentDeadline: { type: Date },
    invoiceNumber: { type: String, trim: true, default: '' },
    contractSigned: { type: Boolean, default: false },
    performanceCertificate: { type: Boolean, default: false },
    archivedAt: { type: Date },
    statusHistory: [{
      _id: false,
      changedAt: Date,
      payload: mongoose.Schema.Types.Mixed
    }],
    accountingOutbox: [{
      _id: false,
      id: String,
      payload: mongoose.Schema.Types.Mixed,
      nextAttemptAt: Date,
      attempts: Number
    }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true, optimisticConcurrency: true }
);

WorkItemSchema.index({ tenantId: 1, year: 1, sequenceNumber: 1 }, { unique: true });
WorkItemSchema.index({ tenantId: 1, status: 1, deadline: 1 });
WorkItemSchema.index({ tenantId: 1, archivedAt: 1, status: 1, deadline: 1, updatedAt: -1 });

WorkItemSchema.index({ 'accountingOutbox.nextAttemptAt': 1 }, { sparse: true });

WorkItemSchema.index({ tenantId: 1, 'statusHistory.changedAt': 1 });

WorkItemSchema.pre('save', async function () {
  if ((!this.isNew && !this.isModified('status')) || this.$locals.notificationStatus === this.status) return;
  const previous = this.isNew ? null : await this.constructor.findById(this._id)
    .select('status').session(this.$session()).lean();
  if (previous?.status === this.status) return;
  const tenant = await Tenant.findById(this.tenantId)
    .select('name displayName accountingNotifications workFieldSettings').session(this.$session()).lean();
  if (!tenant) return;

  const jobs = [];
  if (this.status === BILLABLE) {
    const event = billableNotification(tenant, this);
    if (event) jobs.push(event);
  }
  if (previous) {
    const change = statusChange(this, previous.status);
    if (this.responsibleUserId || this.contributors?.length) {
      const users = await User.find({ $or: [{ tenantId: this.tenantId }, { additionalTenantIds: this.tenantId }] })
        .select('email firstName lastName').session(this.$session()).lean();
      jobs.push(...statusJobs(change, this, tenant, users));
    }
    this.statusHistory.push({ changedAt: change.changedAt, payload: change });
  }
  this.accountingOutbox.push(...jobs.map((job) => ({ ...job, nextAttemptAt: new Date(), attempts: 0 })));
  this.$locals.notificationStatus = this.status;
});
WorkItemSchema.post('save', function () {
  delete this.$locals.notificationStatus;
});

module.exports = {
  WorkItem: mongoose.models.WorkItem || mongoose.model('WorkItem', WorkItemSchema),
  WORK_STATUSES
};
