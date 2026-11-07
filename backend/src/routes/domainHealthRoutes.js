const express = require('express');
const controller = require('../controllers/domainHealthController');
const { requireAuth, requireTenantFeature } = require('../middlewares/authMiddleware');

const router = express.Router();

router.get('/public/domain-status/:owner', requireAuth, requireTenantFeature('domainHealth'), controller.getPublicStatusReport);
router.get('/public/domain-status/:owner/pdf', requireAuth, requireTenantFeature('domainHealth'), controller.downloadPublicStatusReportPdf);
router.get('/domain-reports/:tenantId/months', requireAuth, requireTenantFeature('domainHealth'), controller.listMonthlyReports);
router.get('/domain-reports/:tenantId/:month/pdf', requireAuth, requireTenantFeature('domainHealth'), controller.downloadMonthlyReport);
router.get('/domain-health', requireAuth, requireTenantFeature('domainHealth'), controller.checkDomainHealth);
router.get('/domains', requireAuth, requireTenantFeature('domainHealth'), controller.listDomains);
router.post('/domains', requireAuth, requireTenantFeature('domainHealth', 'edit'), controller.createDomain);
router.patch('/domains/:id', requireAuth, requireTenantFeature('domainHealth', 'edit'), controller.updateDomain);
router.delete('/domains/:id', requireAuth, requireTenantFeature('domainHealth', 'delete'), controller.deleteDomain);
router.post('/domains/:id/check-now', requireAuth, requireTenantFeature('domainHealth', 'edit'), controller.checkDomainNow);
router.get('/domains/:id/pagespeed', requireAuth, requireTenantFeature('domainHealth'), controller.getDomainPageSpeed);
router.post('/domains/:id/pagespeed', requireAuth, requireTenantFeature('domainHealth', 'edit'), controller.deepScanDomain);
router.post('/domains/:id/deep-scan', requireAuth, requireTenantFeature('domainHealth', 'edit'), controller.deepScanDomain);
router.get('/domains/:id/checks', requireAuth, requireTenantFeature('domainHealth'), controller.getDomainChecks);

module.exports = router;
