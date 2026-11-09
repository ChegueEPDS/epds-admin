const express = require('express');
const multer = require('multer');
const controller = require('../controllers/workBoardControllerFacade');
const workFields = require('../services/workFields');
const tenantCurrency = require('../services/tenantCurrency');
const { dashboard, dashboardWorks } = require('../services/workDashboard');
const { requireAuth, requireTenantFeature, requireTenantContext } = require('../middlewares/authMiddleware');

const router = express.Router();
const documentUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const fieldUpload = multer({ storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 8, fields: 1, fieldSize: 2 * 1024 * 1024 } }).any();

function workPayload(req, res, next) {
  if (!req.is('multipart/form-data')) return next();
  fieldUpload(req, res, (error) => {
    if (error) return res.status(400).json({ error: 'Upload up to 8 files, maximum 10 MB each.' });
    try {
      req.body = JSON.parse(req.body.payload);
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw new Error();
    } catch {
      return res.status(400).json({ error: 'Invalid work data.' });
    }
    next();
  });
}

function companyOnly(req, res, next) {
  if (req.scope.tenantType === 'client') return res.status(403).json({ error: 'Custom fields are unavailable for client tenants.' });
  next();
}

function manageFields(req, res, next) {
  if (!['Admin', 'SuperAdmin'].includes(req.role)) return res.status(403).json({ error: 'Tenant administrator access is required.' });
  next();
}

const settingsRoute = (handler) => async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await handler(req));
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Custom field operation failed.' });
  }
};

router.use('/work-board', requireAuth, requireTenantContext);

router.get('/work-board/clients', requireTenantFeature('workBoard'), controller.listClients);
router.get('/work-board/clients/lookup', requireTenantFeature('workBoard'), controller.lookupClientByTaxNumber);
router.post('/work-board/clients', requireTenantFeature('workBoard', 'edit'), controller.createOrLinkClient);
router.get('/work-board/users', requireTenantFeature('workBoard'), controller.listTenantUsers);
router.get('/work-board/works', requireTenantFeature('workBoard'), controller.listWorks);
// Effort Tracking also consumes this endpoint, so it only requires a tenant
// context rather than Work Board feature access.
router.get('/work-board/options', controller.activeOptions);
router.get('/work-board/dashboard', requireTenantFeature('workBoard'), companyOnly,
  settingsRoute(async (req) => dashboard(req.scope.tenantId, await workFields.settings(req.scope.tenantId))));
router.get('/work-board/dashboard/works', requireTenantFeature('workBoard'), companyOnly,
  settingsRoute(async (req) => dashboardWorks(req.scope.tenantId, await workFields.settings(req.scope.tenantId), req.query)));
router.get('/work-board/custom-fields', requireTenantFeature('workBoard'), companyOnly, settingsRoute(async (req) => {
  const config = await workFields.settings(req.scope.tenantId);
  return ['Admin', 'SuperAdmin'].includes(req.role) ? config : { ...config, fields: config.fields.filter((field) => !field.archived) };
}));
router.put('/work-board/custom-fields', requireTenantFeature('workBoard', 'edit'), companyOnly, manageFields,
  settingsRoute((req) => workFields.saveSettings(req.scope.tenantId, req.body)));
router.get('/work-board/default-currency', requireTenantFeature('workBoard'), companyOnly, manageFields,
  settingsRoute((req) => tenantCurrency.preference(req.scope.tenantId)));
router.put('/work-board/default-currency', requireTenantFeature('workBoard', 'edit'), companyOnly, manageFields,
  settingsRoute((req) => tenantCurrency.setPreference(req.scope.tenantId, req.body?.defaultCurrency)));
router.get('/work-board/works/:id/custom-fields/:fieldId/file', requireTenantFeature('workBoard'), companyOnly, controller.downloadCustomField);
router.get('/work-board/works/:id', requireTenantFeature('workBoard'), controller.getWork);
router.post('/work-board/works', requireTenantFeature('workBoard', 'edit'), workPayload, controller.createWork);
router.patch('/work-board/works/:id', requireTenantFeature('workBoard', 'edit'), workPayload, controller.updateWork);
router.delete('/work-board/works/:id', requireTenantFeature('workBoard', 'delete'), controller.archiveWork);
router.post('/work-board/works/:id/restore', requireTenantFeature('workBoard', 'delete'), controller.restoreWork);
router.post('/work-board/works/:id/sub-works', requireTenantFeature('workBoard', 'edit'), controller.createSubWork);
router.patch('/work-board/sub-works/:subWorkId', requireTenantFeature('workBoard', 'edit'), controller.updateSubWork);
router.delete('/work-board/sub-works/:subWorkId', requireTenantFeature('workBoard', 'delete'), controller.archiveSubWork);
router.get('/work-board/works/:id/documents', requireTenantFeature('workBoard'), controller.listDocuments);
router.post('/work-board/works/:id/documents', requireTenantFeature('workBoard', 'edit'), documentUpload.single('file'), controller.uploadDocument);
router.get('/work-board/documents/:documentId/file', requireTenantFeature('workBoard'), controller.downloadDocument);
router.delete('/work-board/documents/:documentId', requireTenantFeature('workBoard', 'delete'), controller.deleteDocument);

module.exports = router;
