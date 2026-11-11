const mongoose = require('mongoose');
const { DEFAULT_WORK_TURNOVER_DAY, isWorkTurnoverDay } = require('../services/workTurnover');

const FeatureAccessSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    edit: { type: Boolean, default: false },
    delete: { type: Boolean, default: false }
  },
  { _id: false }
);

const TenantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, lowercase: true, unique: true },
    displayName: { type: String, trim: true },
    type: { type: String, enum: ['company', 'client', 'finance'], default: 'company', required: true },
    ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    seats: {
      max: { type: Number, default: 0, min: 0 },
      used: { type: Number, default: 0, min: 0 }
    },
    seatsManaged: { type: String, enum: ['stripe', 'manual'], default: 'stripe' },
    workFieldSettings: { type: mongoose.Schema.Types.Mixed },
    defaultCurrency: { type: String, default: 'HUF', match: /^[A-Z]{3}$/ },
    workTurnoverDay: { type: String, default: DEFAULT_WORK_TURNOVER_DAY, required: true, validate: isWorkTurnoverDay },
    alignWorkSequence: { type: Boolean, default: false },
    features: {
      mail: { type: FeatureAccessSchema, default: () => ({}) },
      domainHealth: { type: FeatureAccessSchema, default: () => ({}) },
      licenses: { type: FeatureAccessSchema, default: () => ({}) },
      effortTracking: { type: FeatureAccessSchema, default: () => ({}) },
      workBoard: { type: FeatureAccessSchema, default: () => ({}) },
      financeAccess: { type: FeatureAccessSchema, default: undefined },
      webhookTester: { type: FeatureAccessSchema, default: () => ({}) }
    },
    professionRbacEnabled: { type: Boolean, default: false, index: true }
  },
  { timestamps: true }
);

module.exports = mongoose.models.Tenant || mongoose.model('Tenant', TenantSchema);
