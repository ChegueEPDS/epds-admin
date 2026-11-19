const rateLimit = require('express-rate-limit');
const express = require('express');
const controller = require('../controllers/authController');
const { requireSessionAuth } = require('../middlewares/authMiddleware');

const router = express.Router();

const accountLinkLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20 });
router.post('/auth/invitation', accountLinkLimiter, controller.invitationDetails);
router.post('/auth/password-reset', rateLimit({ windowMs: 15 * 60 * 1000, limit: 5 }), controller.requestPasswordReset);
router.post('/auth/set-password', accountLinkLimiter, controller.setPassword);

router.post('/microsoft-login', controller.microsoftLogin);
router.post('/login', controller.login);
router.post('/renew-token', controller.renewToken);
router.post('/auth/refresh', controller.renewToken);
router.post('/logout', requireSessionAuth, controller.logout);
router.get('/auth/me', requireSessionAuth, controller.me);
router.get('/auth/session', requireSessionAuth, controller.me);

module.exports = router;
