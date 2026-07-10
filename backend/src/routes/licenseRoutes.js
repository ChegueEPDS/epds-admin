const express = require('express');
const multer = require('multer');
const controller = require('../controllers/licenseController');
const { requireAuth, requireTenantFeature } = require('../middlewares/authMiddleware');
const { MAX_LICENSE_FILE_SIZE } = require('../services/licenseFileService');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_LICENSE_FILE_SIZE }
});

router.get('/licenses', requireAuth, requireTenantFeature('licenses'), controller.listLicenses);
router.post('/licenses', requireAuth, requireTenantFeature('licenses', 'edit'), controller.createLicense);
router.patch('/licenses/:id', requireAuth, requireTenantFeature('licenses', 'edit'), controller.updateLicense);
router.post('/licenses/:id/order', requireAuth, requireTenantFeature('licenses', 'edit'), controller.orderLicense);
router.post('/licenses/:id/activate', requireAuth, requireTenantFeature('licenses', 'edit'), controller.activateLicense);
router.post('/licenses/:id/license-file', requireAuth, requireTenantFeature('licenses', 'edit'), upload.single('file'), controller.uploadLicenseFile);
router.get('/licenses/:id/license-file', requireAuth, requireTenantFeature('licenses', 'edit'), controller.downloadLicenseFile);
router.delete('/licenses/:id', requireAuth, requireTenantFeature('licenses', 'delete'), controller.deleteLicense);

module.exports = router;
