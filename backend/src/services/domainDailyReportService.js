const mailService = require('./mailService');
const { buildDomainList } = require('./domainMonitorService');

const REPORT_TIME_ZONE = process.env.DOMAIN_DAILY_REPORT_TIME_ZONE || 'Europe/Budapest';
const REPORT_HOUR = Number(process.env.DOMAIN_DAILY_REPORT_HOUR || 7);
const REPORT_MINUTE = Number(process.env.DOMAIN_DAILY_REPORT_MINUTE || 0);
const DEFAULT_RECIPIENT = 'kovacs@epds.hu';

let reportTimer;
let isSending = false;

function isEnabled() {
  return String(process.env.DOMAIN_DAILY_REPORT_ENABLED || 'true').toLowerCase() !== 'false';
}

function recipientList() {
  return String(process.env.DOMAIN_DAILY_REPORT_TO || DEFAULT_RECIPIENT)
    .split(',')
    .map((address) => address.trim())
    .filter(Boolean);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function timeZoneParts(date, timeZone = REPORT_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
}

function timeZoneOffsetMs(date, timeZone = REPORT_TIME_ZONE) {
  const parts = timeZoneParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - date.getTime();
}

function zonedTimeToUtc({ year, month, day, hour, minute, second = 0 }, timeZone = REPORT_TIME_ZONE) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const first = new Date(utcGuess - timeZoneOffsetMs(new Date(utcGuess), timeZone));
  return new Date(utcGuess - timeZoneOffsetMs(first, timeZone));
}

function nextReportDate(now = new Date()) {
  const local = timeZoneParts(now);
  let target = zonedTimeToUtc({
    year: local.year,
    month: local.month,
    day: local.day,
    hour: REPORT_HOUR,
    minute: REPORT_MINUTE
  });

  if (target <= now) {
    const tomorrowUtc = Date.UTC(local.year, local.month - 1, local.day + 1, 12, 0, 0);
    const tomorrow = timeZoneParts(new Date(tomorrowUtc));
    target = zonedTimeToUtc({
      year: tomorrow.year,
      month: tomorrow.month,
      day: tomorrow.day,
      hour: REPORT_HOUR,
      minute: REPORT_MINUTE
    });
  }

  return target;
}

function statusLabel(domain) {
  if (domain.displayStatus === 'error') return 'Down';
  if (domain.displayStatus === 'warning') return 'Warning';
  if (domain.displayStatus === 'ok') return 'Healthy';
  return 'No data';
}

function performanceLabel(domain) {
  const status = domain.performance?.status || 'unknown';
  if (status === 'very_slow') return 'Very slow';
  if (status === 'slow') return 'Slow';
  if (status === 'ok') return 'OK';
  return 'No data';
}

function issueText(domain) {
  if (domain.displayStatus === 'error') return domain.lastError || 'Current issue';
  if (domain.displayStatus === 'warning') return domain.lastWarning || `${domain.recentWarningCount || 0} warning in 24h`;
  if (domain.displayStatus === 'ok') return 'No recent issues';
  return 'No check yet';
}

