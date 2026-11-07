const { confirmMeasurement, remoteProbeConfiguration } = require('./domainReliabilityService');
const { reportScope } = require('./domainCustomerReportService');
const dns = require('dns').promises;
const net = require('net');
const http = require('http');
const https = require('https');
const axios = require('axios');
const DomainMonitor = require('../models/domainMonitor');
const DomainHealthCheck = require('../models/domainHealthCheck');
const { databaseEngine } = require('../postgres');
const domainHealthRepository = require('../repositories/postgres/domainHealthRepository');
const { getPublicPageSpeedSummaries } = require('./pageSpeedService');
const { mapWithConcurrency, withJobLease } = require('./scheduledJobLeaseService');

const CHECK_TIMEOUT_MS = 10000;
const MONITOR_INTERVAL_MS = 15 * 60 * 1000;
const RECENT_ISSUE_MS = 24 * 60 * 60 * 1000;
const PERFORMANCE_SLOW_MS = 2500;
const PERFORMANCE_VERY_SLOW_MS = 5000;
const TLS_WARNING_DAYS = 30;
const STATUS_HISTORY_BUCKET_MINUTES = 30;

function normalizeBaseUrl(input) {
  const raw = String(input || '').trim();
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url;

  try {
    url = new URL(withProtocol);
  } catch {
    throw Object.assign(new Error('Valid URL is required'), { statusCode: 400 });
  }

  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
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
    if (value.startsWith('::ffff:')) {
      const mapped = value.slice(7);
      if (net.isIP(mapped) === 4) return isPrivateIp(mapped);
      const words = mapped.split(':');
      if (words.length === 2) {
        const number = parseInt(words[0], 16) * 65536 + parseInt(words[1], 16);
        return isPrivateIp([number >>> 24, (number >>> 16) & 255, (number >>> 8) & 255, number & 255].join('.'));
      }
      return true;
    }
    return !value.startsWith('2') && !value.startsWith('3');
  }

  const parts = ip.split('.').map(Number);
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    parts[0] === 0 || parts[0] >= 224 || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
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
  return scope.role === 'SuperAdmin';
}

function domainScopeQuery(scope = {}) {
  const active = { 'monitoringState.archivedAt': null };
  if (isGlobalTenant(scope)) return active;
  return { ...active, tenantId: scope.tenantId || null };
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

function numberInRange(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(Math.round(number), min), max);
}

