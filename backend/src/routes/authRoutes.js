const express = require('express');
const controller = require('../controllers/authController');
const { requireSessionAuth } = require('../middlewares/authMiddleware');

const router = express.Router();

router.post('/microsoft-login', controller.microsoftLogin);
router.post('/login', controller.login);
router.post('/renew-token', controller.renewToken);
router.post('/auth/refresh', controller.renewToken);
router.post('/logout', requireSessionAuth, controller.logout);
router.get('/auth/me', requireSessionAuth, controller.me);
router.get('/auth/session', requireSessionAuth, controller.me);

module.exports = router;
