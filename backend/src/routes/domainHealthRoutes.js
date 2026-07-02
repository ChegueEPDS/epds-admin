const express = require('express');
const controller = require('../controllers/domainHealthController');
const { requireAuth } = require('../middlewares/authMiddleware');

const router = express.Router();

router.get('/domain-health', requireAuth, controller.checkDomainHealth);
router.get('/domains', requireAuth, controller.listDomains);
router.post('/domains', requireAuth, controller.createDomain);
router.patch('/domains/:id', requireAuth, controller.updateDomain);
router.delete('/domains/:id', requireAuth, controller.deleteDomain);
router.post('/domains/:id/check-now', requireAuth, controller.checkDomainNow);
router.get('/domains/:id/checks', requireAuth, controller.getDomainChecks);

module.exports = router;
