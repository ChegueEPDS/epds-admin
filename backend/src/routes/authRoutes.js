const rateLimit = require('express-rate-limit');
const express = require('express');
const controller = require('../controllers/authController');
const mfa = require('../controllers/mfaController');
const { requireSessionAuth } = require('../middlewares/authMiddleware');

const router = express.Router();

const accountLinkLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20 });
router.post('/auth/invitation', accountLinkLimiter, controller.invitationDetails);
router.post('/auth/password-reset', rateLimit({ windowMs: 15 * 60 * 1000, limit: 5 }), controller.requestPasswordReset);
router.post('/auth/set-password', accountLinkLimiter, controller.setPassword);

router.post('/microsoft-login', controller.microsoftLogin);
const verificationLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60 });
router.post('/login', verificationLimiter, controller.login);
router.post('/auth/mfa/login/setup', verificationLimiter, mfa.loginSetup);
router.post('/auth/mfa/login/confirm', verificationLimiter, mfa.loginConfirm);
router.post('/auth/mfa/login/verify', verificationLimiter, mfa.loginVerify);
router.post('/auth/mfa/login/passkey', verificationLimiter, mfa.loginPasskey);
router.get('/auth/mfa', requireSessionAuth, mfa.status);
router.post('/auth/mfa/dismiss', requireSessionAuth, mfa.dismiss);
router.post('/auth/mfa/setup', verificationLimiter, requireSessionAuth, mfa.profileSetup);
router.post('/auth/mfa/confirm', verificationLimiter, requireSessionAuth, mfa.profileConfirm);
router.post('/auth/mfa/recovery', verificationLimiter, requireSessionAuth, mfa.profileRecovery);
router.post('/auth/mfa/disable', verificationLimiter, requireSessionAuth, mfa.profileDisable);
router.post('/auth/mfa/passkey', verificationLimiter, requireSessionAuth, mfa.profilePasskey);
router.post('/auth/mfa/passkey/confirm', verificationLimiter, requireSessionAuth, mfa.profilePasskeyConfirm);
router.post('/auth/mfa/passkey/remove', verificationLimiter, requireSessionAuth, mfa.profilePasskeyRemove);
router.post('/renew-token', controller.renewToken);
router.post('/auth/refresh', controller.renewToken);
router.post('/logout', requireSessionAuth, controller.logout);
router.get('/auth/me', requireSessionAuth, controller.me);
router.get('/auth/session', requireSessionAuth, controller.me);

module.exports = router;