function normalizeCheckPath(input) {
  const raw = String(input || '').trim();
  if (!raw || raw === '/') return '';
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function domainHealthConfig(domain = {}) {
  const config = domain.healthConfig || {};
  const expectedStatusMin = numberInRange(config.expectedStatusMin, 200, 100, 599);
  const expectedStatusMax = numberInRange(config.expectedStatusMax, 399, expectedStatusMin, 599);
  const warningResponseMs = numberInRange(config.warningResponseMs, PERFORMANCE_SLOW_MS, 100, 60000);
  const errorResponseMs = numberInRange(config.errorResponseMs, CHECK_TIMEOUT_MS, warningResponseMs, 120000);

  return {
    checkPath: normalizeCheckPath(config.checkPath),
    expectedStatusMin,
    expectedStatusMax,
    timeoutMs: numberInRange(config.timeoutMs, CHECK_TIMEOUT_MS, 1000, 120000),
    warningResponseMs,
    errorResponseMs,
    followRedirects: config.followRedirects !== false,
    tlsWarningDays: numberInRange(config.tlsWarningDays, TLS_WARNING_DAYS, 1, 365)
  };
}

function checkUrlForDomain(domain, config = domainHealthConfig(domain)) {
  const url = new URL(domain.normalizedUrl || domain.baseUrl);
  if (config.checkPath) {
    url.pathname = config.checkPath;
    url.search = '';
    url.hash = '';
  }
  return url.toString().replace(/\/$/, '');
}

function responseRedirectCount(response) {
  return Number(response.request?._redirectable?._redirectCount || 0);
}

function responseFinalUrl(response) {
  return response.request?.res?.responseUrl || response.config?.url || null;
}

function responseTlsInfo(response, checkedAt = new Date()) {
  const cert = response.request?.socket?.getPeerCertificate?.();
  if (!cert || !cert.valid_to) return {};
  const validTo = new Date(cert.valid_to);
  if (Number.isNaN(validTo.getTime())) return {};
  const tlsDaysRemaining = Math.ceil((validTo.getTime() - checkedAt.getTime()) / (24 * 60 * 60 * 1000));
  return { tlsValidTo: validTo, tlsDaysRemaining };
}

function normalizedCheckStatus(check) {
  return check.status || (check.ok ? 'ok' : 'error');
}

function checkReasonCode(check) {
  return check.errorType || check.warningType || normalizedCheckStatus(check);
}

function checkRootCauseText(check) {
  const code = checkReasonCode(check);
  if (code === 'dns') return 'DNS resolution failed';
  if (code === 'tls' || code === 'tls_expired') return 'TLS certificate expired';
  if (code === 'timeout') return 'Request timeout';
  if (code === 'slow_response') return 'Slow response';
  if (code === 'http_status') {
    if (typeof check.statusCode === 'number' && check.statusCode >= 500) return 'HTTP 5xx from server';
    return 'Unexpected HTTP status';
  }
  if (code === 'connection') return 'Connection failed';
  if (code === 'redirect_chain') return 'Too many redirects';
  if (code === 'tls_expiring') return 'TLS certificate expiring soon';
  return check.errorMessage || check.warningMessage || code;
}

function checkReasonText(check) {
  return checkRootCauseText(check);
}

function serializeCheck(check) {
  if (!check) return null;
  return {
    id: String(check._id || check.id),
    checkedAt: check.checkedAt,
    ok: check.ok,
    status: normalizedCheckStatus(check),
    statusCode: check.statusCode,
    responseMs: check.responseMs,
    finalUrl: check.finalUrl,
    redirectCount: check.redirectCount,
    contentType: check.contentType,
    contentLength: check.contentLength,
    tlsValidTo: check.tlsValidTo,
    tlsDaysRemaining: check.tlsDaysRemaining,
    errorType: check.errorType,
    errorMessage: check.errorMessage,
    warningType: check.warningType,
    warningMessage: check.warningMessage
  };
}

function checksSince(checks = [], hours) {
  const since = Date.now() - hours * 60 * 60 * 1000;
  return checks.filter((check) => new Date(check.checkedAt).getTime() >= since);
}

function summarizeWindow(checks = [], label, incidentCount = 0) {
  const totalChecks = checks.length;
  const failingChecks = checks.filter((check) => normalizedCheckStatus(check) === 'error').length;
  const successfulResponseTimes = checks
    .filter((check) => check.ok && typeof check.responseMs === 'number')
    .map((check) => check.responseMs)
    .sort((a, b) => a - b);
  const avgResponseMs = successfulResponseTimes.length
    ? Math.round(successfulResponseTimes.reduce((sum, value) => sum + value, 0) / successfulResponseTimes.length)
    : null;

  return {
    label,
    totalChecks,
    uptimePercent: totalChecks ? Math.round(((totalChecks - failingChecks) / totalChecks) * 1000) / 10 : null,
    avgResponseMs,
    medianResponseMs: percentile(successfulResponseTimes, 50),
    p95ResponseMs: percentile(successfulResponseTimes, 95),
    incidentCount
  };
}

function buildIncidents(checks = [], now = new Date()) {
  const incidents = [];
  let active = null;

  for (const check of checks) {
    const status = normalizedCheckStatus(check);
    const checkedAt = new Date(check.checkedAt);

    if (status === 'ok') {
      if (active) {
        incidents.push({
          ...active,
          endedAt: checkedAt,
          durationMs: Math.max(checkedAt.getTime() - active.startedAt.getTime(), 0),
          isOpen: false
        });
        active = null;
      }
      continue;
    }

    const candidate = {
      severity: status,
      reasonCode: checkReasonCode(check),
      reasonText: checkReasonText(check),
      startedAt: checkedAt
    };

    if (!active) {
      active = candidate;
      continue;
    }

    if (active.severity === candidate.severity && active.reasonCode === candidate.reasonCode) continue;

    incidents.push({
      ...active,
      endedAt: checkedAt,
      durationMs: Math.max(checkedAt.getTime() - active.startedAt.getTime(), 0),
      isOpen: false
    });
    active = candidate;
  }

  if (active) {
    incidents.push({
      ...active,
      endedAt: null,
      durationMs: Math.max(now.getTime() - active.startedAt.getTime(), 0),
      isOpen: true
    });
  }

  return incidents.map((incident) => ({
    severity: incident.severity,
    reasonCode: incident.reasonCode,
    reasonText: incident.reasonText,
    startedAt: incident.startedAt.toISOString(),
    endedAt: incident.endedAt ? incident.endedAt.toISOString() : null,
    durationMs: incident.durationMs,
    isOpen: incident.isOpen
  }));
}

function buildHistory24h(checks = []) {
  const bucketMs = STATUS_HISTORY_BUCKET_MINUTES * 60 * 1000;
  const bucketCount = Math.ceil((24 * 60) / STATUS_HISTORY_BUCKET_MINUTES);
  const end = Date.now();
  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const bucketStart = end - (bucketCount - index) * bucketMs;
    return {
      status: 'unknown',
      bucketStart: new Date(bucketStart).toISOString(),
      checkedAt: null,
      responseMs: null
    };
  });

  for (const check of checksSince(checks, 24)) {
    const delta = end - new Date(check.checkedAt).getTime();
    const index = bucketCount - 1 - Math.floor(delta / bucketMs);
    if (index < 0 || index >= bucketCount) continue;
    buckets[index] = {
      status: normalizedCheckStatus(check),
      bucketStart: buckets[index].bucketStart,
      checkedAt: new Date(check.checkedAt).toISOString(),
      responseMs: typeof check.responseMs === 'number' ? check.responseMs : null
    };
  }

  return buckets;
}

