const mongoose = require('mongoose');
const accounts = require('./accountStore');
const { clearToken } = require('./accountInvitations');
const { isLocal } = require('./mfaPolicy');
const mfaStore = require('./mfaStore');
const Session = require('../models/session');
const postgresSessions = require('../repositories/postgres/sessionRepository');
const { databaseEngine, withTransaction } = require('../postgres');

function canRecover(user) {
  return Boolean(user?.password && user.role !== 'SuperAdmin' && isLocal(user) &&
    (!user.loginMethod || user.emailVerified));
}

async function recoveryAvailable() {
  if (databaseEngine() === 'postgresql') return true;
  const topology = await mongoose.connection.db.admin().command({ hello: 1 });
  return Boolean(topology.setName || topology.msg === 'isdbgrid');
}

async function completeRecovery(user, password) {
  const userId = String(user._id);
  const apply = async (transaction) => {
    const updated = await accounts.updateAccount({
      _id: userId, email: user.email, role: user.role, loginMethod: user.loginMethod,
      tenantId: user.tenantId, azureId: user.azureId || null, emailVerified: user.emailVerified,
      password: user.password, accountTokenHash: user.accountTokenHash, accountTokenPurpose: 'recovery'
    }, { ...clearToken, password }, { ...transaction, liveToken: true });
    if (!updated) return false;
    await mfaStore.remove(userId, transaction);
    if (transaction.client) {
      await postgresSessions.revokeByUser(userId, transaction.client);
    } else {
      await Session.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date() } }, transaction);
    }
    return true;
  };

  let completed;
  if (databaseEngine() === 'postgresql') {
    completed = await withTransaction((client) => apply({ client }));
  } else {
    const session = await mongoose.startSession();
    try {
      completed = await session.withTransaction(() => apply({ session }));
    } finally {
      await session.endSession();
    }
  }
  return completed;
}

module.exports = { canRecover, recoveryAvailable, completeRecovery };
