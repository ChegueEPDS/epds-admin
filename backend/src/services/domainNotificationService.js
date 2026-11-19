const repository = require('../repositories/domainOperationRepository');
const mail = require('./mailService');
const { transitionMail } = require('./mailTemplates');
const { withJobLease } = require('./scheduledJobLeaseService');
function recipientConfiguration(raw = process.env.DOMAIN_HEALTH_CUSTOMER_RECIPIENTS || '{}') {
  const input = JSON.parse(raw);
  if (!input || Array.isArray(input) || typeof input !== 'object') throw new Error('Customer recipients must be keyed by tenant ID');
  const result = {};
  for (const [tenant, addresses] of Object.entries(input)) {
    if (!/^[a-f\d]{24}$/i.test(tenant) || !Array.isArray(addresses) || addresses.some(address => typeof address !== 'string' || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address))) throw new Error('Invalid customer recipient configuration');
    result[tenant] = [...new Set(addresses)];
  }
  return result;
}
function customerLanguages(raw = process.env.DOMAIN_HEALTH_CUSTOMER_LANGUAGES || '{}') {
  const configuration = JSON.parse(raw);
  if (!configuration || Array.isArray(configuration) || typeof configuration !== 'object' ||
      Object.entries(configuration).some(([tenant, language]) => !/^[a-f\d]{24}$/i.test(tenant) || !['en', 'hu'].includes(language))) {
    throw new Error('Customer report languages must be en or hu, keyed by tenant ID');
  }
  return configuration;
}

function customerLanguage(tenant) {
  return customerLanguages()[tenant] === 'hu' ? 'hu' : 'en';
}
function tenantId(domain) { return String(domain.tenantId?._id || domain.tenantId || ''); }
async function enqueueDomainTransition(domain, event, recordedAt) {
  const tenant = tenantId(domain);
  if (!tenant) return;
  const to = recipientConfiguration()[tenant] || [];
  if (!to.length) return;
  const time = recordedAt || (event === 'down' ? domain.currentIssueSince : domain.lastRecoveryAt);
  await repository.insert({ key:`transition:${domain._id}:${event}:${new Date(time).toISOString()}`, kind:'transition', tenantId:tenant,
    payload:{ to, ...transitionMail(event, domain.name, time, customerLanguage(tenant)) } });
}
async function deliverPending() {
  const items = await repository.pending();
  for (const item of items) {
    await withJobLease(`domain-mail:${item.key}`,10*60000,async()=>{
      const current=await repository.find(item.key);
      if (current.sentAt) return;
      try {
        const content = current.kind === 'monthly' && current.payload.branding?.lang === 'hu'
          ? await require('./domainMonthlyReportService').monthlyDownloadContent(current, 'hu')
          : current.content;
        await mail.sendMail({ ...current.payload, attachments: content ? [{name:`service-report-${current.month}.pdf`,contentType:'application/pdf',bytes:content.toString('base64')}] : [] });
        await repository.delivered(item.key);
      } catch(error) { await repository.failed(current,error); }
    });
  }
}
let timer;
function startDomainNotifications() {
  if (timer) return;
  recipientConfiguration();
  customerLanguages();
  timer=setInterval(()=>void deliverPending().catch(error=>console.error('[domain-mail]',error.message)),60000);
  timer.unref?.();
}
module.exports={recipientConfiguration,customerLanguage,tenantId,enqueueDomainTransition,deliverPending,startDomainNotifications};
