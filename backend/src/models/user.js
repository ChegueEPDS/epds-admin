const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema(
  {
    azureId: { type: String, unique: true, sparse: true },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    nickname: { type: String },
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true },
    role: { type: String, enum: ['User', 'Admin', 'SuperAdmin'], default: 'User', required: true },
    professions: [{ type: String }],
    password: { type: String },
    emailVerified: { type: Boolean, default: true },
    lastLoginAt: { type: Date, index: true }
  },
  { timestamps: true }
);

UserSchema.methods.toJSON = function toJSON() {
  const obj = this.toObject({ virtuals: true });
  delete obj.password;
  return obj;
};

module.exports = mongoose.models.User || mongoose.model('User', UserSchema);
