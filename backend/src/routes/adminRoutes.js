const express = require('express');
const controller = require('../controllers/adminControllerFacade');
const integrationController = require('../controllers/integrationAdminController');
const { currencyOptions } = require('../services/tenantCurrency');
const { requireAuth, requireSuperAdmin } = require('../middlewares/authMiddleware');

const router = express.Router();
const superAdminOnly = [requireAuth, requireSuperAdmin];

router.get('/admin/users', superAdminOnly, controller.listUsers);
router.post('/admin/users', superAdminOnly, controller.createUser);
router.patch('/admin/users/:id', superAdminOnly, controller.updateUser);
router.patch('/admin/users/:id/role', superAdminOnly, controller.updateUserRole);
router.get('/admin/tenants', superAdminOnly, controller.listTenants);
router.get('/admin/tenant-currencies', superAdminOnly, (_req, res) => res.json({ currencies: currencyOptions() }));
router.post('/admin/tenants', superAdminOnly, controller.createTenant);
router.patch('/admin/tenants/:id', superAdminOnly, controller.updateTenant);
router.get('/admin/integrations', superAdminOnly, integrationController.listClients);
router.post('/admin/integrations', superAdminOnly, integrationController.createClient);
router.patch('/admin/integrations/:id', superAdminOnly, integrationController.updateClient);
router.post('/admin/integrations/:id/rotate-api-key', superAdminOnly, integrationController.rotateApiKey);
router.post('/admin/integrations/:id/rotate-webhook-secret', superAdminOnly, integrationController.rotateWebhookSecret);
router.post('/admin/integrations/:id/revoke', superAdminOnly, integrationController.revokeClient);
router.post('/admin/integrations/:id/retry-deliveries', superAdminOnly, integrationController.retryFailedDeliveries);

module.exports = router;
