const path = require('node:path');
const readline = require('node:readline/promises');
const { Writable } = require('node:stream');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { SUPERADMIN_EMAIL } = require('../src/services/accountRoles');
const { databaseEngine, closePostgres, query, withTransaction } = require('../src/postgres');
const mfaStore = require('../src/services/mfaStore');
const { isLocal } = require('../src/services/mfaPolicy');
const accounts = require('../src/services/accountStore');
const { sendAccountLink, normalizeEmail, validEmail } = require('../src/services/accountInvitations');
const User = require('../src/models/user');
const Session = require('../src/models/session');

class SetupError extends Error {}

// A shared ID prevents two concurrent bootstrap commands with different emails
// from creating separate privileged accounts.
const bootstrapId = '6759859ea851fb820765ab77';

async function invite(engine, email) {
  const postgres = engine === 'postgresql';
  const existing = postgres
    ? (await query("SELECT id AS _id FROM users WHERE role='SuperAdmin' AND id<>$1 LIMIT 1", [bootstrapId])).rows[0]
    : await User.exists({ role: 'SuperAdmin', _id: { $ne: bootstrapId } });
  if (existing) throw new SetupError('A SuperAdmin already exists. Use rotate for the existing local account.');

  let account = await accounts.findById(bootstrapId);
  if (!account) {
    try {
      if (postgres) {
        await query(`
          INSERT INTO users (id, email, first_name, last_name, role, login_method, email_verified, created_at, updated_at)
          VALUES ($1, $2, 'Super', 'Admin', 'SuperAdmin', 'password', false, now(), now())
          ON CONFLICT DO NOTHING`, [bootstrapId, email]);
      } else {
        await User.init();
        await User.create({ _id: bootstrapId, email, firstName: 'Super', lastName: 'Admin',
          role: 'SuperAdmin', loginMethod: 'password', emailVerified: false });
      }
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
    account = await accounts.findById(bootstrapId);
  }
  if (!account || account.email !== email || account.role !== 'SuperAdmin' ||
      account.loginMethod !== 'password' || account.emailVerified || account.password ||
      account.tenantId || account.azureId) {
    throw new SetupError('Cannot invite. Check for an existing SuperAdmin or an account using this email.');
  }

  if (!await sendAccountLink(account, 'invite')) {
    throw new SetupError('Invitation could not be sent. Check mail settings and retry the invite command.');
  }
  console.log('SuperAdmin invitation accepted for delivery. The link expires in 30 minutes.');
}

async function promptPassword() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new SetupError('An interactive terminal is required.');
  }

  // A private output stream suppresses all terminal echoes, including pasted input.
  const output = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const terminal = readline.createInterface({
    input: process.stdin, output, terminal: true, historySize: 0
  });
  const abort = new AbortController();
  terminal.on('SIGINT', () => abort.abort());
  async function ask(label) {
    process.stdout.write(label);
    try {
      return await terminal.question('', { signal: abort.signal });
    } finally {
      process.stdout.write('\n');
    }
  }

  try {
    const password = await ask('New password: ');
    if (password.length < 16 || Buffer.byteLength(password) > 72) {
      throw new SetupError('Use a unique password of at least 16 characters and at most 72 UTF-8 bytes.');
    }
    if (password !== await ask('Confirm new password: ')) {
      throw new SetupError('The passwords do not match.');
    }
    return password;
  } finally {
    terminal.close();
  }
}

function checkAccount(account, password, otherUser) {
  const matchingRole = otherUser ? account?.role !== 'SuperAdmin' : account?.role === 'SuperAdmin';
  if (!account || !matchingRole || !(account.emailVerified ?? account.email_verified) || !isLocal({
    loginMethod: account.loginMethod ?? account.login_method, azureId: account.azureId ?? account.azure_id
  })) {
    throw new SetupError('The active local account for this command was not found. Check the target database and email.');
  }
  if (account.password && bcrypt.compareSync(password, account.password)) {
    throw new SetupError('Choose a different password from the current one.');
  }
}

async function updatePostgres(email, password, hash, { resetMfa, otherUser }) {
  return withTransaction(async (client) => {
    const { rows: [account] } = await client.query(
      'SELECT id, role, login_method, azure_id, password, email_verified FROM users WHERE email=$1 FOR UPDATE', [email]
    );
    checkAccount(account, password, otherUser);
    await client.query(`
      UPDATE users SET password=$2, email_verified=true, account_token_hash=NULL,
        account_token_purpose=NULL, account_token_expires_at=NULL, updated_at=now()
      WHERE id=$1`, [account.id, hash]);
    const result = await client.query(
      'UPDATE sessions SET revoked_at=now(), updated_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [account.id]
    );
    if (resetMfa) await mfaStore.remove(account.id, { client });
    return result.rowCount;
  });
}

async function updateMongo(email, password, hash, { resetMfa, otherUser }) {
  const transaction = await mongoose.startSession();
  try {
    return await transaction.withTransaction(async () => {
      const account = await User.findOne({ email }).session(transaction);
      checkAccount(account, password, otherUser);
      account.set({ password: hash, emailVerified: true, accountTokenHash: null,
        accountTokenPurpose: null, accountTokenExpiresAt: null });
      await account.save({ session: transaction });
      const result = await Session.updateMany({ userId: account._id, revokedAt: null },
        { $set: { revokedAt: new Date() } }, { session: transaction });
      if (resetMfa) await mfaStore.remove(account._id, { session: transaction });
      return result.modifiedCount;
    });
  } finally {
    await transaction.endSession();
  }
}

async function main() {
  const [mode, ...extra] = process.argv.slice(2);
  const otherUser = mode === 'reset-user-mfa' && extra.length === 1;
  const resetMfa = otherUser || (mode === 'rotate' && extra.length === 1 && extra[0] === '--reset-mfa');
  if (!(otherUser || (mode === 'rotate' && (extra.length === 0 || resetMfa)) || (mode === 'invite' && !extra.length))) {
    throw new SetupError('Usage: node scripts/superadmin.js invite | rotate [--reset-mfa] | reset-user-mfa <email>');
  }
  const engine = databaseEngine();
  if (!['postgresql', 'mongodb'].includes(engine)) throw new SetupError('Unsupported DATABASE_ENGINE.');
  const email = normalizeEmail(otherUser ? extra[0] :
    process.env.EPDS_ADMIN_SUPERADMIN_EMAIL || (mode === 'rotate' ? SUPERADMIN_EMAIL : ''));
  if (!validEmail(email)) throw new SetupError('Set EPDS_ADMIN_SUPERADMIN_EMAIL to a valid email address.');

  if (engine === 'mongodb') {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!uri) throw new SetupError('Missing MONGODB_URI.');
    await mongoose.connect(uri);
  }
  console.log(`Account security: ${mode} for ${email} on ${engine}`);
  if (mode === 'invite') return invite(engine, email);

  const password = await promptPassword();
  const hash = await bcrypt.hash(password, 12);
  const revoked = await (engine === 'postgresql' ? updatePostgres : updateMongo)(email, password, hash, { resetMfa, otherUser });
  console.log(`Account security: ${mode} completed. Revoked sessions: ${revoked}.`);
  if (resetMfa) console.log('Authentication methods cleared. Mandatory accounts must enroll at next sign-in.');
}

main().catch((error) => {
  // Driver errors can carry connection details and SQL parameters.
  console.error(error instanceof SetupError ? error.message :
    'SuperAdmin operation failed. Check the database connection, schema, public URL and transaction support.');
  process.exitCode = 1;
}).finally(async () => {
  await Promise.all([closePostgres(), mongoose.disconnect()]);
});
