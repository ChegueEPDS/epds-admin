const axios = require('axios');

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

module.exports = {
  runDeepScan
};