function buildTlsSummary(domain) {
  const warningDays = domainHealthConfig(domain).tlsWarningDays;
  if (typeof domain.lastTlsDaysRemaining !== 'number') {
    return { status: 'unknown', validTo: domain.lastTlsValidTo || null, daysRemaining: null, warningDays };
  }
  if (domain.lastTlsDaysRemaining <= 0) {
    return { status: 'error', validTo: domain.lastTlsValidTo || null, daysRemaining: domain.lastTlsDaysRemaining, warningDays };
  }
  if (domain.lastTlsDaysRemaining <= warningDays) {
    return { status: 'warning', validTo: domain.lastTlsValidTo || null, daysRemaining: domain.lastTlsDaysRemaining, warningDays };
  }
  return { status: 'ok', validTo: domain.lastTlsValidTo || null, daysRemaining: domain.lastTlsDaysRemaining, warningDays };
}

function buildDomainOverview(domain, checks = []) {
  const sortedChecks = [...checks].sort((a, b) => new Date(a.checkedAt) - new Date(b.checkedAt));
  const incidents = buildIncidents(sortedChecks);
  const incidents24h = incidents.filter((incident) => new Date(incident.startedAt).getTime() >= Date.now() - 24 * 60 * 60 * 1000);
  const incidents7d = incidents.filter((incident) => new Date(incident.startedAt).getTime() >= Date.now() - 7 * 24 * 60 * 60 * 1000);
  const incidents30d = incidents.filter((incident) => new Date(incident.startedAt).getTime() >= Date.now() - 30 * 24 * 60 * 60 * 1000);

  return {
    windows: [
      summarizeWindow(checksSince(sortedChecks, 24), '24h', incidents24h.length),
      summarizeWindow(checksSince(sortedChecks, 24 * 7), '7d', incidents7d.length),
      summarizeWindow(checksSince(sortedChecks, 24 * 30), '30d', incidents30d.length)
    ],
    incidents: incidents.slice().reverse(),
    currentIncident: incidents.find((incident) => incident.isOpen) || null,
    history24h: buildHistory24h(sortedChecks),
    lastSuccessfulCheck: serializeCheck([...sortedChecks].reverse().find((check) => normalizedCheckStatus(check) === 'ok')),
    lastFailedCheck: serializeCheck([...sortedChecks].reverse().find((check) => normalizedCheckStatus(check) === 'error')),
    lastWarningCheck: serializeCheck([...sortedChecks].reverse().find((check) => normalizedCheckStatus(check) === 'warning')),
    lastRecoveryAt: domain.lastRecoveryAt || null,
    tls: buildTlsSummary(domain)
  };
}

