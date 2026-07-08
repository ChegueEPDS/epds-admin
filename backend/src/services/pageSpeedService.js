const axios = require('axios');
const DomainPageSpeedScan = require('../models/domainPageSpeedScan');

const PAGESPEED_ENDPOINT = 'https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed';
const PAGESPEED_TIMEOUT_MS = Number(process.env.PAGESPEED_TIMEOUT_MS || 90000);

function scoreToPercent(score) {
  return typeof score === 'number' ? Math.round(score * 100) : null;
}

function auditMetric(audits, key) {
  const audit = audits?.[key];
  if (!audit) return null;
  return {
    id: key,
    title: audit.title,
    displayValue: audit.displayValue || null,
    numericValue: typeof audit.numericValue === 'number' ? audit.numericValue : null,
    score: typeof audit.score === 'number' ? audit.score : null
  };
}

function topOpportunities(audits = {}) {
  return Object.values(audits)
    .filter((audit) => audit?.details && typeof audit.details.overallSavingsMs === 'number' && audit.details.overallSavingsMs > 0)
    .sort((a, b) => b.details.overallSavingsMs - a.details.overallSavingsMs)
    .slice(0, 5)
    .map((audit) => ({
      id: audit.id,
      title: audit.title,
      displayValue: audit.displayValue || null,
      savingsMs: Math.round(audit.details.overallSavingsMs)
    }));
}

function compactPageSpeedResult(payload, strategy) {
  const lighthouse = payload?.lighthouseResult || {};
  const categories = lighthouse.categories || {};
  const audits = lighthouse.audits || {};

  return {
    strategy,
    requestedUrl: lighthouse.requestedUrl || payload?.id || null,
    finalUrl: lighthouse.finalUrl || payload?.id || null,
    fetchedAt: lighthouse.fetchTime || payload?.analysisUTCTimestamp || new Date().toISOString(),
    lighthouseVersion: lighthouse.lighthouseVersion || null,
    userAgent: lighthouse.userAgent || null,
    scores: {
      performance: scoreToPercent(categories.performance?.score),
      accessibility: scoreToPercent(categories.accessibility?.score),
      bestPractices: scoreToPercent(categories['best-practices']?.score),
      seo: scoreToPercent(categories.seo?.score)
    },
    metrics: {
      firstContentfulPaint: auditMetric(audits, 'first-contentful-paint'),
      largestContentfulPaint: auditMetric(audits, 'largest-contentful-paint'),
      cumulativeLayoutShift: auditMetric(audits, 'cumulative-layout-shift'),
      totalBlockingTime: auditMetric(audits, 'total-blocking-time'),
      speedIndex: auditMetric(audits, 'speed-index')
    },
    opportunities: topOpportunities(audits),
    warnings: Array.isArray(lighthouse.runWarnings) ? lighthouse.runWarnings : [],
    runtimeError: lighthouse.runtimeError || null
  };
}

async function runPageSpeed(url, strategy) {
  const params = {
    url,
    strategy,
    category: ['PERFORMANCE', 'ACCESSIBILITY', 'BEST_PRACTICES', 'SEO'],
    locale: 'en'
  };
  if (process.env.PAGESPEED_API_KEY) params.key = process.env.PAGESPEED_API_KEY;

  const response = await axios.get(PAGESPEED_ENDPOINT, {
    params,
    timeout: PAGESPEED_TIMEOUT_MS,
    paramsSerializer: { indexes: null },
    validateStatus: () => true
  });

  if (response.status < 200 || response.status >= 300) {
    const message = response.data?.error?.message || `PageSpeed API returned HTTP ${response.status}`;
    throw Object.assign(new Error(message), { statusCode: response.status });
  }

  return compactPageSpeedResult(response.data, strategy);
}

async function runDeepScan(url) {
  const checkedAt = new Date().toISOString();
  const settled = await Promise.allSettled([
    runPageSpeed(url, 'mobile'),
    runPageSpeed(url, 'desktop')
  ]);

  const scans = settled.map((result, index) => {
    const strategy = index === 0 ? 'mobile' : 'desktop';
    if (result.status === 'fulfilled') return { ok: true, ...result.value };
    return {
      ok: false,
      strategy,
      error: result.reason?.message || 'PageSpeed scan failed'
    };
  });

  return { checkedAt, scans };
}

function scanPerformance(scan) {
  return scan?.ok && typeof scan.scores?.performance === 'number' ? scan.scores.performance : null;
}

function scanMetricValue(scan, key) {
  const metric = scan?.metrics?.[key];
  return scan?.ok && typeof metric?.numericValue === 'number' ? metric.numericValue : null;
}

function compactStoredScan(doc) {
  if (!doc) return null;
  return {
    id: String(doc._id),
    domainId: String(doc.domainId),
    checkedAt: doc.checkedAt,
    source: doc.source,
    scans: doc.scans || []
  };
}

