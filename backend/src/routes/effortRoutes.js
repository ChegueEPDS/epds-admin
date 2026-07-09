const express = require('express');
const controller = require('../controllers/effortController');
const { requireAuth, requireTenantFeature } = require('../middlewares/authMiddleware');

const router = express.Router();

router.get('/effort/projects', requireAuth, requireTenantFeature('effortTracking'), controller.listProjects);
router.post('/effort/projects', requireAuth, requireTenantFeature('effortTracking', 'edit'), controller.createProject);
router.get('/effort/projects/:id', requireAuth, requireTenantFeature('effortTracking'), controller.getProject);
router.patch('/effort/projects/:id', requireAuth, requireTenantFeature('effortTracking', 'edit'), controller.updateProject);
router.post('/effort/projects/:id/close', requireAuth, requireTenantFeature('effortTracking', 'edit'), controller.closeProject);
router.post('/effort/projects/:id/reopen', requireAuth, requireTenantFeature('effortTracking', 'edit'), controller.reopenProject);
router.post('/effort/projects/:id/tasks', requireAuth, requireTenantFeature('effortTracking', 'edit'), controller.createTask);
router.patch('/effort/tasks/:taskId', requireAuth, requireTenantFeature('effortTracking', 'edit'), controller.updateTask);
router.post('/effort/tasks/:taskId/start', requireAuth, requireTenantFeature('effortTracking', 'edit'), controller.startTask);
router.post('/effort/tasks/:taskId/stop', requireAuth, requireTenantFeature('effortTracking', 'edit'), controller.stopTask);
router.post('/effort/tasks/:taskId/close', requireAuth, requireTenantFeature('effortTracking', 'edit'), controller.closeTask);

module.exports = router;
