const express = require('express');
const multer = require('multer');
const controller = require('../controllers/workBoardControllerFacade');
const { projectTrackerWorkPolicy } = require('../middlewares/projectTrackerWorkPolicy');
const { requireAuth, requireTenantFeature, requireTenantContext } = require('../middlewares/authMiddleware');

const router = express.Router();
const documentUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

router.use('/work-board', requireAuth, requireTenantContext);

router.get('/work-board/clients', requireTenantFeature('workBoard'), controller.listClients);
router.get('/work-board/clients/lookup', requireTenantFeature('workBoard'), controller.lookupClientByTaxNumber);
router.post('/work-board/clients', requireTenantFeature('workBoard', 'edit'), controller.createOrLinkClient);
router.get('/work-board/users', requireTenantFeature('workBoard'), controller.listTenantUsers);
router.get('/work-board/works', requireTenantFeature('workBoard'), controller.listWorks);
// Effort Tracking and Work Board use the same work selector.
router.get('/work-board/options', (req, res, next) => {
  if (req.scope.tenantType === 'client' || !req.scope.tenantFeatures?.workBoard?.enabled && !req.scope.tenantFeatures?.effortTracking?.enabled) {
    return res.status(403).json({ error: 'Work Board or Effort Tracking access is required' });
  }
  return controller.activeOptions(req, res, next);
});
router.get('/work-board/works/:id', requireTenantFeature('workBoard'), controller.getWork);
router.post('/work-board/works', requireTenantFeature('workBoard', 'edit'), projectTrackerWorkPolicy('workCreate'), controller.createWork);
router.patch('/work-board/works/:id', requireTenantFeature('workBoard', 'edit'), projectTrackerWorkPolicy('workEdit'), controller.updateWork);
router.delete('/work-board/works/:id', requireTenantFeature('workBoard', 'delete'), controller.archiveWork);
router.post('/work-board/works/:id/restore', requireTenantFeature('workBoard', 'delete'), controller.restoreWork);
router.post('/work-board/works/:id/sub-works', requireTenantFeature('workBoard', 'edit'), projectTrackerWorkPolicy('subCreate'), controller.createSubWork);
router.patch('/work-board/sub-works/:subWorkId', requireTenantFeature('workBoard', 'edit'), projectTrackerWorkPolicy('subEdit'), controller.updateSubWork);
router.delete('/work-board/sub-works/:subWorkId', requireTenantFeature('workBoard', 'delete'), controller.archiveSubWork);
router.get('/work-board/works/:id/documents', requireTenantFeature('workBoard'), controller.listDocuments);
router.post('/work-board/works/:id/documents', requireTenantFeature('workBoard', 'edit'), documentUpload.single('file'), controller.uploadDocument);
router.get('/work-board/documents/:documentId/file', requireTenantFeature('workBoard'), controller.downloadDocument);
router.delete('/work-board/documents/:documentId', requireTenantFeature('workBoard', 'delete'), controller.deleteDocument);

module.exports = router;
