const express = require('express');
const multer = require('multer');
const controller = require('../controllers/workBoardController');
const { requireAuth, requireTenantFeature, requireTenantContext } = require('../middlewares/authMiddleware');

const router = express.Router();
const documentUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

router.use('/work-board', requireAuth, requireTenantContext);

router.get('/work-board/clients', requireTenantFeature('workBoard'), controller.listClients);
router.get('/work-board/clients/lookup', requireTenantFeature('workBoard'), controller.lookupClientByTaxNumber);
router.post('/work-board/clients', requireTenantFeature('workBoard', 'edit'), controller.createOrLinkClient);
router.get('/work-board/users', requireTenantFeature('workBoard'), controller.listTenantUsers);
router.get('/work-board/works', requireTenantFeature('workBoard'), controller.listWorks);
// Effort Tracking also consumes this endpoint, so it only requires a tenant
// context rather than Work Board feature access.
router.get('/work-board/options', controller.activeOptions);
router.get('/work-board/works/:id', requireTenantFeature('workBoard'), controller.getWork);
router.post('/work-board/works', requireTenantFeature('workBoard', 'edit'), controller.createWork);
router.patch('/work-board/works/:id', requireTenantFeature('workBoard', 'edit'), controller.updateWork);
router.delete('/work-board/works/:id', requireTenantFeature('workBoard', 'delete'), controller.archiveWork);
router.post('/work-board/works/:id/sub-works', requireTenantFeature('workBoard', 'edit'), controller.createSubWork);
router.patch('/work-board/sub-works/:subWorkId', requireTenantFeature('workBoard', 'edit'), controller.updateSubWork);
router.delete('/work-board/sub-works/:subWorkId', requireTenantFeature('workBoard', 'delete'), controller.archiveSubWork);
router.get('/work-board/works/:id/documents', requireTenantFeature('workBoard'), controller.listDocuments);
router.post('/work-board/works/:id/documents', requireTenantFeature('workBoard', 'edit'), documentUpload.single('file'), controller.uploadDocument);
router.get('/work-board/documents/:documentId/file', requireTenantFeature('workBoard'), controller.downloadDocument);
router.delete('/work-board/documents/:documentId', requireTenantFeature('workBoard', 'delete'), controller.deleteDocument);

module.exports = router;
