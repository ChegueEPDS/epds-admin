const dns = require('dns').promises;
const net = require('net');
const axios = require('axios');
const DomainMonitor = require('../models/domainMonitor');
const DomainHealthCheck = require('../models/domainHealthCheck');

const CHECK_TIMEOUT_MS = 10000;
const MONITOR_INTERVAL_MS = 15 * 60 * 1000;
const RECENT_ISSUE_MS = 24 * 60 * 60 * 1000;
const PERFORMANCE_SLOW_MS = 2500;
const PERFORMANCE_VERY_SLOW_MS = 5000;

function normalizeBaseUrl(input) {
  const raw = String(input || '').trim();
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url;

  try {
    url = new URL(withProtocol);
  } catch {
    throw Object.assign(new Error('Valid URL is required'), { statusCode: 400 });
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw Object.assign(new Error('Only HTTP and HTTPS URLs are allowed'), { statusCode: 400 });
  }

  url.hash = '';
  url.search = '';
  if (url.pathname === '/') url.pathname = '';
  url.hostname = url.hostname.toLowerCase();

  return url.toString().replace(/\/$/, '');
}

function isPrivateIp(ip) {
  const version = net.isIP(ip);
  if (!version) return true;

  if (version === 6) {
    const value = ip.toLowerCase();
    return value === '::1' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80:');
  }

  const parts = ip.split('.').map(Number);
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    parts[0] === 0
  );
}

async function assertPublicUrl(normalizedUrl) {
  const { hostname } = new URL(normalizedUrl);
  const directIp = net.isIP(hostname);
  const addresses = directIp ? [{ address: hostname }] : await dns.lookup(hostname, { all: true });

  if (!addresses.length || addresses.some((entry) => isPrivateIp(entry.address))) {
    throw Object.assign(new Error('URL host must resolve to a public address'), { statusCode: 400 });
  }
}

function isGlobalTenant(scope = {}) {
  const globalTenant = String(process.env.EPDS_ADMIN_GLOBAL_TENANT_NAME || 'epds').trim().toLowerCase();
  return String(scope.tenantName || '').trim().toLowerCase() === globalTenant;
}

function domainScopeQuery(scope = {}) {
  if (isGlobalTenant(scope)) return {};
  return { tenantId: scope.tenantId || null };
}

function percentile(sortedValues, p) {
  if (!sortedValues.length) return null;
  const index = Math.ceil((p / 100) * sortedValues.length) - 1;
  return sortedValues[Math.min(Math.max(index, 0), sortedValues.length - 1)];
}

function performanceStatus(responseMs) {
  if (typeof responseMs !== 'number') return 'unknown';
  if (responseMs > PERFORMANCE_VERY_SLOW_MS) return 'very_slow';
  if (responseMs > PERFORMANCE_SLOW_MS) return 'slow';
  return 'ok';
}

function summarizeChecks(checks = []) {
  const total = checks.length;
  const failures = checks.filter((check) => !check.ok).length;
  const successfulResponseTimes = checks
    .filter((check) => check.ok && typeof check.responseMs === 'number')
    .map((check) => check.responseMs)
    .sort((a, b) => a - b);
  const medianResponseMs = percentile(successfulResponseTimes, 50);
  const p95ResponseMs = percentile(successfulResponseTimes, 95);

  return {
    totalChecks: total,
    uptimePercent: total ? Math.round(((total - failures) / total) * 1000) / 10 : null,
    recentIssueCount: failures,
    medianResponseMs,
    p95ResponseMs,
    performanceStatus: performanceStatus(p95ResponseMs ?? medianResponseMs)
  };
}

function presentDomain(domain, summary = {}) {
  const recentIssueCount = summary.recentIssueCount || 0;
  const hasCurrentIssue = domain.lastStatus === 'error';
  const hasRecentIssue = recentIssueCount > 0 || Boolean(
    domain.lastFailureAt && Date.now() - domain.lastFailureAt.getTime() <= RECENT_ISSUE_MS
  );
  const displayStatus = hasCurrentIssue
    ? 'error'
    : hasRecentIssue && domain.lastStatus === 'ok'
      ? 'warning'
      : domain.lastStatus || 'unknown';

  return {
    id: String(domain._id),
    name: domain.name,
    baseUrl: domain.baseUrl,
    owner: domain.owner || 'EPDS',
    tenantId: domain.tenantId ? String(domain.tenantId) : null,
    enabled: domain.enabled,
    lastCheckedAt: domain.lastCheckedAt,
    lastStatus: domain.lastStatus,
    displayStatus,
    lastResponseMs: domain.lastResponseMs,
    lastStatusCode: domain.lastStatusCode,
    lastError: domain.lastError,
    lastErrorType: domain.lastErrorType,
    currentIssueSince: domain.currentIssueSince,
    lastFailureAt: domain.lastFailureAt,
    lastRecoveryAt: domain.lastRecoveryAt,
    recentIssueCount,
    availability: {
      status: displayStatus,
      uptimePercent: summary.uptimePercent ?? null,
      totalChecks: summary.totalChecks || 0,
      recentIssueCount
    },
    performance: {
      status: summary.performanceStatus || performanceStatus(domain.lastResponseMs),
      lastResponseMs: domain.lastResponseMs,
      medianResponseMs: summary.medianResponseMs ?? null,
      p95ResponseMs: summary.p95ResponseMs ?? null
    },
    createdAt: domain.createdAt,
    updatedAt: domain.updatedAt
  };
}

