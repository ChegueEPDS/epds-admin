const mongoose = require('mongoose');

const ClientCompanySchema = new mongoose.Schema(
  {
    taxNumber: { type: String, required: true, trim: true },
    normalizedTaxNumber: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true },
    country: { type: String, trim: true, default: 'HU' },
    postalCode: { type: String, trim: true, default: '' },
    city: { type: String, trim: true, default: '' },
    address: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, lowercase: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    tenantIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

ClientCompanySchema.index({ tenantIds: 1, name: 1 });

module.exports = mongoose.models.ClientCompany || mongoose.model('ClientCompany', ClientCompanySchema);
