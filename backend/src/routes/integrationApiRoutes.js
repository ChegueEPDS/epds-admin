const express = require('express');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const controller = require('../controllers/integrationApiController');
const { requireIntegrationAuth, requireIntegrationScope } = require('../middlewares/integrationAuthMiddleware');
const { MAX_LICENSE_FILE_SIZE, MAX_MOBILE_APP_FILE_SIZE } = require('../services/licenseFileService');

const router = express.Router();
const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => String(req.integrationClientId)
});
const licenseUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_LICENSE_FILE_SIZE } });
const mobileAppUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_MOBILE_APP_FILE_SIZE } });

router.use('/integrations/v1', requireIntegrationAuth, limiter);
router.get('/integrations/v1/licenses', requireIntegrationScope('licenses:read'), controller.listLicenses);
router.get('/integrations/v1/events', requireIntegrationScope('events:read'), controller.listEvents);
router.post(
  '/integrations/v1/licenses/:id/license-file',
  requireIntegrationScope('licenses:file:write'),
  licenseUpload.single('file'),
  controller.uploadLicenseFile
);
router.post(
  '/integrations/v1/licenses/:id/mobile-app-file',
  requireIntegrationScope('licenses:file:write'),
  mobileAppUpload.single('file'),
  controller.uploadMobileAppFile
);

module.exports = router;
