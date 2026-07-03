const express = require('express');
const controller = require('../controllers/licenseController');
const { requireAuth, requireAdminFeatureAccess } = require('../middlewares/authMiddleware');

const router = express.Router();

router.get('/licenses', requireAuth, requireAdminFeatureAccess, controller.listLicenses);
router.post('/licenses', requireAuth, requireAdminFeatureAccess, controller.createLicense);
router.patch('/licenses/:id', requireAuth, requireAdminFeatureAccess, controller.updateLicense);
router.delete('/licenses/:id', requireAuth, requireAdminFeatureAccess, controller.deleteLicense);

module.exports = router;
