const express = require('express');
const controller = require('../controllers/effortController');
const { requireAuth, requireAdminFeatureAccess, requireEpdsEmail } = require('../middlewares/authMiddleware');

const router = express.Router();
const effortAccess = [requireAuth, requireAdminFeatureAccess, requireEpdsEmail];

router.get('/effort/projects', effortAccess, controller.listProjects);
router.post('/effort/projects', effortAccess, controller.createProject);
router.get('/effort/projects/:id', effortAccess, controller.getProject);
router.patch('/effort/projects/:id', effortAccess, controller.updateProject);
router.post('/effort/projects/:id/close', effortAccess, controller.closeProject);
router.post('/effort/projects/:id/reopen', effortAccess, controller.reopenProject);
router.post('/effort/projects/:id/tasks', effortAccess, controller.createTask);
router.patch('/effort/tasks/:taskId', effortAccess, controller.updateTask);
router.post('/effort/tasks/:taskId/start', effortAccess, controller.startTask);
router.post('/effort/tasks/:taskId/stop', effortAccess, controller.stopTask);
router.post('/effort/tasks/:taskId/close', effortAccess, controller.closeTask);

module.exports = router;
