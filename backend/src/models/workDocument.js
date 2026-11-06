const mongoose = require('mongoose');

const WORK_DOCUMENT_CATEGORIES = ['offer', 'contract_draft', 'contract', 'order', 'performance_certificate', 'other'];

const WorkDocumentSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    workItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkItem', required: true, index: true },
    category: { type: String, enum: WORK_DOCUMENT_CATEGORIES, required: true },
    displayName: { type: String, required: true, trim: true },
    fileName: { type: String, required: true, trim: true },
    storageKey: { type: String, required: true },
    contentType: { type: String, trim: true, default: 'application/octet-stream' },
    size: { type: Number, min: 0, default: 0 },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    uploadedByName: { type: String, trim: true, default: '' }
  },
  { timestamps: true }
);

WorkDocumentSchema.index({ tenantId: 1, workItemId: 1, createdAt: -1 });

module.exports = {
  WorkDocument: mongoose.models.WorkDocument || mongoose.model('WorkDocument', WorkDocumentSchema),
  WORK_DOCUMENT_CATEGORIES
};
