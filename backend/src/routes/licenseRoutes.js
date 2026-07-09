const express = require('express');
const controller = require('../controllers/licenseController');
const { requireAuth, requireTenantFeature } = require('../middlewares/authMiddleware');

const router = express.Router();

router.get('/licenses', requireAuth, requireTenantFeature('licenses'), controller.listLicenses);
router.post('/licenses', requireAuth, requireTenantFeature('licenses', 'edit'), controller.createLicense);
router.patch('/licenses/:id', requireAuth, requireTenantFeature('licenses', 'edit'), controller.updateLicense);
router.delete('/licenses/:id', requireAuth, requireTenantFeature('licenses', 'delete'), controller.deleteLicense);

module.exports = router;