function ownerSlug(owner) {
  return String(owner || 'all')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'all';
}

function summarizeChecks(checks = []) {
  const total = checks.length;
  const failures = checks.filter((check) => !check.ok).length;
  const warnings = checks.filter((check) => check.status === 'warning').length;
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
    recentWarningCount: warnings,
    medianResponseMs,
    p95ResponseMs,
    performanceStatus: performanceStatus(p95ResponseMs ?? medianResponseMs)
  };
}

function presentDomain(domain, summary = {}) {
  const tenant = domain.tenantId && typeof domain.tenantId === 'object' ? domain.tenantId : null;
  const recentIssueCount = summary.recentIssueCount || 0;
  const recentWarningCount = summary.recentWarningCount || 0;
  const hasCurrentIssue = domain.lastStatus === 'error';
  const hasCurrentWarning = domain.lastStatus === 'warning';
  const hasRecentIssue = recentIssueCount > 0 || Boolean(
    domain.lastFailureAt && Date.now() - domain.lastFailureAt.getTime() <= RECENT_ISSUE_MS
  );
  const stale = !domain.lastCheckedAt || Date.now() - new Date(domain.lastCheckedAt).getTime() > 35 * 60000;
  const displayStatus = stale ? 'unknown' : hasCurrentIssue
    ? 'error'
    : hasCurrentWarning || (hasRecentIssue && domain.lastStatus === 'ok')
      ? 'warning'
      : domain.lastStatus || 'unknown';

  return {
    id: String(domain._id),
    name: domain.name,
    baseUrl: domain.baseUrl,
    owner: domain.owner || 'EPDS',
    tenantId: tenant?._id ? String(tenant._id) : (domain.tenantId ? String(domain.tenantId) : null),
    tenantName: tenant?.name || null,
    tenantDisplayName: tenant?.displayName || tenant?.name || null,
    enabled: domain.enabled,
    monitoringState: domain.monitoringState,
    lastCheckedAt: domain.lastCheckedAt,
    lastStatus: domain.lastStatus,
    displayStatus,
    lastResponseMs: domain.lastResponseMs,
    lastStatusCode: domain.lastStatusCode,
    lastError: domain.lastError,
    lastErrorType: domain.lastErrorType,
    lastWarning: domain.lastWarning,
    lastWarningType: domain.lastWarningType,
    lastFinalUrl: domain.lastFinalUrl,
    lastRedirectCount: domain.lastRedirectCount,
    lastContentType: domain.lastContentType,
    lastContentLength: domain.lastContentLength,
    lastTlsValidTo: domain.lastTlsValidTo,
    lastTlsDaysRemaining: domain.lastTlsDaysRemaining,
    healthConfig: domainHealthConfig(domain),
    currentIssueSince: domain.currentIssueSince,
    lastFailureAt: domain.lastFailureAt,
    lastRecoveryAt: domain.lastRecoveryAt,
    recentIssueCount,
    recentWarningCount,
    availability: {
      status: stale ? 'unknown' : hasCurrentIssue ? 'error' : domain.lastStatus === 'unknown' ? 'unknown' : 'ok',
      uptimePercent: summary.uptimePercent ?? null,
      totalChecks: summary.totalChecks || 0,
      recentIssueCount,
      recentWarningCount
    },
    performance: {
      status: stale ? 'unknown' : summary.performanceStatus || performanceStatus(domain.lastResponseMs),
      lastResponseMs: domain.lastResponseMs,
      medianResponseMs: summary.medianResponseMs ?? null,
      p95ResponseMs: summary.p95ResponseMs ?? null
    },
    createdAt: domain.createdAt,
    updatedAt: domain.updatedAt
  };
}

