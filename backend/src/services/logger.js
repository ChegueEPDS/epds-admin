const fs = require('fs');
const path = require('path');
const util = require('util');

const LOG_DIR = process.env.LOG_DIR || path.resolve(__dirname, '..', '..', 'logs');
const APP_LOG = process.env.APP_LOG_FILE || path.join(LOG_DIR, 'app.log');
const ERROR_LOG = process.env.ERROR_LOG_FILE || path.join(LOG_DIR, 'error.log');

let consolePatched = false;

function ensureLogDir() {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch {
    // Logging must never prevent the API from starting.
  }
}

const secretField = /password|secret|token|authorization|cookie|credential|api[_-]?key|private[_-]?key|recovery.?code/i;

function redactText(value) {
  return value
    .replace(/(?:https?|postgres(?:ql)?|mongodb(?:\+srv)?):\/\/[^\s"'<>]+/gi, '[redacted URL]')
    .replace(/\/webhook-test\/inboxes\/[^\s/?#"'<>]+/gi, '/webhook-test/inboxes/[redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]');
}

function normalizeArg(arg, depth = 0) {
  if (arg instanceof Error) {
    return {
      name: arg.name,
      code: arg.code,
      statusCode: arg.statusCode
    };
  }
  if (typeof arg === 'string') return redactText(arg);
  if (arg === null || typeof arg !== 'object' || arg instanceof Date) return arg;
  if (depth >= 5 || Buffer.isBuffer(arg)) return '[redacted]';
  if (Array.isArray(arg)) return arg.map((item) => normalizeArg(item, depth + 1));
  return Object.fromEntries(Object.entries(arg).map(([key, value]) =>
    [key, secretField.test(key) ? '[redacted]' : normalizeArg(value, depth + 1)]));
}

function formatLine(level, args) {
  const message = args
    .map((arg) => typeof arg === 'string' ? redactText(arg) : util.inspect(normalizeArg(arg), { depth: 5, breakLength: 160 }))
    .join(' ');
  return `${new Date().toISOString()} ${level.toUpperCase()} ${message}\n`;
}

function append(file, line) {
  ensureLogDir();
  fs.appendFile(file, line, (err) => {
    if (err) {
      // Avoid console recursion if file logging itself fails.
      process.stderr.write(`logger write failed: ${err.message}\n`);
    }
  });
}

function write(level, ...args) {
  const line = formatLine(level, args);
  append(APP_LOG, line);
  if (level === 'error' || level === 'warn') append(ERROR_LOG, line);
}

function info(...args) {
  write('info', ...args);
}

function warn(...args) {
  write('warn', ...args);
}

function error(...args) {
  write('error', ...args);
}

function patchConsole() {
  if (consolePatched) return;
  consolePatched = true;

  const original = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console)
  };

  console.log = (...args) => {
    info(...args);
    original.log(...args.map((arg) => normalizeArg(arg)));
  };
  console.info = (...args) => {
    info(...args);
    original.info(...args.map((arg) => normalizeArg(arg)));
  };
  console.warn = (...args) => {
    warn(...args);
    original.warn(...args.map((arg) => normalizeArg(arg)));
  };
  console.error = (...args) => {
    error(...args);
    original.error(...args.map((arg) => normalizeArg(arg)));
  };
}

function requestLogger(req, res, next) {
  const startedAt = Date.now();
  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    const isHealth = String(req.path || '').startsWith('/health');
    const shouldLog = !isHealth || res.statusCode >= 400 || durationMs > 1000;
    if (!shouldLog) return;

    const payload = {
      method: req.method,
      route: typeof req.route?.path === 'string' ? req.route.path : undefined,
      status: res.statusCode,
      durationMs,
      responseBytes: Number(res.getHeader('content-length')) || undefined,
      ip: req.ip,
      userId: req.userId ? String(req.userId) : undefined,
      integrationClientId: req.integrationClientId ? String(req.integrationClientId) : undefined
    };

    if (res.statusCode >= 500) error('[request]', payload);
    else if (res.statusCode >= 400) warn('[request]', payload);
    else info('[request]', payload);
  });
  next();
}

function installProcessHandlers() {
  process.on('unhandledRejection', (reason) => {
    error('[process] unhandled rejection:', reason);
  });

  process.on('uncaughtException', (err) => {
    error('[process] uncaught exception:', err);
    setTimeout(() => process.exit(1), 100);
  });
}

module.exports = {
  APP_LOG,
  ERROR_LOG,
  LOG_DIR,
  error,
  info,
  installProcessHandlers,
  patchConsole,
  requestLogger,
  warn
};
