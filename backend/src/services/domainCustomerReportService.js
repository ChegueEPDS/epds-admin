const SAFE_REASONS = {
  http_status: 'The service returned an unsuccessful response.', timeout: 'The service did not respond within the expected time.',
  dns: 'The service address could not be resolved.', connection: 'The service could not be reached.',
  tls: 'A secure connection could not be established.', tls_expired: 'The security certificate has expired.',
  tls_expiring: 'The security certificate will expire soon.', slow_response: 'The service is responding slowly.',
  redirect_chain: 'The service requires several redirects.', blocked_host: 'The service could not be checked.'
};
function safeIncident(incident) {
  if (!incident) return null;
  return { severity: incident.severity, reasonCode: incident.reasonCode,
    reasonText: SAFE_REASONS[incident.reasonCode] || 'A service issue was detected.',
    startedAt: incident.startedAt, endedAt: incident.endedAt, durationMs: incident.durationMs, isOpen: incident.isOpen };
}
function safeCheck(check) {
  return check ? { checkedAt: check.checkedAt, ok: check.ok, status: check.status, responseMs: check.responseMs } : null;
}
function sanitizeCustomerReport(report, now = Date.now()) {
  const domains = report.domains.map(item => {
    const source = item.domain;
    const stale = !source.lastCheckedAt || now - new Date(source.lastCheckedAt).getTime() > 35 * 60000;
    return {
      domain: { id: source.id, name: source.name, baseUrl: '', owner: source.owner,
        lastCheckedAt: source.lastCheckedAt, displayStatus: stale ? 'unknown' : source.displayStatus,
        availability: { ...source.availability, status: stale ? 'unknown' : source.availability?.status }, performance: source.performance, stale },
      overview: { windows: item.overview.windows, incidents: item.overview.incidents.map(safeIncident),
        currentIncident: safeIncident(item.overview.currentIncident), history24h: item.overview.history24h,
        tls: item.overview.tls, lastSuccessfulCheck: safeCheck(item.overview.lastSuccessfulCheck),
        lastFailedCheck: safeCheck(item.overview.lastFailedCheck), lastRecoveryAt: item.overview.lastRecoveryAt },
      // Scores are safe; diagnostic URLs and free-form audit text are internal.
      pageSpeed: item.pageSpeed ? { latestCheckedAt: item.pageSpeed.latestCheckedAt,
        latestMobilePerformance: item.pageSpeed.latestMobilePerformance, latestDesktopPerformance: item.pageSpeed.latestDesktopPerformance,
        trend7d: item.pageSpeed.trend7d, lcpStatus: item.pageSpeed.lcpStatus } : null
    };
  });
  const summary = { domainCount: domains.length, okCount: 0, warningCount: 0, errorCount: 0, unknownCount: 0 };
  domains.forEach(item => { summary[({ ok: 'okCount', warning: 'warningCount', error: 'errorCount' })[item.domain.displayStatus] || 'unknownCount'] += 1; });
  return { owner: report.owner, ownerSlug: report.ownerSlug, generatedAt: report.generatedAt, summary, domains };
}
function reportScope(scope) {
  return { tenantId: scope?.tenantId || null, all: scope?.role === 'SuperAdmin' && !scope?.tenantId };
}
module.exports = { SAFE_REASONS, safeIncident, sanitizeCustomerReport, reportScope };
