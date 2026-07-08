const dns = require('dns').promises;
const DomainMonitor = require('../models/domainMonitor');
const DomainHealthCheck = require('../models/domainHealthCheck');
const { getDomainPageSpeedOverview, storeDomainPageSpeedScan } = require('../services/pageSpeedService');
const { generatePublicStatusPdf } = require('../services/domainStatusPdfService');
const {
  normalizeBaseUrl,
  assertPublicUrl,
  buildDomainList,
  buildPublicStatusReport,
  getDomainStatusDetails,
  domainScopeQuery,
  getDomainMonitorRuntime,
  ownerSlug,
  presentDomain,
  runDomainCheck,
  summarizeRecentChecks
} = require('../services/domainMonitorService');

function normalizeDomain(input) {
  const raw = String(input || '').trim().toLowerCase();
  return raw.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
}

function status(ok, warning = false) {
  if (ok) return 'ok';
  return warning ? 'warning' : 'error';
}

function normalizeOwner(input) {
  const raw = String(input || '').trim();
  return DomainMonitor.owners.find((owner) => owner.toLowerCase() === raw.toLowerCase()) || null;
}

function ownerFromSlug(input) {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw || raw === 'all') return 'All';
  return DomainMonitor.owners.find((owner) => ownerSlug(owner) === raw) || null;
}

function boundedNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(Math.round(number), min), max);
}

function normalizeCheckPath(input) {
  const raw = String(input || '').trim();
  if (!raw || raw === '/') return '';
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function normalizeHealthConfig(input = {}) {
  const expectedStatusMin = boundedNumber(input.expectedStatusMin, 200, 100, 599);
  const expectedStatusMax = boundedNumber(input.expectedStatusMax, 399, expectedStatusMin, 599);
  const warningResponseMs = boundedNumber(input.warningResponseMs, 2500, 100, 60000);
  const errorResponseMs = boundedNumber(input.errorResponseMs, 10000, warningResponseMs, 120000);

  return {
    checkPath: normalizeCheckPath(input.checkPath),
    expectedStatusMin,
    expectedStatusMax,
    timeoutMs: boundedNumber(input.timeoutMs, 10000, 1000, 120000),
    warningResponseMs,
    errorResponseMs,
    followRedirects: input.followRedirects !== false,
    tlsWarningDays: boundedNumber(input.tlsWarningDays, 30, 1, 365)
  };
}

exports.checkDomainHealth = async (req, res) => {
  const domain = normalizeDomain(req.query.domain);
  const selector = String(req.query.selector || 'default').trim().toLowerCase();
  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
    return res.status(400).json({ error: 'Valid domain is required' });
  }

  const result = {
    domain,
    checkedAt: new Date().toISOString(),
    records: {}
  };

  const checks = await Promise.allSettled([
    dns.resolveMx(domain),
    dns.resolveTxt(domain),
    dns.resolveTxt(`_dmarc.${domain}`),
    selector ? dns.resolveTxt(`${selector}._domainkey.${domain}`) : Promise.resolve([])
  ]);

  const mx = checks[0].status === 'fulfilled' ? checks[0].value : [];
  const txt = checks[1].status === 'fulfilled' ? checks[1].value.map((r) => r.join('')) : [];
  const dmarc = checks[2].status === 'fulfilled' ? checks[2].value.map((r) => r.join('')) : [];
  const dkim = checks[3].status === 'fulfilled' ? checks[3].value.map((r) => r.join('')) : [];
  const spf = txt.filter((value) => /^v=spf1\b/i.test(value));
  const dmarcPolicy = dmarc.find((value) => /^v=dmarc1\b/i.test(value)) || '';

  result.records.mx = { status: status(mx.length > 0), values: mx.sort((a, b) => a.priority - b.priority) };
  result.records.spf = { status: status(spf.length === 1, spf.length > 1), values: spf };
  result.records.dmarc = {
    status: status(Boolean(dmarcPolicy && /;\s*p=(quarantine|reject)\b/i.test(dmarcPolicy)), Boolean(dmarcPolicy)),
    values: dmarc
  };
  result.records.dkim = {
    status: status(dkim.some((value) => /^v=dkim1\b/i.test(value)), true),
    selector,
    values: dkim
  };

  result.summary = Object.values(result.records).every((record) => record.status === 'ok')
    ? 'ok'
    : Object.values(result.records).some((record) => record.status === 'error')
      ? 'error'
      : 'warning';

  return res.json(result);
};

exports.listDomains = async (req, res, next) => {
  try {
    const domains = await buildDomainList(req.scope);
    return res.json({ domains, monitor: getDomainMonitorRuntime() });
  } catch (err) {
    return next(err);
  }
};

exports.createDomain = async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim();
    const normalizedUrl = normalizeBaseUrl(req.body?.baseUrl);
    const owner = normalizeOwner(req.body?.owner);

    if (!name) return res.status(400).json({ error: 'Name is required' });
    if (!owner) return res.status(400).json({ error: 'Valid owner is required' });
    await assertPublicUrl(normalizedUrl);

    const domain = await DomainMonitor.create({
      name,
      baseUrl: normalizedUrl,
      normalizedUrl,
      owner,
      tenantId: req.scope?.tenantId,
      enabled: req.body?.enabled !== false,
      healthConfig: normalizeHealthConfig(req.body?.healthConfig),
      createdBy: req.userId
    });

    if (domain.enabled) await runDomainCheck(domain);
    const summary = await summarizeRecentChecks(domain._id);
    return res.status(201).json({ domain: presentDomain(domain, summary) });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Domain URL already exists' });
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    return next(err);
  }
};

