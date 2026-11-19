const mail = require('../services/mailService');
const { normalizeEmail, validEmail } = require('../services/accountInvitations');
const { accountMail, transitionMail, monthlyReportMail, forwardedMail, paragraph } = require('../services/mailTemplates');
const { dailyReportMail } = require('../services/domainDailyReportService');
const { generateMonthlyPdf } = require('../services/domainMonthlyPdfService');
const { calculateMonthlyMetrics, monthPeriod, previousMonth } = require('../services/domainMonthlyMetrics');

function sampleAccount(type, expiresIn) {
  return () => accountMail(type, 'https://example.com/', expiresIn);
}

async function sampleMonthlyReport() {
  const month = previousMonth();
  const period = monthPeriod(month);
  const from = period.from.toISOString();
  const to = period.to.toISOString();
  const pdf = await generateMonthlyPdf({
    month, from, to, customer: 'PandA sample report',
    domains: [{ name: 'Example service', metrics: calculateMonthlyMetrics([], period) }]
  });
  return {
    ...monthlyReportMail(month),
    attachments: [{ name: `sample-service-report-${month}.pdf`, contentType: 'application/pdf', bytes: pdf.toString('base64') }]
  };
}

const templates = new Map(Object.entries({
  'invite-password': ['Account invitation · Password', sampleAccount('invite-password', '72 hours')],
  'invite-microsoft': ['Account invitation · Microsoft', sampleAccount('invite-microsoft', '72 hours')],
  'invite-superadmin': ['SuperAdmin invitation', sampleAccount('invite-superadmin', '30 minutes')],
  'password-reset': ['Password reset', sampleAccount('password-reset', '30 minutes')],
  'account-recovery': ['Account recovery', sampleAccount('account-recovery', '30 minutes')],
  'domain-down': ['Domain Health · Service interruption', () => transitionMail('down', 'Example service', new Date())],
  'domain-restored': ['Domain Health · Service restored', () => transitionMail('up', 'Example service', new Date())],
  'domain-daily': ['Domain Health · Daily report', () => dailyReportMail([{
    name: 'Example service', baseUrl: 'https://example.com/', owner: 'Example team', displayStatus: 'ok',
    lastResponseMs: 238, lastTlsDaysRemaining: 64, lastRedirectCount: 0, lastCheckedAt: new Date(),
    performance: { status: 'ok' }, availability: { uptimePercent: 100 }
  }])],
  'domain-monthly': ['Domain Health · Monthly PDF report', sampleMonthlyReport],
  'manual-message': ['Mailbox · New message', () => ({
    subject: 'Sample message', html: paragraph('This is a sample message sent from PandA.')
  })],
  'forwarded-message': ['Mailbox · Forwarded message', () => forwardedMail(
    'Forwarding this for your reference.',
    paragraph('From: sender@example.com') + paragraph('This is the original sample message.')
  )]
}));

exports.list = (_req, res) => res.json({
  templates: Array.from(templates, ([id, [label]]) => ({ id, label }))
});

exports.sendTest = async (req, res) => {
  const template = templates.get(req.params.template);
  if (!template) return res.status(404).json({ error: 'Email template not found.' });
  const address = normalizeEmail(req.body?.to);
  if (!validEmail(address) || /[,;]/.test(address)) {
    return res.status(400).json({ error: 'Enter a single valid email address.' });
  }
  try {
    const sample = await template[1]();
    await mail.sendMail({
      ...sample, to: address, subject: `[TEST] ${sample.subject}`,
      branding: { title: sample.branding?.title || sample.subject, ...sample.branding, test: true }
    });
    return res.json({ ok: true });
  } catch (error) {
    console.error('[mail-template-test] Send failed', { template: req.params.template, code: error.code, status: error.statusCode });
    return res.status(502).json({ error: 'The test email could not be sent. Check the mail configuration and try again.' });
  }
};
