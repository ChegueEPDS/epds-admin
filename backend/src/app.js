const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const logger = require('./services/logger');
logger.patchConsole();
logger.installProcessHandlers();

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const { connectDb, checkDbHealth } = require('./db');
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const mailRoutes = require('./routes/mailRoutes');
const domainHealthRoutes = require('./routes/domainHealthRoutes');
const licenseRoutes = require('./routes/licenseRoutes');
const effortRoutes = require('./routes/effortRoutes');
const workBoardRoutes = require('./routes/workBoardRoutes');
const integrationApiRoutes = require('./routes/integrationApiRoutes');
const webhookTestRoutes = require('./routes/webhookTestRoutes');
const fitFileRoutes = require('./routes/fitFileRoutes');
const { startDomainHealthMonitor } = require('./services/domainMonitorService');
const { startDomainDailyReportScheduler } = require('./services/domainDailyReportService');
const { startDomainPageSpeedScheduler } = require('./services/domainPageSpeedSchedulerService');
const { startDomainStatusReadModel } = require('./services/domainStatusReadModelService');
const { startDomainStatusPdfMaintenance } = require('./services/domainStatusPdfCacheService');
const { seedSuperAdmin } = require('./services/userSeedService');
const { normalizeTenantTypes } = require('./services/tenantMigrationService');
const { startWebhookWorker } = require('./services/webhookWorkerService');
const { startLicenseExpiryScheduler } = require('./services/licenseExpiryService');

const app = express();

function allowedOrigins() {
  return String(process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

app.set('trust proxy', 1);
app.use(logger.requestLogger);

app.get('/health/live', (req, res) => {
  res.json({
    ok: true,
    app: 'epds-admin-backend',
    uptimeSec: Math.round(process.uptime()),
    checkedAt: new Date().toISOString()
  });
});

async function readiness(req, res) {
  const db = await checkDbHealth();
  const ok = db.ok;
  res.status(ok ? 200 : 503).json({
    ok,
    app: 'epds-admin-backend',
    db,
    uptimeSec: Math.round(process.uptime()),
    checkedAt: new Date().toISOString()
  });
}

app.get('/health', readiness);
app.get('/health/ready', readiness);

app.use(cors({
  origin(origin, cb) {
    const allowed = allowedOrigins();
    if (!origin || allowed.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS blocked for origin ${origin}`));
  },
  credentials: true
}));
app.use('/api/webhook-test', webhookTestRoutes);
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  skip: (req) => String(req.path || '').startsWith('/api/integrations/v1')
}));

app.use('/api', authRoutes);
app.use('/api', adminRoutes);
app.use('/api', mailRoutes);
app.use('/api', domainHealthRoutes);
app.use('/api', licenseRoutes);
app.use('/api', effortRoutes);
app.use('/api', workBoardRoutes);
app.use('/api', integrationApiRoutes);
app.use('/api', fitFileRoutes);

app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body must not exceed 256 KB' });
  }
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'Uploaded file exceeds the allowed size limit' });
  }
  if (err?.name === 'MulterError') {
    return res.status(400).json({ error: err.message });
  }
  console.error('[app] unhandled error:', err);
  return res.status(500).json({ error: 'Internal server error' });
});

if (require.main === module) {
  const port = Number(process.env.PORT || 4301);
  connectDb()
    .then(() => normalizeTenantTypes())
    .then(() => seedSuperAdmin())
    .then(() => {
      startDomainHealthMonitor();
      startDomainDailyReportScheduler();
      startDomainPageSpeedScheduler();
      startDomainStatusReadModel();
      startDomainStatusPdfMaintenance();
      startWebhookWorker();
      startLicenseExpiryScheduler();
      app.listen(port, () => console.log(`[app] EPDS Admin API listening on ${port}`));
    })
    .catch((err) => {
      console.error('[app] startup failed:', err);
      process.exit(1);
    });
}

module.exports = app;
