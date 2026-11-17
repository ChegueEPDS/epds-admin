const DomainMonitor=require('../models/domainMonitor');
const DomainHealthCheck=require('../models/domainHealthCheck');
const DomainPageSpeedScan = require('../models/domainPageSpeedScan');
const Tenant = require('../models/tenant');
const {databaseEngine}=require('../postgres');
const domains=require('../repositories/postgres/domainHealthRepository');
const operations=require('../repositories/domainOperationRepository');
const {monthPeriod,previousMonth,monthKey,calculateMonthlyMetrics}=require('./domainMonthlyMetrics');
const {generateMonthlyPdf}=require('./domainMonthlyPdfService');
const { buildPageSpeedHistory, lcpStatus } = require('./pageSpeedService');
const {recipientConfiguration,tenantId,escape}=require('./domainNotificationService');
const {withJobLease}=require('./scheduledJobLeaseService');
const PDF_VERSION = 2;

async function buildDomainSummary(domain, period, comparisonPeriod, retentionStart, postgres) {
  const servicePeriod = {
    from: new Date(Math.max(+period.from, +new Date(domain.createdAt || period.from))),
    to: new Date(Math.min(+period.to, +new Date(domain.monitoringState?.archivedAt || period.to)))
  };
  if (servicePeriod.from >= servicePeriod.to) return null;
  const canCompare = comparisonPeriod.from >= retentionStart
    && (!domain.createdAt || new Date(domain.createdAt) <= comparisonPeriod.from)
    && +servicePeriod.to === +period.to;
  const start = new Date(Math.max(+retentionStart, +(canCompare ? comparisonPeriod.from : servicePeriod.from) - 30 * 60000));
  const [checks, scans] = await Promise.all(postgres ? [
    domains.listChecks([String(domain._id)], start, null, servicePeriod.to),
    domains.listScans([String(domain._id)], servicePeriod.from, null, servicePeriod.to)
  ] : [
    DomainHealthCheck.find({ domainId: domain._id, checkedAt: { $gte: start, $lt: servicePeriod.to } }).lean(),
    DomainPageSpeedScan.find({ domainId: domain._id, checkedAt: { $gte: servicePeriod.from, $lt: servicePeriod.to } }).sort({ checkedAt: -1 }).lean()
  ]);
  const metrics = calculateMonthlyMetrics(checks, servicePeriod);
  const previous = canCompare && metrics.coveragePercent >= 95 && metrics.p95Ms !== null
    ? calculateMonthlyMetrics(checks, comparisonPeriod)
    : null;
  const previousP95 = previous?.coveragePercent >= 95 ? previous.p95Ms : null;
  const mobile = buildPageSpeedHistory(scans).find(item => Number.isFinite(item.mobilePerformance));
  const mobileStatus = lcpStatus(mobile?.mobileLcp);
  const pageSpeed = mobile && (mobile.mobilePerformance < 90 || ['needs improvement', 'poor'].includes(mobileStatus))
    ? { checkedAt: mobile.checkedAt, score: mobile.mobilePerformance, lcpMs: mobile.mobileLcp, lcpStatus: mobileStatus }
    : null;
  const tlsDays = metrics.tlsValidTo ? Math.ceil((+new Date(metrics.tlsValidTo) - +period.to) / 86400000) : null;
  const warningDays = Number(domain.healthConfig?.tlsWarningDays) || 30;
  const tls = tlsDays !== null && tlsDays <= warningDays ? { validTo: metrics.tlsValidTo } : null;
  return { name: domain.name, metrics, previousP95, pageSpeed, tls };
}

async function monthlyDownloadContent(item) {
  const archived = item.payload?.report;
  return item.payload?.pdfVersion !== PDF_VERSION && Array.isArray(archived?.domains)
    ? generateMonthlyPdf(archived)
    : item.content;
}

async function ensureMonthlyReport(tenant,month) {
  const period=monthPeriod(month);
  // Raw data is retained for 400 days. Older reports can only be read from the archive.
  const key=`monthly:${tenant}:${month}`;
  const existing=await operations.find(key);if(existing)return existing;
  const retentionStart = new Date(Date.now() - 400 * 86400000);
  if(period.from < retentionStart)throw Object.assign(new Error('This month is outside the report archive and measurement retention period'),{statusCode:400});
  const outcome=await withJobLease(key,10*60000,async()=>{
    const cached=await operations.find(key);if(cached)return cached;
    const postgres = databaseEngine() === 'postgresql';
    const monitors = postgres ? await domains.listMonitors({tenantId:tenant,includeArchived:true})
      : await DomainMonitor.find({tenantId:tenant}).populate({ path: 'tenantId', select: 'displayName', model: Tenant }).lean();
    if(!monitors.length)return null;
    const eligible=monitors.filter(domain=>(!domain.createdAt || +new Date(domain.createdAt)<+period.to) && (!domain.monitoringState?.archivedAt || +new Date(domain.monitoringState.archivedAt)>+period.from));
    const comparisonPeriod = monthPeriod(previousMonth(period.from));
    const report={month,from:period.from.toISOString(),to:period.to.toISOString(),customer:monitors[0].tenantId?.displayName || 'Customer service report',domains:[]};
    for(const domain of eligible){
      const summary = await buildDomainSummary(domain, period, comparisonPeriod, retentionStart, postgres);
      if (summary) report.domains.push(summary);
    }
    if(!report.domains.length)return null;
    const content=await generateMonthlyPdf(report);
    const to=recipientConfiguration()[tenant]||[];
    return operations.insert({key,kind:'monthly',tenantId:tenant,month,content,payload:{to,report,pdfVersion:PDF_VERSION,
      subject:`Monthly service report - ${month}`,html:`<h2>Monthly service report</h2><p>${escape(month)}</p><p>The attached report contains service availability, measurement coverage, interruptions and recovery times.</p>`}});
  });
  if(outcome.acquired)return outcome.value;
  const cached=await operations.find(key);
  if(!cached)throw Object.assign(new Error('The monthly report is being prepared. Please retry shortly.'),{statusCode:503});
  return cached;
}
async function listMonthlyReports(tenant){
  const archived=await operations.monthly(tenant);
  const months=new Map(archived.map(item=>[item.month,{month:item.month,archived:true}]));
  const now=new Date();
  for(let offset=1;offset<=12;offset++){
    const [year,month]=monthKey(now).split('-').map(Number);
    const key=monthKey(new Date(Date.UTC(year,month-1-offset,15)));
    if(!months.has(key))months.set(key,{month:key,archived:false});
  }
  return {months:[...months.values()].sort((a,b)=>b.month.localeCompare(a.month))};
}
async function archivePreviousMonth(){
  const monitors=databaseEngine()==='postgresql'?await domains.listMonitors({all:true,includeArchived:true}):await DomainMonitor.find({}).lean();
  const tenants=[...new Set(monitors.map(tenantId).filter(Boolean))];
  const month=previousMonth();
  for(const tenant of tenants){
    try{await ensureMonthlyReport(tenant,month);}
    catch(error){console.error('[domain-monthly]',tenant,error.message);}
  }
}
let timer;
function startDomainMonthlyReports(){
  if(timer)return;
  setTimeout(()=>void archivePreviousMonth().catch(error=>console.error('[domain-monthly]',error.message)),45000).unref?.();
  timer=setInterval(()=>void archivePreviousMonth().catch(error=>console.error('[domain-monthly]',error.message)),3600000);timer.unref?.();
}
module.exports={ensureMonthlyReport,monthlyDownloadContent,listMonthlyReports,archivePreviousMonth,startDomainMonthlyReports};