exports.updateDomain = async (req, res, next) => {
  try {
    const domain = await DomainMonitor.findOne({ _id: req.params.id, ...domainScopeQuery(req.scope) });
    if (!domain) return res.status(404).json({ error: 'Domain not found' });

    if (Object.prototype.hasOwnProperty.call(req.body, 'name')) {
      const name = String(req.body.name || '').trim();
      if (!name) return res.status(400).json({ error: 'Name is required' });
      domain.name = name;
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'baseUrl')) {
      const normalizedUrl = normalizeBaseUrl(req.body.baseUrl);
      await assertPublicUrl(normalizedUrl);
      domain.baseUrl = normalizedUrl;
      domain.normalizedUrl = normalizedUrl;
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'owner')) {
      const owner = normalizeOwner(req.body.owner);
      if (!owner) return res.status(400).json({ error: 'Valid owner is required' });
      domain.owner = owner;
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'enabled')) {
      domain.enabled = req.body.enabled !== false;
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'healthConfig')) {
      domain.healthConfig = normalizeHealthConfig(req.body.healthConfig);
    }

    domain.updatedBy = req.userId;
    await domain.save();
    const summary = await summarizeRecentChecks(domain._id);
    return res.json({ domain: presentDomain(domain, summary) });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Domain URL already exists' });
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    return next(err);
  }
};

exports.deleteDomain = async (req, res, next) => {
  try {
    const domain = await DomainMonitor.findOne({ _id: req.params.id, ...domainScopeQuery(req.scope) });
    if (!domain) return res.status(404).json({ error: 'Domain not found' });
    await DomainHealthCheck.deleteMany({ domainId: domain._id });
    await domain.deleteOne();
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
};

exports.checkDomainNow = async (req, res, next) => {
  try {
    const domain = await DomainMonitor.findOne({ _id: req.params.id, ...domainScopeQuery(req.scope) });
    if (!domain) return res.status(404).json({ error: 'Domain not found' });

    const check = await runDomainCheck(domain);
    const summary = await summarizeRecentChecks(domain._id);
    return res.json({ domain: presentDomain(domain, summary), check });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    return next(err);
  }
};

exports.deepScanDomain = async (req, res, next) => {
  try {
    const domain = await DomainMonitor.findOne({ _id: req.params.id, ...domainScopeQuery(req.scope) });
    if (!domain) return res.status(404).json({ error: 'Domain not found' });

    const result = await storeDomainPageSpeedScan(domain, 'manual');
    return res.json({
      domain: presentDomain(domain, await summarizeRecentChecks(domain._id)),
      ...result
    });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    return next(err);
  }
};

exports.getDomainPageSpeed = async (req, res, next) => {
  try {
    const domain = await DomainMonitor.findOne({ _id: req.params.id, ...domainScopeQuery(req.scope) });
    if (!domain) return res.status(404).json({ error: 'Domain not found' });

    const pageSpeed = await getDomainPageSpeedOverview(domain._id);
    return res.json({
      domain: presentDomain(domain, await summarizeRecentChecks(domain._id)),
      ...pageSpeed
    });
  } catch (err) {
    return next(err);
  }
};

exports.getDomainChecks = async (req, res, next) => {
  try {
    const domain = await DomainMonitor.findOne({ _id: req.params.id, ...domainScopeQuery(req.scope) });
    if (!domain) return res.status(404).json({ error: 'Domain not found' });

    const range = String(req.query.range || '24h');
    const hours = range === '7d' ? 24 * 7 : range === '30d' ? 24 * 30 : 24;
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const checks = await DomainHealthCheck.find({ domainId: domain._id, checkedAt: { $gte: since } })
      .sort({ checkedAt: 1 })
      .limit(3000)
      .lean();

    const details = await getDomainStatusDetails(domain, checks);

    return res.json({
      domain: details.domain,
      overview: details.overview,
      checks: checks.map((check) => ({
        id: String(check._id),
        checkedAt: check.checkedAt,
        ok: check.ok,
        status: check.status || (check.ok ? 'ok' : 'error'),
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
      }))
    });
  } catch (err) {
    return next(err);
  }
};

exports.getPublicStatusReport = async (req, res, next) => {
  try {
    const owner = ownerFromSlug(req.params.owner);
    if (!owner) return res.status(404).json({ error: 'Owner not found' });
    const report = await buildPublicStatusReport({ owner: owner === 'All' ? 'all' : owner });
    return res.json(report);
  } catch (err) {
    return next(err);
  }
};

exports.downloadPublicStatusReportPdf = async (req, res, next) => {
  try {
    const owner = ownerFromSlug(req.params.owner);
    if (!owner) return res.status(404).json({ error: 'Owner not found' });
    const report = await buildPublicStatusReport({ owner: owner === 'All' ? 'all' : owner });
    const pdf = await generatePublicStatusPdf(report);
    const fileOwner = owner === 'All' ? 'all-domains' : ownerSlug(owner);
    const fileDate = new Date(report.generatedAt).toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="domain-status-${fileOwner}-${fileDate}.pdf"`);
    return res.send(pdf);
  } catch (err) {
    return next(err);
  }
};
