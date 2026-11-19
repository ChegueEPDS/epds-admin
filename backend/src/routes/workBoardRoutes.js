const express = require('express');
const multer = require('multer');
const controller = require('../controllers/workBoardControllerFacade');
const workFields = require('../services/workFields');
const { latestRates } = require('../services/mnbExchangeRates');
const tenantCurrency = require('../services/tenantCurrency');
const { dashboardWorks } = require('../services/workDashboard');
const { getDashboardSnapshot, markMongoDashboardDirty } = require('../services/workDashboardSnapshots');
const { databaseEngine } = require('../postgres');
const workTransfer = require('../services/workTransfer');
const { exportClients } = require('../services/clientTransfer');
const { maxWorkbookBytes, maxZipBytes } = require('../services/workTransferWorkbook');
const { requireAuth, requireTenantFeature, requireTenantContext } = require('../middlewares/authMiddleware');

const router = express.Router();
const documentUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const fieldUpload = multer({ storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 8, fields: 1, fieldSize: 2 * 1024 * 1024 } }).any();
const workTransferUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxZipBytes, files: 2, fields: 0 } })
  .fields([{ name: 'workbook', maxCount: 1 }, { name: 'attachments', maxCount: 1 }]);

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

const transferAccess = [requireTenantFeature('workBoard', 'edit'), companyOnly, manageFields, (req, res, next) => {
  if (req.scope.tenantType === 'finance') return res.status(403).json({ error: 'A company tenant is required.' });
  next();
}];
const sendWorkbook = (res, name, bytes) => res.attachment(name).send(Buffer.from(bytes));

function transferRoute(handler) {
  return async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { await handler(req, res); }
    catch (error) {
      if (!error.statusCode) console.error('[work-transfer] Request failed', error.code || error.name);
      res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Excel operation failed.' });
    }
  };
}

const clientTransferUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxWorkbookBytes, files: 1, fields: 0 } })
  .fields([{ name: 'workbook', maxCount: 1 }]);

function registerWorkbookTransfer(path, kind, prefix, exporter) {
  for (const mode of ['template', 'export']) {
    router.get(path + '/' + mode, ...transferAccess, transferRoute(async (req, res) => {
      sendWorkbook(res, prefix + '-' + mode + '.xlsx', await exporter(req.scope.tenantId, mode === 'template'));
    }));
  }
  const allowAttachments = kind === 'works';
  const upload = allowAttachments ? workTransferUpload : clientTransferUpload;
  const errorMessage = 'Choose an XLSX workbook up to 10 MB' + (allowAttachments ? ' and an optional ZIP file up to 40 MB.' : '.');
  router.post(path + '/import', ...transferAccess, (req, res, next) => {
    upload(req, res, (error) => {
      if (error) return res.status(400).json({ error: errorMessage });
      next();
    });
  }, transferRoute((req, res) => {
    const workbook = req.files?.workbook?.[0];
    const archive = req.files?.attachments?.[0];
    if (!workbook || !/\.xlsx$/i.test(workbook.originalname) || workbook.size > maxWorkbookBytes ||
        (archive && !/\.zip$/i.test(archive.originalname))) {
      return res.status(400).json({ error: errorMessage });
    }
    res.status(202).json(workTransfer.startImport({
      scope: req.scope, actorId: req.userId, excel: workbook.buffer, archive: archive?.buffer, kind
    }));
  }));
  const jobFor = (req) => workTransfer.importJob(req.params.id, req.scope.tenantId, req.userId, kind);
  router.get(path + '/import/:id', ...transferAccess, transferRoute((req, res) => res.json(jobFor(req).result)));
  router.get(path + '/import/:id/errors', ...transferAccess, transferRoute((req, res) => {
    const { report } = jobFor(req);
    if (!report) return res.status(404).json({ error: 'No error workbook is available.' });
    sendWorkbook(res, prefix + '-import-errors.xlsx', report);
  }));
}

registerWorkbookTransfer('/work-board/transfer', 'works', 'project-tracker', workTransfer.exportWorks);
registerWorkbookTransfer('/work-board/clients/transfer', 'clients', 'project-tracker-clients', exportClients);

router.get('/work-board/clients', requireTenantFeature('workBoard'), controller.listClients);
router.get('/work-board/clients/lookup', requireTenantFeature('workBoard'), controller.lookupClientByTaxNumber);
router.post('/work-board/clients', requireTenantFeature('workBoard', 'edit'), controller.createOrLinkClient);
router.get('/work-board/users', requireTenantFeature('workBoard'), controller.listTenantUsers);
router.get('/work-board/works', requireTenantFeature('workBoard'), controller.listWorks);
// Effort Tracking also consumes this endpoint, so it only requires a tenant
// context rather than Project Tracker feature access.
router.get('/work-board/options', controller.activeOptions);
router.get('/work-board/board-options', requireTenantFeature('workBoard'), controller.boardOptions);
router.get('/work-board/dashboard', requireTenantFeature('workBoard'), companyOnly,
  settingsRoute((req) => getDashboardSnapshot(req.scope.tenantId, req.query.wait === '1')));
router.get('/work-board/dashboard/works', requireTenantFeature('workBoard'), companyOnly,
  settingsRoute(async (req) => dashboardWorks(req.scope.tenantId, await workFields.settings(req.scope.tenantId), req.query)));
router.get('/work-board/custom-fields', requireTenantFeature('workBoard'), companyOnly, settingsRoute(async (req) => {
  const config = await workFields.settings(req.scope.tenantId);
  return ['Admin', 'SuperAdmin'].includes(req.role) ? config : { ...config, fields: config.fields.filter((field) => !field.archived) };
}));
router.put('/work-board/custom-fields', requireTenantFeature('workBoard', 'edit'), companyOnly, manageFields,
  settingsRoute(async (req) => {
    try {
      return await workFields.saveSettings(req.scope.tenantId, req.body);
    } finally {
      if (databaseEngine() === 'mongodb' && req.body?.updateExistingWorkNumbers === true) await markMongoDashboardDirty(req.scope);
    }
  }));
router.get('/work-board/exchange-rates', requireTenantFeature('workBoard'), settingsRoute(async () => {
  const { snapshot } = await latestRates();
  return { snapshot: snapshot || null };
}));
router.get('/work-board/default-currency', requireTenantFeature('workBoard'), companyOnly, manageFields,
  settingsRoute((req) => tenantCurrency.preference(req.scope.tenantId)));
router.put('/work-board/default-currency', requireTenantFeature('workBoard', 'edit'), companyOnly, manageFields,
  settingsRoute((req) => tenantCurrency.setPreference(req.scope.tenantId, req.body?.defaultCurrency)));
router.get('/work-board/turnover', requireTenantFeature('workBoard'), companyOnly, manageFields,
  settingsRoute((req) => workFields.workTurnoverPreference(req.scope.tenantId)));
router.put('/work-board/turnover', requireTenantFeature('workBoard', 'edit'), companyOnly, manageFields,
  settingsRoute((req) => workFields.saveWorkTurnoverPreference(req.scope.tenantId, req.body)));
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
