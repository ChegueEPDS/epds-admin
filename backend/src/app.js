const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const { connectDb } = require('./db');
const authRoutes = require('./routes/authRoutes');
const mailRoutes = require('./routes/mailRoutes');
const domainHealthRoutes = require('./routes/domainHealthRoutes');
const { startDomainHealthMonitor } = require('./services/domainMonitorService');

const app = express();

function allowedOrigins() {
  return String(process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

app.set('trust proxy', 1);
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

app.get('/health', (req, res) => res.json({ ok: true, app: 'epds-admin-backend' }));
app.use('/api', authRoutes);
app.use('/api', mailRoutes);
app.use('/api', domainHealthRoutes);

app.use((err, req, res, next) => {
  console.error('[app] unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

if (require.main === module) {
  const port = Number(process.env.PORT || 4301);
  connectDb()
    .then(() => {
      startDomainHealthMonitor();
      app.listen(port, () => console.log(`[app] EPDS Admin API listening on ${port}`));
    })
    .catch((err) => {
      console.error('[app] startup failed:', err);
      process.exit(1);
    });
}

module.exports = app;
