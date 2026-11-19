const { monitoringText } = require('./monitoringTexts');
const mailService = require('./mailService');
const { escapeHtml } = require('./mailTemplates');
const { buildDomainList } = require('./domainMonitorService');
const { withJobLease } = require('./scheduledJobLeaseService');

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

function issueText(domain, language) {
  if (domain.displayStatus === 'error') return domain.lastError || 'Current issue';
  if (domain.displayStatus === 'warning') return domain.lastWarning || (language === 'hu' ? `${domain.recentWarningCount || 0} figyelmeztetés 24 órán belül` : `${domain.recentWarningCount || 0} warnings in 24h`);
  if (domain.displayStatus === 'ok') return 'No recent issues';
  return 'No check yet';
}

function formatDate(value, locale) {
  if (!value) return '-';
  return new Intl.DateTimeFormat(locale, {
    timeZone: REPORT_TIME_ZONE,
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
}

function msText(value) {
  return typeof value === 'number' ? `${Math.round(value)} ms` : '-';
}

function uptimeText(domain, locale) {
  const uptime = domain.availability?.uptimePercent;
  return typeof uptime === 'number' ? `${new Intl.NumberFormat(locale).format(uptime)}%` : '-';
}

function tlsText(domain, language) {
  const days = domain.lastTlsDaysRemaining;
  if (typeof days !== 'number') return '-';
  if (days <= 0) return monitoringText(language, 'Expired');
  return language === 'hu' ? `${days} nap` : `${days} days`;
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

function buildReportHtml(domains, language = 'hu') {
  const hu = language === 'hu';
  const locale = hu ? 'hu-HU' : 'en-GB';
  const t = (source) => monitoringText(language, source);
  const generatedAt = new Intl.DateTimeFormat(locale, {
    timeZone: REPORT_TIME_ZONE,
    dateStyle: 'full',
    timeStyle: 'short'
  }).format(new Date());

  const cards = domains.map((domain) => {
    const metrics = [
      [hu ? 'Válaszidő' : 'Response time', msText(domain.lastResponseMs)], [hu ? '24 órás rendelkezésre állás' : '24h uptime', uptimeText(domain, locale)],
      ['TLS', tlsText(domain, language)], [hu ? 'Átirányítások' : 'Redirects', redirectText(domain)],
      [hu ? 'Teljesítmény' : 'Performance', t(performanceLabel(domain))], [hu ? 'Utolsó mérés' : 'Last check', formatDate(domain.lastCheckedAt, locale)]
    ];
    const rows = metrics.map(([label, value]) => `
      <tr><th scope="row" align="left" style="padding:4px 8px 4px 0;color:#575048;font-weight:normal">${label}</th>
      <td align="right" style="padding:4px 0;font-weight:bold">${escapeHtml(value)}</td></tr>`).join('');
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;border:1px solid #e5dfd5">
      <tr><td bgcolor="${rowColor(domain)}" style="padding:12px 14px;border-bottom:1px solid #e5dfd5">
        <strong>${escapeHtml(domain.name)}</strong> &nbsp;·&nbsp; ${escapeHtml(t(statusLabel(domain)))}<br>
        <span style="font-size:13px;color:#575048">${escapeHtml(domain.baseUrl)} &nbsp;·&nbsp; ${escapeHtml(domain.owner || '-')}</span>
      </td></tr>
      <tr><td style="padding:10px 14px;font-size:13px">
        <table width="100%" cellpadding="0" cellspacing="0" aria-label="${hu ? 'Domainmutatók' : 'Domain metrics'}">${rows}</table>
        <p style="margin:10px 0 0;color:#575048">${escapeHtml(t(issueText(domain, language)))}</p>
      </td></tr>
    </table>`;
  }).join('');

  return `<p style="margin:0 0 18px;color:#575048">${hu ? 'Készült:' : 'Generated:'} ${escapeHtml(generatedAt)}</p>
    ${cards || (hu ? '<p>Nincs aktív domain.</p>' : '<p>No active domains.</p>')}`;
}

function dailyReportMail(domains, language = 'hu') {
  const hu = language === 'hu';
  const locale = hu ? 'hu-HU' : 'en-GB';
  const title = hu ? 'Napi domainjelentés' : 'Daily domain report';
  return {
    subject: `${title} – ${new Intl.DateTimeFormat(locale, { timeZone: REPORT_TIME_ZONE }).format(new Date())}`,
    html: buildReportHtml(domains, language),
    branding: { title, category: hu ? 'Domainfigyelés' : 'Domain Health',
      preheader: hu ? 'A figyelt szolgáltatások aktuális állapota.' : 'Current status of monitored services.', lang: language }
  };
}

async function sendDomainDailyReport() {
  if (!isEnabled()) return;
  if (isSending) return;
  isSending = true;
  try {
    await withJobLease(`domain-daily-report:${new Date().toISOString().slice(0, 10)}`, 23 * 60 * 60 * 1000, async () => {
      const to = recipientList();
      if (!to.length) throw new Error('DOMAIN_DAILY_REPORT_TO is empty');
      const domains = (await buildDomainList({ role: 'SuperAdmin' }))
        .filter((domain) => domain.enabled !== false);
      await mailService.sendMail({ to, ...dailyReportMail(domains, process.env.DOMAIN_DAILY_REPORT_LANGUAGE === 'en' ? 'en' : 'hu') });
      console.log(`[domain-report] daily report sent to ${to.join(', ')}`);
    }, { holdOnSuccess: true });
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
  dailyReportMail,
  nextReportDate,
  sendDomainDailyReport,
  startDomainDailyReportScheduler
};