async function buildDomainList(scope = {}) {
  const postgres = databaseEngine() === 'postgresql';
  const domains = postgres
    ? await domainHealthRepository.listMonitors({ tenantId: scope.tenantId || null, all: isGlobalTenant(scope) })
    : await DomainMonitor.find(domainScopeQuery(scope)).sort({ name: 1 }).populate('tenantId', 'name displayName').lean(false);
  const since = new Date(Date.now() - RECENT_ISSUE_MS);
  const visibleDomainIds = domains.map((domain) => domain._id);
  const checks = visibleDomainIds.length
    ? postgres
      ? await domainHealthRepository.listChecks(visibleDomainIds.map(String), since)
      : await DomainHealthCheck.find({ domainId: { $in: visibleDomainIds }, checkedAt: { $gte: since } })
      .select('domainId ok status responseMs')
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

async function loadChecksForDomains(domainIds = [], since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)) {
  if (!domainIds.length) return new Map();
  const checks = databaseEngine() === 'postgresql'
    ? (await domainHealthRepository.listChecks(domainIds.map(String), since)).reverse()
    : await DomainHealthCheck.find({ domainId: { $in: domainIds }, checkedAt: { $gte: since } })
    .sort({ checkedAt: 1 })
    .select('domainId checkedAt ok status statusCode responseMs finalUrl redirectCount contentType contentLength tlsValidTo tlsDaysRemaining errorType errorMessage warningType warningMessage')
    .lean();

  return checks.reduce((acc, check) => {
    const key = String(check.domainId);
    if (!acc.has(key)) acc.set(key, []);
    acc.get(key).push(check);
    return acc;
  }, new Map());
}

async function getDomainStatusDetails(domain, checks) {
  const summary = summarizeChecks(checksSince(checks, 24));
  return {
    domain: presentDomain(domain, summary),
    overview: buildDomainOverview(domain, checks)
  };
}

async function buildPublicStatusReport({ owner, scope = { role: 'SuperAdmin' } } = {}) {
  const ownerFilter = owner && owner !== 'all' ? { owner } : {};
  const domains = databaseEngine() === 'postgresql'
    ? await domainHealthRepository.listMonitors({ ...reportScope(scope), enabled: true, owner: ownerFilter.owner || null })
    : await DomainMonitor.find({ enabled: true, ...ownerFilter, ...(reportScope(scope).all ? {} : { tenantId: scope.tenantId || null }) }).sort({ name: 1 }).populate('tenantId', 'name displayName').lean(false);
  const domainIds = domains.map((domain) => domain._id);
  const [checksByDomain, pageSpeedByDomain] = await Promise.all([
    loadChecksForDomains(domainIds),
    getPublicPageSpeedSummaries(domainIds, { days: 30 })
  ]);
  const domainsWithOverview = domains.map((domain) => {
    const checks = checksByDomain.get(String(domain._id)) || [];
    const summary = summarizeChecks(checksSince(checks, 24));
    const details = { domain: presentDomain(domain, summary), overview: buildDomainOverview(domain, checks) };
    return {
      ...details,
      overview: { ...details.overview, incidents: details.overview.incidents.slice(0, 4) },
      pageSpeed: pageSpeedByDomain.get(String(domain._id))
    };
  });

  const summary = domainsWithOverview.reduce((acc, item) => {
    acc.domainCount += 1;
    if (item.domain.displayStatus === 'error') acc.errorCount += 1;
    else if (item.domain.displayStatus === 'warning') acc.warningCount += 1;
    else if (item.domain.displayStatus === 'ok') acc.okCount += 1;
    return acc;
  }, { domainCount: 0, okCount: 0, warningCount: 0, errorCount: 0 });

  return {
    owner: !owner || owner === 'all' ? 'All' : owner,
    ownerSlug: ownerSlug(owner || 'all'),
    generatedAt: new Date().toISOString(),
    summary,
    domains: domainsWithOverview.sort((a, b) => a.domain.name.localeCompare(b.domain.name))
  };
}

async function countRecentIssues(domainId) {
  const since = new Date(Date.now() - RECENT_ISSUE_MS);
  if (databaseEngine() === 'postgresql') return domainHealthRepository.countFailed(String(domainId), since);
  return DomainHealthCheck.countDocuments({ domainId, checkedAt: { $gte: since }, ok: false });
}