function buildPageSpeedHistory(scans = []) {
  return scans.map((scanDoc) => {
    const mobile = (scanDoc.scans || []).find((scan) => scan.strategy === 'mobile');
    const desktop = (scanDoc.scans || []).find((scan) => scan.strategy === 'desktop');
    return {
      id: String(scanDoc._id),
      checkedAt: scanDoc.checkedAt,
      source: scanDoc.source,
      mobilePerformance: scanPerformance(mobile),
      desktopPerformance: scanPerformance(desktop),
      mobileLcp: scanMetricValue(mobile, 'largestContentfulPaint'),
      desktopLcp: scanMetricValue(desktop, 'largestContentfulPaint'),
      mobileCls: scanMetricValue(mobile, 'cumulativeLayoutShift'),
      desktopCls: scanMetricValue(desktop, 'cumulativeLayoutShift')
    };
  });
}

function average(values) {
  const numbers = values.filter((value) => typeof value === 'number');
  if (!numbers.length) return null;
  return Math.round(numbers.reduce((sum, value) => sum + value, 0) / numbers.length);
}

function buildPageSpeedSummary(history = []) {
  return {
    count: history.length,
    mobilePerformanceAvg: average(history.map((item) => item.mobilePerformance)),
    desktopPerformanceAvg: average(history.map((item) => item.desktopPerformance)),
    mobileLcpAvg: average(history.map((item) => item.mobileLcp)),
    desktopLcpAvg: average(history.map((item) => item.desktopLcp))
  };
}

function lcpStatus(value) {
  if (typeof value !== 'number') return 'unknown';
  if (value <= 2500) return 'good';
  if (value <= 4000) return 'needs improvement';
  return 'poor';
}

function trendText(latest, previous) {
  if (typeof latest !== 'number' || typeof previous !== 'number') return '-';
  const delta = latest - previous;
  if (Math.abs(delta) < 2) return 'Stable';
  return delta > 0 ? `+${delta}` : `${delta}`;
}

function latestStrategyScan(latest, strategy) {
  return latest?.scans?.find((scan) => scan.strategy === strategy && scan.ok) || null;
}

function mainIssue(latest) {
  const mobile = latestStrategyScan(latest, 'mobile');
  const desktop = latestStrategyScan(latest, 'desktop');
  const issue = mobile?.opportunities?.[0] || desktop?.opportunities?.[0];
  return issue?.title || 'No major opportunity returned';
}

function buildPublicPageSpeedSummary(overview) {
  const latest = overview.latest;
  const mobile = latestStrategyScan(latest, 'mobile');
  const desktop = latestStrategyScan(latest, 'desktop');
  const latestHistory = overview.history[overview.history.length - 1] || null;
  const previous7d = [...overview.history]
    .reverse()
    .find((item) => item.id !== latestHistory?.id && Date.now() - new Date(item.checkedAt).getTime() <= 7 * 24 * 60 * 60 * 1000);
  const mobileLcp = latestHistory?.mobileLcp ?? null;
  const desktopLcp = latestHistory?.desktopLcp ?? null;
  const representativeLcp = typeof mobileLcp === 'number' ? mobileLcp : desktopLcp;

  return {
    latestCheckedAt: latest?.checkedAt || null,
    latestMobilePerformance: scanPerformance(mobile),
    latestDesktopPerformance: scanPerformance(desktop),
    trend7d: trendText(latestHistory?.mobilePerformance, previous7d?.mobilePerformance),
    lcpStatus: lcpStatus(representativeLcp),
    lcpMs: representativeLcp ?? null,
    mainIssue: latest ? mainIssue(latest) : 'No PageSpeed result yet'
  };
}

async function storeDomainPageSpeedScan(domain, source = 'manual') {
  const result = await runDeepScan(domain.baseUrl);
  const doc = await DomainPageSpeedScan.create({
    domainId: domain._id,
    checkedAt: new Date(result.checkedAt),
    source,
    scans: result.scans
  });
  return compactStoredScan(doc);
}

async function getDomainPageSpeedOverview(domainId, options = {}) {
  const days = Number(options.days || 30);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const scans = await DomainPageSpeedScan.find({ domainId, checkedAt: { $gte: since } })
    .sort({ checkedAt: -1 })
    .limit(60)
    .lean();
  const latest = scans[0] ? compactStoredScan(scans[0]) : null;
  const history = buildPageSpeedHistory([...scans].reverse());
  return {
    latest,
    history,
    summary: buildPageSpeedSummary(history),
    publicSummary: buildPublicPageSpeedSummary({ latest, history })
  };
}

module.exports = {
  buildPublicPageSpeedSummary,
  getDomainPageSpeedOverview,
  runDeepScan,
  storeDomainPageSpeedScan
};
