const { createHash, randomBytes } = require('node:crypto');
const mail = require('./mailService');
const { accountMail } = require('./mailTemplates');
const { updateAccount, findById } = require('./accountStore');

const clearToken = { accountTokenHash: null, accountTokenPurpose: null, accountTokenExpiresAt: null };
const digest = (value) => createHash('sha256').update(value).digest('hex');
const normalizeEmail = (value) => typeof value === 'string' ? value.trim().toLowerCase() : '';
const validEmail = (email) => email.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email);
const validPassword = (value) => typeof value === 'string' && value.length >= 8 && Buffer.byteLength(value) <= 72;
const validToken = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

async function sendAccountLink(user, purpose, language = 'en') {
  const origin = process.env.EPDS_ADMIN_PUBLIC_URL || process.env.CORS_ALLOWED_ORIGINS?.split(',')[0]?.trim();
  const url = new URL('/login', new URL(origin).origin);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
    throw new Error('Invalid public application URL');
  }
  const token = randomBytes(32).toString('hex');
  const reset = purpose === 'reset';
  const recovery = purpose === 'recovery';
  const shortLived = reset || recovery || user.role === 'SuperAdmin';
  const minutes = shortLived ? 30 : 72 * 60;
  const accountTokenHash = digest(token);
  const saved = await updateAccount({
    _id: String(user._id), email: user.email, role: user.role, tenantId: user.tenantId,
    emailVerified: user.emailVerified, azureId: user.azureId || null,
    accountTokenHash: user.accountTokenHash || null, loginMethod: user.loginMethod,
    password: user.password || null
  }, {
    accountTokenHash, accountTokenPurpose: purpose,
    accountTokenExpiresAt: new Date(Date.now() + minutes * 60000)
  });
  if (!saved) return false;
  url.hash = new URLSearchParams({ [purpose]: token, account: String(user._id) }).toString();
  const microsoft = user.loginMethod === 'microsoft';
  const type = recovery ? 'account-recovery' : reset ? 'password-reset' :
    user.role === 'SuperAdmin' ? 'invite-superadmin' : microsoft ? 'invite-microsoft' : 'invite-password';
  try {
    await mail.sendMail({
      to: user.email,
      ...accountMail(type, url.href, shortLived ? '30 minutes' : '72 hours', microsoft, language)
    });
  } catch {
    // Clear only this attempt. Another request may already have issued a replacement.
    await updateAccount({ _id: String(user._id), accountTokenHash }, clearToken);
    return false;
  }
  return true;
}

async function tokenAccount(account, token, purpose) {
  if (!validToken(token)) return null;
  const user = await findById(account);
  return user?.accountTokenHash === digest(token) && user.accountTokenPurpose === purpose &&
    new Date(user.accountTokenExpiresAt) > new Date() ? user : null;
}

module.exports = { sendAccountLink, tokenAccount, clearToken, normalizeEmail, validEmail, validPassword };
