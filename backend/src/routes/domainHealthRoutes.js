const express = require('express');
const controller = require('../controllers/domainHealthController');
const { requireAuth } = require('../middlewares/authMiddleware');

const router = express.Router();

router.get('/public/domain-status/:owner', controller.getPublicStatusReport);
router.get('/public/domain-status/:owner/pdf', controller.downloadPublicStatusReportPdf);
router.get('/domain-health', requireAuth, controller.checkDomainHealth);
router.get('/domains', requireAuth, controller.listDomains);
router.post('/domains', requireAuth, controller.createDomain);
router.patch('/domains/:id', requireAuth, controller.updateDomain);
router.delete('/domains/:id', requireAuth, controller.deleteDomain);
router.post('/domains/:id/check-now', requireAuth, controller.checkDomainNow);
router.get('/domains/:id/pagespeed', requireAuth, controller.getDomainPageSpeed);
router.post('/domains/:id/pagespeed', requireAuth, controller.deepScanDomain);
router.post('/domains/:id/deep-scan', requireAuth, controller.deepScanDomain);
router.get('/domains/:id/checks', requireAuth, controller.getDomainChecks);

module.exports = router;
