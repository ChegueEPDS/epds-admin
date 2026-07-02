const dns = require('dns').promises;

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
