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
const mailRoutes = require('./routes/mailRoutes');
const domainHealthRoutes = require('./routes/domainHealthRoutes');
const licenseRoutes = require('./routes/licenseRoutes');
const effortRoutes = require('./routes/effortRoutes');
const { startDomainHealthMonitor } = require('./services/domainMonitorService');
const { startDomainDailyReportScheduler } = require('./services/domainDailyReportService');
const { startDomainPageSpeedScheduler } = require('./services/domainPageSpeedSchedulerService');

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

app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(cors({
  origin(origin, cb) {
    const allowed = allowedOrigins();
    if (!origin || allowed.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS blocked for origin ${origin}`));
  },
  credentials: true
}));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300 }));

app.use('/api', authRoutes);
app.use('/api', mailRoutes);
app.use('/api', domainHealthRoutes);
app.use('/api', licenseRoutes);
app.use('/api', effortRoutes);

app.use((err, req, res, next) => {
  console.error('[app] unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

if (require.main === module) {
  const port = Number(process.env.PORT || 4301);
  connectDb()
    .then(() => {
      startDomainHealthMonitor();
      startDomainDailyReportScheduler();
      startDomainPageSpeedScheduler();
      app.listen(port, () => console.log(`[app] EPDS Admin API listening on ${port}`));
    })
    .catch((err) => {
      console.error('[app] startup failed:', err);
      process.exit(1);
    });
}

module.exports = app;
