const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  _id: String,
  payload: mongoose.Schema.Types.Mixed,
  nextAttemptAt: Date,
  attempts: Number,
  sentAt: Date
});
schema.index({ sentAt: 1, nextAttemptAt: 1 });

module.exports = mongoose.models.WeeklyWorkSummary || mongoose.model('WeeklyWorkSummary', schema);
