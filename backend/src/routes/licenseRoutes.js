const express = require('express');
const multer = require('multer');
const controller = require('../controllers/licenseController');
const { requireAuth, requireTenantFeature } = require('../middlewares/authMiddleware');
const { MAX_LICENSE_FILE_SIZE, MAX_MOBILE_APP_FILE_SIZE } = require('../services/licenseFileService');

const router = express.Router();
const licenseUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_LICENSE_FILE_SIZE }
});
const mobileAppUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MOBILE_APP_FILE_SIZE }
});

router.get('/licenses', requireAuth, requireTenantFeature('licenses'), controller.listLicenses);
router.post('/licenses', requireAuth, requireTenantFeature('licenses', 'edit'), controller.createLicense);
router.patch('/licenses/:id', requireAuth, requireTenantFeature('licenses', 'edit'), controller.updateLicense);
router.post('/licenses/:id/order', requireAuth, requireTenantFeature('licenses', 'edit'), controller.orderLicense);
router.post('/licenses/:id/activate', requireAuth, requireTenantFeature('licenses', 'edit'), controller.activateLicense);
router.post('/licenses/:id/license-file', requireAuth, requireTenantFeature('licenses', 'edit'), licenseUpload.single('file'), controller.uploadLicenseFile);
router.get('/licenses/:id/license-file', requireAuth, requireTenantFeature('licenses', 'edit'), controller.downloadLicenseFile);
router.post('/licenses/:id/mobile-app-file', requireAuth, requireTenantFeature('licenses', 'edit'), mobileAppUpload.single('file'), controller.uploadMobileAppFile);
router.get('/licenses/:id/mobile-app-file', requireAuth, requireTenantFeature('licenses'), controller.downloadMobileAppFile);
router.delete('/licenses/:id', requireAuth, requireTenantFeature('licenses', 'delete'), controller.deleteLicense);

module.exports = router;
