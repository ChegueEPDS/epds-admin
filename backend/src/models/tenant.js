const mongoose = require('mongoose');

const TenantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, lowercase: true, unique: true },
    type: { type: String, enum: ['personal', 'company'], required: true },
    plan: { type: String, enum: ['free', 'pro', 'team'], required: true },
    ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    seats: {
      max: { type: Number, default: 0, min: 0 },
      used: { type: Number, default: 0, min: 0 }
    },
    seatsManaged: { type: String, enum: ['stripe', 'manual'], default: 'stripe' },
    features: {
      maintenance: { type: Boolean, default: false },
      professionRbac: { type: Boolean, default: false },
      groupRbac: { type: Boolean, default: false },
      customFields: { type: Boolean, default: false },
      customSchemas: { type: Boolean, default: false },
      documentation: { type: Boolean, default: false }
    },
    professionRbacEnabled: { type: Boolean, default: false, index: true }
  },
  { timestamps: true }
);

module.exports = mongoose.models.Tenant || mongoose.model('Tenant', TenantSchema);
