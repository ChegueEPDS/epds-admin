const express = require('express');
const controller = require('../controllers/adminController');
const { requireAuth, requireSuperAdmin } = require('../middlewares/authMiddleware');

const router = express.Router();
const superAdminOnly = [requireAuth, requireSuperAdmin];

router.get('/admin/users', superAdminOnly, controller.listUsers);
router.post('/admin/users', superAdminOnly, controller.createUser);
router.patch('/admin/users/:id', superAdminOnly, controller.updateUser);
router.patch('/admin/users/:id/role', superAdminOnly, controller.updateUserRole);
router.get('/admin/tenants', superAdminOnly, controller.listTenants);
router.post('/admin/tenants', superAdminOnly, controller.createTenant);
router.patch('/admin/tenants/:id', superAdminOnly, controller.updateTenant);

module.exports = router;
