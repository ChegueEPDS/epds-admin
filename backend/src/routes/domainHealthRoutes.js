const express = require('express');
const controller = require('../controllers/domainHealthController');
const { requireAuth, requireEpdsEmail } = require('../middlewares/authMiddleware');

const router = express.Router();

router.get('/domain-health', requireAuth, requireEpdsEmail, controller.checkDomainHealth);

module.exports = router;
