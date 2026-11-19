const store = require('./mfaStore');

const requiredRoles = new Set(['SuperAdmin', 'Admin', 'Finance']);
const isLocal = (user) => user.loginMethod !== 'microsoft' && (!user.azureId || user.loginMethod === 'password');
const required = (user) => isLocal(user) && requiredRoles.has(user.role);

async function checkSession(user, session) {
  if (!isLocal(user)) return;
  const { state } = await store.read(user._id);
  if (state.secret ? !state.version || session.mfaVersion !== state.version : required(user) || session.mfaVersion) {
    throw new Error('A new sign-in with two-step verification is required');
  }
}

module.exports = { isLocal, required, checkSession };
