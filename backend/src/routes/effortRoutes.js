const express = require('express');
const controller = require('../controllers/effortControllerFacade');
const { listTenantUsers } = require('../controllers/workBoardControllerFacade');
const { requireAuth, requireTenantContext, requireTenantFeature } = require('../middlewares/authMiddleware');

const router = express.Router();

router.get('/effort/assignees', requireAuth, requireTenantContext, requireTenantFeature('effortTracking'), listTenantUsers);
router.get('/effort/projects', requireAuth, requireTenantFeature('effortTracking'), controller.listProjects);
router.post('/effort/projects', requireAuth, requireTenantFeature('effortTracking', 'edit'), controller.createProject);
router.get('/effort/projects/:id', requireAuth, requireTenantFeature('effortTracking'), controller.getProject);
router.patch('/effort/projects/:id', requireAuth, requireTenantFeature('effortTracking', 'edit'), controller.updateProject);
router.delete('/effort/projects/:id', requireAuth, requireTenantFeature('effortTracking', 'delete'), controller.deleteProject);
router.post('/effort/projects/:id/close', requireAuth, requireTenantFeature('effortTracking', 'edit'), controller.closeProject);
router.post('/effort/projects/:id/reopen', requireAuth, requireTenantFeature('effortTracking', 'edit'), controller.reopenProject);
router.post('/effort/projects/:id/tasks', requireAuth, requireTenantFeature('effortTracking', 'edit'), controller.createTask);
router.patch('/effort/tasks/:taskId', requireAuth, requireTenantFeature('effortTracking', 'edit'), controller.updateTask);
router.delete('/effort/tasks/:taskId', requireAuth, requireTenantFeature('effortTracking', 'delete'), controller.deleteTask);
router.post('/effort/tasks/:taskId/start', requireAuth, requireTenantFeature('effortTracking', 'edit'), controller.startTask);
router.post('/effort/tasks/:taskId/stop', requireAuth, requireTenantFeature('effortTracking', 'edit'), controller.stopTask);
router.post('/effort/tasks/:taskId/close', requireAuth, requireTenantFeature('effortTracking', 'edit'), controller.closeTask);

module.exports = router;
