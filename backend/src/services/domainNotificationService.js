const repository = require('../repositories/domainOperationRepository');
const mail = require('./mailService');
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
function tenantId(domain) { return String(domain.tenantId?._id || domain.tenantId || ''); }
function escape(value) { return String(value || '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[character]); }
async function enqueueDomainTransition(domain, event, recordedAt) {
  const tenant = tenantId(domain);
  if (!tenant) return;
  const to = recipientConfiguration()[tenant] || [];
  if (!to.length) return;
  const time = recordedAt || (event === 'down' ? domain.currentIssueSince : domain.lastRecoveryAt);
  const label = event === 'down' ? 'Service interruption confirmed' : 'Service restored';
  await repository.insert({ key:`transition:${domain._id}:${event}:${new Date(time).toISOString()}`, kind:'transition', tenantId:tenant,
    payload:{ to, subject:`${label}: ${domain.name}`, html:`<h2>${escape(label)}</h2><p>${escape(domain.name)}</p><p>${escape(new Date(time).toISOString())}</p><p>${event === 'down' ? 'Repeated measurements confirmed that this service is unavailable.' : 'Repeated measurements confirmed that this service is available again.'}</p>` } });
}
async function deliverPending() {
  const items = await repository.pending();
  for (const item of items) {
    await withJobLease(`domain-mail:${item.key}`,10*60000,async()=>{
      const current=await repository.find(item.key);
      if (current.sentAt) return;
      try {
        await mail.sendMail({ ...current.payload, attachments: current.content ? [{name:`service-report-${current.month}.pdf`,contentType:'application/pdf',bytes:current.content.toString('base64')}] : [] });
        await repository.delivered(item.key);
      } catch(error) { await repository.failed(current,error); }
    });
  }
}
let timer;
function startDomainNotifications() {
  if (timer) return;
  recipientConfiguration();
  timer=setInterval(()=>void deliverPending().catch(error=>console.error('[domain-mail]',error.message)),60000);
  timer.unref?.();
}
module.exports={recipientConfiguration,tenantId,escape,enqueueDomainTransition,deliverPending,startDomainNotifications};
