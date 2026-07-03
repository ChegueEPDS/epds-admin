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

function normalizeArg(arg) {
  if (arg instanceof Error) {
    return {
      name: arg.name,
      message: arg.message,
      stack: arg.stack,
      code: arg.code,
      statusCode: arg.statusCode
    };
  }
  return arg;
}

function formatLine(level, args) {
  const message = args
    .map((arg) => typeof arg === 'string' ? arg : util.inspect(normalizeArg(arg), { depth: 5, breakLength: 160 }))
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
    original.log(...args);
  };
  console.info = (...args) => {
    info(...args);
    original.info(...args);
  };
  console.warn = (...args) => {
    warn(...args);
    original.warn(...args);
  };
  console.error = (...args) => {
    error(...args);
    original.error(...args);
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
      path: req.originalUrl || req.url,
      status: res.statusCode,
      durationMs,
      ip: req.ip,
      userId: req.userId ? String(req.userId) : undefined
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