function formatDate(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('hu-HU', {
    timeZone: REPORT_TIME_ZONE,
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
}

function msText(value) {
  return typeof value === 'number' ? `${Math.round(value)} ms` : '-';
}

function uptimeText(domain) {
  const uptime = domain.availability?.uptimePercent;
  return typeof uptime === 'number' ? `${uptime}%` : '-';
}

function tlsText(domain) {
  const days = domain.lastTlsDaysRemaining;
  if (typeof days !== 'number') return '-';
  if (days <= 0) return 'Expired';
  return `${days} nap`;
}

function redirectText(domain) {
  return typeof domain.lastRedirectCount === 'number' ? String(domain.lastRedirectCount) : '-';
}

function rowColor(domain) {
  if (domain.displayStatus === 'error') return '#fef2f2';
  if (domain.displayStatus === 'warning') return '#fffbeb';
  if (domain.performance?.status === 'very_slow') return '#fff7ed';
  return '#ffffff';
}

function buildReportHtml(domains) {
  const generatedAt = new Intl.DateTimeFormat('hu-HU', {
    timeZone: REPORT_TIME_ZONE,
    dateStyle: 'full',
    timeStyle: 'short'
  }).format(new Date());

  const rows = domains.map((domain) => `
    <tr style="background:${rowColor(domain)}">
      <td>${escapeHtml(domain.name)}</td>
      <td>${escapeHtml(domain.baseUrl)}</td>
      <td>${escapeHtml(domain.owner || '-')}</td>
      <td><strong>${escapeHtml(statusLabel(domain))}</strong></td>
      <td>${escapeHtml(performanceLabel(domain))}</td>
      <td>${escapeHtml(msText(domain.lastResponseMs))}</td>
      <td>${escapeHtml(tlsText(domain))}</td>
      <td>${escapeHtml(redirectText(domain))}</td>
      <td>${escapeHtml(uptimeText(domain))}</td>
      <td>${escapeHtml(formatDate(domain.lastCheckedAt))}</td>
      <td>${escapeHtml(issueText(domain))}</td>
    </tr>
  `).join('');

  return `
    <div style="font-family:Arial,sans-serif;color:#111827">
      <h2 style="margin:0 0 8px">EPDS Admin - Domain Health napi riport</h2>
      <p style="margin:0 0 18px;color:#6b7280">Generálva: ${escapeHtml(generatedAt)}</p>
      <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;font-size:13px">
        <thead>
          <tr style="background:#f8fafc">
            <th align="left" style="padding:10px;border-bottom:1px solid #e5e7eb">Domain</th>
            <th align="left" style="padding:10px;border-bottom:1px solid #e5e7eb">URL</th>
            <th align="left" style="padding:10px;border-bottom:1px solid #e5e7eb">Tulajdonos</th>
            <th align="left" style="padding:10px;border-bottom:1px solid #e5e7eb">Státusz</th>
            <th align="left" style="padding:10px;border-bottom:1px solid #e5e7eb">Performance</th>
            <th align="left" style="padding:10px;border-bottom:1px solid #e5e7eb">Utolsó válasz</th>
            <th align="left" style="padding:10px;border-bottom:1px solid #e5e7eb">TLS</th>
            <th align="left" style="padding:10px;border-bottom:1px solid #e5e7eb">Redirect</th>
            <th align="left" style="padding:10px;border-bottom:1px solid #e5e7eb">24h uptime</th>
            <th align="left" style="padding:10px;border-bottom:1px solid #e5e7eb">Utolsó mérés</th>
            <th align="left" style="padding:10px;border-bottom:1px solid #e5e7eb">Issue</th>
          </tr>
        </thead>
        <tbody>
          ${rows || '<tr><td colspan="11" style="padding:12px;color:#6b7280">Nincs aktív domain.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

async function sendDomainDailyReport() {
  if (!isEnabled()) return;
  if (isSending) return;
  isSending = true;
  try {
    const to = recipientList();
    if (!to.length) throw new Error('DOMAIN_DAILY_REPORT_TO is empty');
    const domains = (await buildDomainList({ role: 'SuperAdmin' }))
      .filter((domain) => domain.enabled !== false);
    await mailService.sendMail({
      to,
      subject: `EPDS Admin Domain Health riport - ${new Intl.DateTimeFormat('hu-HU', { timeZone: REPORT_TIME_ZONE }).format(new Date())}`,
      html: buildReportHtml(domains)
    });
    console.log(`[domain-report] daily report sent to ${to.join(', ')}`);
  } catch (err) {
    console.error('[domain-report] daily report failed:', err.message);
  } finally {
    isSending = false;
  }
}

function scheduleNextReport() {
  if (!isEnabled()) {
    console.log('[domain-report] daily report disabled');
    return;
  }

  const next = nextReportDate();
  const delay = Math.max(next.getTime() - Date.now(), 1000);
  reportTimer = setTimeout(async () => {
    await sendDomainDailyReport();
    scheduleNextReport();
  }, delay);
  reportTimer.unref?.();
  console.log(`[domain-report] next daily report scheduled for ${next.toISOString()} (${REPORT_TIME_ZONE})`);
}

function startDomainDailyReportScheduler() {
  if (reportTimer) return;
  scheduleNextReport();
}

module.exports = {
  buildReportHtml,
  nextReportDate,
  sendDomainDailyReport,
  startDomainDailyReportScheduler
};