async function buildDomainList(scope = {}) {
  const domains = await DomainMonitor.find(domainScopeQuery(scope)).sort({ name: 1 }).lean(false);
  const since = new Date(Date.now() - RECENT_ISSUE_MS);
  const visibleDomainIds = domains.map((domain) => domain._id);
  const checks = visibleDomainIds.length
    ? await DomainHealthCheck.find({ domainId: { $in: visibleDomainIds }, checkedAt: { $gte: since } })
      .select('domainId ok responseMs')
      .lean()
    : [];
  const checksByDomain = checks.reduce((acc, check) => {
    const key = String(check.domainId);
    if (!acc.has(key)) acc.set(key, []);
    acc.get(key).push(check);
    return acc;
  }, new Map());
  const order = { error: 0, warning: 1, unknown: 2, ok: 3 };
  return domains
    .map((domain) => presentDomain(domain, summarizeChecks(checksByDomain.get(String(domain._id)) || [])))
    .sort((a, b) => (order[a.displayStatus] ?? 4) - (order[b.displayStatus] ?? 4) || a.name.localeCompare(b.name));
}

async function countRecentIssues(domainId) {
  const since = new Date(Date.now() - RECENT_ISSUE_MS);
  return DomainHealthCheck.countDocuments({ domainId, checkedAt: { $gte: since }, ok: false });
}

async function summarizeRecentChecks(domainId) {
  const since = new Date(Date.now() - RECENT_ISSUE_MS);
  const checks = await DomainHealthCheck.find({ domainId, checkedAt: { $gte: since } })
    .select('ok responseMs')
    .lean();
  return summarizeChecks(checks);
}

async function runDomainCheck(domain) {
  const checkedAt = new Date();
  const startedAt = Date.now();
  let result;

  try {
    await assertPublicUrl(domain.normalizedUrl);
    const response = await axios.get(domain.normalizedUrl, {
      timeout: CHECK_TIMEOUT_MS,
      maxRedirects: 3,
      validateStatus: () => true,
      headers: { 'User-Agent': 'EPDS-Admin-DomainHealth/1.0' }
    });
    const responseMs = Date.now() - startedAt;
    const ok = response.status >= 200 && response.status < 400;
    result = {
      checkedAt,
      ok,
      statusCode: response.status,
      responseMs,
      errorType: ok ? undefined : 'http_status',
      errorMessage: ok ? undefined : `HTTP ${response.status}`
    };
  } catch (err) {
    const responseMs = Date.now() - startedAt;
    const isTimeout = err.code === 'ECONNABORTED' || /timeout/i.test(err.message || '');
    const isDns = ['ENOTFOUND', 'EAI_AGAIN', 'ENODATA'].includes(err.code);
    result = {
      checkedAt,
      ok: false,
      responseMs,
      errorType: isTimeout ? 'timeout' : isDns ? 'dns' : err.statusCode ? 'blocked_host' : 'connection',
      errorMessage: isTimeout ? 'Request timed out after 10 seconds' : (err.message || 'Request failed')
    };
  }

  await DomainHealthCheck.create({
    domainId: domain._id,
    checkedAt: result.checkedAt,
    ok: result.ok,
    statusCode: result.statusCode,
    responseMs: result.responseMs,
    errorType: result.errorType,
    errorMessage: result.errorMessage
  });

  const wasFailing = domain.lastStatus === 'error';
  domain.lastCheckedAt = result.checkedAt;
  domain.lastStatus = result.ok ? 'ok' : 'error';
  domain.lastResponseMs = result.responseMs;
  domain.lastStatusCode = result.statusCode;
  domain.lastError = result.errorMessage;
  domain.lastErrorType = result.errorType;

  if (result.ok) {
    if (wasFailing) domain.lastRecoveryAt = result.checkedAt;
    domain.currentIssueSince = undefined;
  } else {
    domain.lastFailureAt = result.checkedAt;
    if (!wasFailing) domain.currentIssueSince = result.checkedAt;
  }

  await domain.save();
  return result;
}

let monitorTimer;
let isRunning = false;

async function runScheduledChecks() {
  if (isRunning) return;
  isRunning = true;
  try {
    const domains = await DomainMonitor.find({ enabled: true });
    for (const domain of domains) {
      try {
        await runDomainCheck(domain);
      } catch (err) {
        console.error(`[domain-monitor] ${domain.baseUrl} check failed:`, err.message);
      }
    }
  } catch (err) {
    console.error('[domain-monitor] scheduled checks failed:', err.message);
  } finally {
    isRunning = false;
  }
}

function startDomainHealthMonitor() {
  if (monitorTimer) return;
  const delay = Number(process.env.DOMAIN_HEALTH_INITIAL_DELAY_MS || 15000);
  setTimeout(runScheduledChecks, delay).unref?.();
  monitorTimer = setInterval(runScheduledChecks, MONITOR_INTERVAL_MS);
  monitorTimer.unref?.();
  console.log('[domain-monitor] scheduled every 15 minutes');
}

module.exports = {
  CHECK_TIMEOUT_MS,
  PERFORMANCE_SLOW_MS,
  PERFORMANCE_VERY_SLOW_MS,
  RECENT_ISSUE_MS,
  normalizeBaseUrl,
  assertPublicUrl,
  buildDomainList,
  domainScopeQuery,
  isGlobalTenant,
  presentDomain,
  countRecentIssues,
  summarizeRecentChecks,
  runDomainCheck,
  startDomainHealthMonitor
};
