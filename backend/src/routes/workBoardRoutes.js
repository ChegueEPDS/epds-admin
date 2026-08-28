const express = require('express');
const controller = require('../controllers/workBoardController');
const { requireAuth, requireTenantFeature } = require('../middlewares/authMiddleware');

const router = express.Router();

router.get('/work-board/clients', requireAuth, requireTenantFeature('workBoard'), controller.listClients);
router.get('/work-board/clients/lookup', requireAuth, requireTenantFeature('workBoard'), controller.lookupClientByTaxNumber);
router.post('/work-board/clients', requireAuth, requireTenantFeature('workBoard', 'edit'), controller.createOrLinkClient);
router.get('/work-board/users', requireAuth, requireTenantFeature('workBoard'), controller.listTenantUsers);
router.get('/work-board/works', requireAuth, requireTenantFeature('workBoard'), controller.listWorks);
router.get('/work-board/options', requireAuth, controller.activeOptions);
router.get('/work-board/works/:id', requireAuth, requireTenantFeature('workBoard'), controller.getWork);
router.post('/work-board/works', requireAuth, requireTenantFeature('workBoard', 'edit'), controller.createWork);
router.patch('/work-board/works/:id', requireAuth, requireTenantFeature('workBoard', 'edit'), controller.updateWork);
router.delete('/work-board/works/:id', requireAuth, requireTenantFeature('workBoard', 'delete'), controller.archiveWork);
router.post('/work-board/works/:id/sub-works', requireAuth, requireTenantFeature('workBoard', 'edit'), controller.createSubWork);
router.patch('/work-board/sub-works/:subWorkId', requireAuth, requireTenantFeature('workBoard', 'edit'), controller.updateSubWork);
router.delete('/work-board/sub-works/:subWorkId', requireAuth, requireTenantFeature('workBoard', 'delete'), controller.archiveSubWork);

module.exports = router;
