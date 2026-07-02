const express = require('express');
const controller = require('../controllers/authController');
const { requireAuth } = require('../middlewares/authMiddleware');

const router = express.Router();

router.post('/microsoft-login', controller.microsoftLogin);
router.post('/renew-token', controller.renewToken);
router.post('/auth/refresh', controller.renewToken);
router.post('/logout', requireAuth, controller.logout);
router.get('/auth/me', requireAuth, controller.me);
router.get('/auth/session', requireAuth, controller.me);

module.exports = router;
