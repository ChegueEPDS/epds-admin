const mongoose = require('mongoose');

const ScheduledJobLeaseSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, index: true },
  holder: { type: String, required: true },
  lockedUntil: { type: Date, required: true, index: true }
}, { timestamps: true });

module.exports = mongoose.models.ScheduledJobLease || mongoose.model('ScheduledJobLease', ScheduledJobLeaseSchema);