async function summarizeRecentChecks(domainId) {
  const since = new Date(Date.now() - RECENT_ISSUE_MS);
  const checks = databaseEngine() === 'postgresql'
    ? await domainHealthRepository.listChecks([String(domainId)], since)
    : await DomainHealthCheck.find({ domainId, checkedAt: { $gte: since } })
    .select('ok status responseMs')
    .lean();
  return summarizeChecks(checks);
}

async function publicResponse(url, config) {
  const lookup = (hostname, options, callback) => {
    dns.lookup(hostname, { all: true }).then(addresses => {
      if (!addresses.length || addresses.some(entry => isPrivateIp(entry.address))) return callback(new Error('Blocked address'));
      if (options?.all) return callback(null, addresses);
      callback(null, addresses[0].address, addresses[0].family);
    }, callback);
  };
  const httpAgent = new http.Agent({ lookup });
  const httpsAgent = new https.Agent({ lookup });
  const deadline = Date.now() + config.timeoutMs;
  try {
    for (let redirects = 0; ; redirects += 1) {
      await assertPublicUrl(url);
      if (Date.now() >= deadline) throw Object.assign(new Error('Request timeout'), { code: 'ECONNABORTED' });
      const response = await axios.get(url, {
        timeout: Math.max(1, deadline - Date.now()), maxRedirects: 0, httpAgent, httpsAgent,
        maxContentLength: 2 * 1024 * 1024, validateStatus: () => true,
        headers: { 'User-Agent': 'EPDS-Admin-DomainHealth/1.0' }
      });
      if (!config.followRedirects || ![301,302,303,307,308].includes(response.status) || !response.headers.location) {
        response.monitorRedirectCount = redirects;
        response.monitorFinalUrl = url;
        return response;
      }
      if (redirects >= 5) throw new Error('Too many redirects');
      const target = new URL(response.headers.location, url);
      if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) throw new Error('Blocked redirect');
      url = target.href;
    }
  } finally { httpAgent.destroy(); httpsAgent.destroy(); }
}

