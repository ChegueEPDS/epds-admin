const webauthn = require('@simplewebauthn/server');

function configuredContext() {
  const configured = process.env.MFA_WEBAUTHN_ORIGIN || process.env.EPDS_ADMIN_PUBLIC_URL;
  if (!configured) return null;
  const url = new URL(configured);
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && local && url.protocol === 'http:')) {
    return null;
  }
  return { origin: url.origin, rpId: url.hostname };
}

function context(req) {
  const configured = configuredContext();
  const origin = req.get('origin');
  return !origin || origin === configured?.origin ? configured : null;
}

const credentials = (state, relyingParty) =>
  (state.passkeys || []).filter((key) => key.rpId === relyingParty?.rpId);

async function options(user, keys, relyingParty, registration) {
  const descriptors = keys.map(({ id, transports }) => ({ id, transports }));
  if (!registration) {
    return webauthn.generateAuthenticationOptions({
      rpID: relyingParty.rpId, allowCredentials: descriptors, userVerification: 'required', timeout: 120000
    });
  }
  return webauthn.generateRegistrationOptions({
    rpName: 'EPDS Admin', rpID: relyingParty.rpId,
    userID: Buffer.from(String(user._id)), userName: user.email,
    excludeCredentials: descriptors, attestationType: 'none', timeout: 120000,
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' }
  });
}

async function verify(response, pending, key) {
  const expected = {
    response, expectedChallenge: pending.challenge, expectedOrigin: pending.origin,
    expectedRPID: pending.rpId, requireUserVerification: true
  };
  if (!key) return webauthn.verifyRegistrationResponse({ ...expected, requireUserPresence: true });
  return webauthn.verifyAuthenticationResponse({
    ...expected,
    credential: { ...key, publicKey: Buffer.from(key.publicKey, 'base64url') }
  });
}

module.exports = { configuredContext, context, credentials, options, verify };
