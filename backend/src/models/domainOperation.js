const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  kind: { type: String, required: true },
  tenantId: { type: String, required: true, index: true },
  month: String,
  payload: mongoose.Schema.Types.Mixed,
  content: Buffer,
  sentAt: Date,
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: Date.now },
  lastError: String
}, { timestamps: true });
module.exports = mongoose.models.DomainOperation || mongoose.model('DomainOperation', schema);
