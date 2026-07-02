const express = require('express');
const controller = require('../controllers/domainHealthController');
const { requireAuth, requireEpdsEmail } = require('../middlewares/authMiddleware');

const router = express.Router();

router.get('/domain-health', requireAuth, requireEpdsEmail, controller.checkDomainHealth);
router.get('/domains', requireAuth, requireEpdsEmail, controller.listDomains);
router.post('/domains', requireAuth, requireEpdsEmail, controller.createDomain);
router.patch('/domains/:id', requireAuth, requireEpdsEmail, controller.updateDomain);
router.delete('/domains/:id', requireAuth, requireEpdsEmail, controller.deleteDomain);
router.post('/domains/:id/check-now', requireAuth, requireEpdsEmail, controller.checkDomainNow);
router.get('/domains/:id/checks', requireAuth, requireEpdsEmail, controller.getDomainChecks);

module.exports = router;
