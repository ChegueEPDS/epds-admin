const bcrypt = require('bcryptjs');
const User = require('../models/user');

const SUPERADMIN_EMAIL = 'support@epds.hu';
const SUPERADMIN_PASSWORD = 'EPDSadmin100!';
const ASSIGNABLE_ROLES = ['User', 'Admin', 'Finance'];

async function seedSuperAdmin() {
  const password = await bcrypt.hash(SUPERADMIN_PASSWORD, 12);
  const existing = await User.findOne({ email: SUPERADMIN_EMAIL });

  if (existing) {
    existing.firstName = 'Super';
    existing.lastName = 'Admin';
    existing.role = 'SuperAdmin';
    existing.password = password;
    existing.emailVerified = true;
    await existing.save();
  } else {
    await User.create({
      firstName: 'Super',
      lastName: 'Admin',
      email: SUPERADMIN_EMAIL,
      role: 'SuperAdmin',
      password,
      emailVerified: true
    });
  }

  await User.updateMany(
    { email: { $ne: SUPERADMIN_EMAIL }, role: { $nin: ASSIGNABLE_ROLES } },
    { $set: { role: 'User' } }
  );
}

module.exports = { ASSIGNABLE_ROLES, SUPERADMIN_EMAIL, seedSuperAdmin };
