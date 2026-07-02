const dns = require('dns').promises;
const DomainMonitor = require('../models/domainMonitor');
const DomainHealthCheck = require('../models/domainHealthCheck');
const {
  normalizeBaseUrl,
  assertPublicUrl,
  buildDomainList,
  countRecentIssues,
  domainScopeQuery,
  presentDomain,
  runDomainCheck
} = require('../services/domainMonitorService');

function normalizeDomain(input) {
  const raw = String(input || '').trim().toLowerCase();
  return raw.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
}

function status(ok, warning = false) {
  if (ok) return 'ok';
  return warning ? 'warning' : 'error';
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
    return res.json({ domains });
  } catch (err) {
    return next(err);
  }
};

exports.createDomain = async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim();
    const normalizedUrl = normalizeBaseUrl(req.body?.baseUrl);

    if (!name) return res.status(400).json({ error: 'Name is required' });
    await assertPublicUrl(normalizedUrl);

    const domain = await DomainMonitor.create({
      name,
      baseUrl: normalizedUrl,
      normalizedUrl,
      tenantId: req.scope?.tenantId,
      enabled: req.body?.enabled !== false,
      createdBy: req.userId
    });

    return res.status(201).json({ domain: presentDomain(domain) });
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

    if (Object.prototype.hasOwnProperty.call(req.body, 'enabled')) {
      domain.enabled = req.body.enabled !== false;
    }

    domain.updatedBy = req.userId;
    await domain.save();
    return res.json({ domain: presentDomain(domain) });
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
    const recentIssueCount = await countRecentIssues(domain._id);
    return res.json({ domain: presentDomain(domain, recentIssueCount), check });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
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

    const recentIssueCount = await countRecentIssues(domain._id);

    return res.json({
      domain: presentDomain(domain, recentIssueCount),
      checks: checks.map((check) => ({
        id: String(check._id),
        checkedAt: check.checkedAt,
        ok: check.ok,
        statusCode: check.statusCode,
        responseMs: check.responseMs,
        errorType: check.errorType,
        errorMessage: check.errorMessage
      }))
    });
  } catch (err) {
    return next(err);
  }
};
