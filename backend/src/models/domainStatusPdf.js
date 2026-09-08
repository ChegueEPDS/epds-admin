const mongoose = require('mongoose');

const DomainStatusPdfSchema = new mongoose.Schema({
  ownerSlug: { type: String, required: true },
  reportDate: { type: String, required: true },
  reportGeneratedAt: { type: Date, required: true },
  content: { type: Buffer, required: true },
  size: { type: Number, required: true },
  etag: { type: String, required: true },
  expiresAt: { type: Date, required: true }
}, { timestamps: true });

DomainStatusPdfSchema.index({ ownerSlug: 1, reportDate: 1 }, { unique: true });
DomainStatusPdfSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.DomainStatusPdf || mongoose.model('DomainStatusPdf', DomainStatusPdfSchema);