async function performDomainProbe(domain) {
  const checkedAt = new Date();
  const startedAt = Date.now();
  const config = domainHealthConfig(domain);
  const checkUrl = checkUrlForDomain(domain, config);
  let result;

  try {
    const response = await publicResponse(checkUrl, config);
    const responseMs = Date.now() - startedAt;
    const expectedStatus = response.status >= config.expectedStatusMin && response.status <= config.expectedStatusMax;
    const redirectCount = response.monitorRedirectCount ?? responseRedirectCount(response);
    const finalUrl = response.monitorFinalUrl || responseFinalUrl(response);
    const tlsInfo = responseTlsInfo(response, checkedAt);
    let status = expectedStatus ? 'ok' : 'error';
    let warningType;
    let warningMessage;
    let errorType = expectedStatus ? undefined : 'http_status';
    let errorMessage = expectedStatus ? undefined : `HTTP ${response.status}`;

    if (expectedStatus && responseMs >= config.errorResponseMs) {
      status = 'warning';
      warningType = 'slow_response';
      warningMessage = `Response exceeded ${config.errorResponseMs} ms`;
    } else if (expectedStatus && responseMs >= config.warningResponseMs) {
      status = 'warning';
      warningType = 'slow_response';
      warningMessage = `Response exceeded ${config.warningResponseMs} ms`;
    } else if (expectedStatus && typeof tlsInfo.tlsDaysRemaining === 'number' && tlsInfo.tlsDaysRemaining <= 0) {
      status = 'error';
      errorType = 'tls_expired';
      errorMessage = 'TLS certificate is expired';
    } else if (expectedStatus && typeof tlsInfo.tlsDaysRemaining === 'number' && tlsInfo.tlsDaysRemaining <= config.tlsWarningDays) {
      status = 'warning';
      warningType = 'tls_expiring';
      warningMessage = `TLS certificate expires in ${tlsInfo.tlsDaysRemaining} days`;
    } else if (expectedStatus && redirectCount > 3) {
      status = 'warning';
      warningType = 'redirect_chain';
      warningMessage = `${redirectCount} redirects before final response`;
    }

    result = {
      checkedAt,
      ok: status !== 'error',
      status,
      statusCode: response.status,
      responseMs,
      finalUrl,
      redirectCount,
      contentType: response.headers?.['content-type'],
      contentLength: Number(response.headers?.['content-length']) || undefined,
      ...tlsInfo,
      errorType,
      errorMessage,
      warningType,
      warningMessage
    };
  } catch (err) {
    const responseMs = Date.now() - startedAt;
    const isTimeout = err.code === 'ECONNABORTED' || /timeout/i.test(err.message || '');
    const isDns = ['ENOTFOUND', 'EAI_AGAIN', 'ENODATA'].includes(err.code);
    const isTls = ['CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(err.code);
    result = {
      checkedAt,
      ok: false,
      status: 'error',
      responseMs,
      errorType: isTimeout ? 'timeout' : isDns ? 'dns' : isTls ? 'tls' : err.statusCode ? 'blocked_host' : 'connection',
      errorMessage: isTimeout ? `Request timed out after ${config.timeoutMs} ms` : (err.message || 'Request failed')
    };
  }

  return result;
}

const runningChecks = new Map();
async function runDomainCheck(domain) {
  const id = String(domain._id);
  if (runningChecks.has(id)) return runningChecks.get(id);
  const promise = withJobLease(`domain-check:${id}`, 10 * 60000, () => runConfirmedDomainCheck(domain))
    .then(outcome => outcome.acquired ? outcome.value : { confirmed: false, status: domain.lastStatus, ok: domain.lastStatus !== 'error', checkedAt: domain.lastCheckedAt })
    .finally(() => runningChecks.delete(id));
  runningChecks.set(id, promise);
  return promise;
}

async function runConfirmedDomainCheck(domain) {
  const fresh = databaseEngine() === 'postgresql' ? await domainHealthRepository.findMonitor(String(domain._id), { all: true }) : await DomainMonitor.findById(domain._id);
  if (!fresh || !fresh.enabled) return { confirmed: false, status: 'unknown', ok: false };
  if (typeof domain.set === 'function') domain.set(fresh.toObject());
  else Object.assign(domain, fresh);
  const previous = domain.lastStatus;
  if (domain.monitoringState?.pendingNotification) {
    const pending = domain.monitoringState.pendingNotification;
    await require('./domainNotificationService').enqueueDomainTransition(domain, pending.event, pending.at);
  }
  const remoteProbes = remoteProbeConfiguration().map(probe => ({ name: probe.name, run: async () => {
    const response = await axios.post(probe.url, { baseUrl: domain.baseUrl, healthConfig: domainHealthConfig(domain) }, {
      timeout: domainHealthConfig(domain).timeoutMs + 5000, maxRedirects: 0,
      headers: { Authorization: `Bearer ${probe.token}` }
    });
    const result = response.data;
    if (!result || typeof result.ok !== 'boolean' || !['ok', 'warning', 'error'].includes(result.status) || result.ok !== (result.status !== 'error') || !Number.isFinite(Date.parse(result.checkedAt))) throw new Error('Invalid remote measurement');
    return result;
  }}));
  const measurement = await confirmMeasurement({ localProbe: () => performDomainProbe(domain), remoteProbes, recovering: previous === 'error' });
  domain.monitoringState = { lastAttemptAt: new Date(), decision: measurement.decision, locations: measurement.locations, quorum: measurement.quorum };
  if (measurement.decision === 'unknown') {
    if (databaseEngine() === 'postgresql') await domainHealthRepository.saveMonitor(domain);
    else await domain.save();
    return { confirmed: false, ok: previous !== 'error', status: previous || 'unknown', checkedAt: domain.lastCheckedAt, measurement: domain.monitoringState };
  }
  const result = { ...measurement.result, checkedAt: measurement.confirmedAt, confirmed: true };
  const checkPayload = {
    domainId: domain._id,
    measurement: { attempts: measurement.attempts, locations: measurement.locations, quorum: measurement.quorum },
    checkedAt: result.checkedAt,
    ok: result.ok,
    status: result.status,
    statusCode: result.statusCode,
    responseMs: result.responseMs,
    finalUrl: result.finalUrl,
    redirectCount: result.redirectCount,
    contentType: result.contentType,
    contentLength: result.contentLength,
    tlsValidTo: result.tlsValidTo,
    tlsDaysRemaining: result.tlsDaysRemaining,
    errorType: result.errorType,
    errorMessage: result.errorMessage,
    warningType: result.warningType,
    warningMessage: result.warningMessage
  };
  if (databaseEngine() === 'postgresql') await domainHealthRepository.createCheck(checkPayload);
  else await DomainHealthCheck.create(checkPayload);

  const wasFailing = domain.lastStatus === 'error';
  domain.lastCheckedAt = result.checkedAt;
  domain.lastStatus = result.status;
  domain.lastResponseMs = result.responseMs;
  domain.lastStatusCode = result.statusCode;
  domain.lastError = result.errorMessage;
  domain.lastErrorType = result.errorType;
  domain.lastWarning = result.warningMessage;
  domain.lastWarningType = result.warningType;
  domain.lastFinalUrl = result.finalUrl;
  domain.lastRedirectCount = result.redirectCount;
  domain.lastContentType = result.contentType;
  domain.lastContentLength = result.contentLength;
  domain.lastTlsValidTo = result.tlsValidTo;
  domain.lastTlsDaysRemaining = result.tlsDaysRemaining;

  if (result.ok) {
    if (wasFailing) domain.lastRecoveryAt = result.checkedAt;
    domain.currentIssueSince = undefined;
  } else {
    domain.lastFailureAt = result.checkedAt;
    if (!wasFailing) domain.currentIssueSince = result.checkedAt;
  }

  const transitioned = (previous === 'error') !== (result.status === 'error') && (previous === 'error' || result.status === 'error');
  if (transitioned) domain.monitoringState.pendingNotification = {
    event: result.status === 'error' ? 'down' : 'recovered',
    at: result.status === 'error' ? domain.currentIssueSince : domain.lastRecoveryAt
  };
  if (databaseEngine() === 'postgresql') await domainHealthRepository.saveMonitor(domain);
  else await domain.save();
  if (transitioned) {
    const pending = domain.monitoringState.pendingNotification;
    await require('./domainNotificationService').enqueueDomainTransition(domain, pending.event, pending.at);
  }
  return result;
}

let monitorTimer;
let isRunning = false;
let lastRunStartedAt = null;
let lastRunCompletedAt = null;
let lastRunDomainCount = 0;

async function runScheduledChecks() {
  if (isRunning) return;
  isRunning = true;
  lastRunStartedAt = new Date();
  lastRunDomainCount = 0;
  try {
    await withJobLease('domain-health-monitor', 20 * 60 * 1000, async () => {
      const domains = databaseEngine() === 'postgresql'
        ? await domainHealthRepository.listMonitors({ all: true, enabled: true })
        : await DomainMonitor.find({ enabled: true });
      lastRunDomainCount = domains.length;
      const concurrency = Math.max(1, Number(process.env.DOMAIN_HEALTH_CONCURRENCY || 8));
      await mapWithConcurrency(domains, concurrency, async (domain) => {
        try { await runDomainCheck(domain); } catch (err) {
          console.error(`[domain-monitor] ${domain.baseUrl} check failed:`, err.message);
        }
      });
    });
  } catch (err) {
    console.error('[domain-monitor] scheduled checks failed:', err.message);
  } finally {
    lastRunCompletedAt = new Date();
    isRunning = false;
    const { rebuildAllSnapshots } = require('./domainStatusReadModelService');
    void rebuildAllSnapshots().catch((err) => console.error('[domain-status] post-monitor rebuild failed:', err.message));
  }
}

function getDomainMonitorRuntime() {
  return {
    isRunning,
    intervalMs: MONITOR_INTERVAL_MS,
    lastRunStartedAt,
    lastRunCompletedAt,
    lastRunDomainCount
  };
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
  buildDomainOverview,
  buildPublicStatusReport,
  domainScopeQuery,
  getDomainStatusDetails,
  isGlobalTenant,
  ownerSlug,
  presentDomain,
  countRecentIssues,
  getDomainMonitorRuntime,
  summarizeRecentChecks,
  runDomainCheck,
  performDomainProbe,
  buildIncidents,
  summarizeWindow,
  startDomainHealthMonitor
};
