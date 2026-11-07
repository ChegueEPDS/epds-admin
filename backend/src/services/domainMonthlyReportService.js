const DomainMonitor=require('../models/domainMonitor');
const DomainHealthCheck=require('../models/domainHealthCheck');
const {databaseEngine}=require('../postgres');
const domains=require('../repositories/postgres/domainHealthRepository');
const operations=require('../repositories/domainOperationRepository');
const {monthPeriod,previousMonth,monthKey,calculateMonthlyMetrics}=require('./domainMonthlyMetrics');
const {generateMonthlyPdf}=require('./domainMonthlyPdfService');
const {recipientConfiguration,tenantId,escape}=require('./domainNotificationService');
const {withJobLease}=require('./scheduledJobLeaseService');
async function ensureMonthlyReport(tenant,month) {
  const period=monthPeriod(month);
  // Raw data is retained for 400 days. Older reports can only be read from the archive.
  const key=`monthly:${tenant}:${month}`;
  const existing=await operations.find(key);if(existing)return existing;
  if(+period.from<Date.now()-400*86400000)throw Object.assign(new Error('This month is outside the report archive and measurement retention period'),{statusCode:400});
  const outcome=await withJobLease(key,10*60000,async()=>{
    const cached=await operations.find(key);if(cached)return cached;
    const monitors=databaseEngine()==='postgresql'?await domains.listMonitors({tenantId:tenant,includeArchived:true}):await DomainMonitor.find({tenantId:tenant}).lean();
    if(!monitors.length)return null;
    const eligible=monitors.filter(domain=>(!domain.createdAt || +new Date(domain.createdAt)<+period.to) && (!domain.monitoringState?.archivedAt || +new Date(domain.monitoringState.archivedAt)>+period.from));
    const report={month,from:period.from.toISOString(),to:period.to.toISOString(),customer:monitors[0].tenantId?.displayName || 'Customer service report',domains:[]};
    for(const domain of eligible){
      const checks=databaseEngine()==='postgresql'
        ?await domains.listChecks([String(domain._id)],new Date(Date.now()-400*86400000))
        :await DomainHealthCheck.find({domainId:domain._id,checkedAt:{$gte:new Date(Date.now()-400*86400000),$lt:period.to}}).lean();
      const servicePeriod = { ...period, from: new Date(Math.max(+period.from, +new Date(domain.createdAt || period.from))), to: new Date(Math.min(+period.to, +new Date(domain.monitoringState?.archivedAt || period.to))) };
      report.domains.push({name:domain.name,metrics:calculateMonthlyMetrics(checks,servicePeriod)});
    }
    if(!report.domains.length)return null;
    const content=await generateMonthlyPdf(report);
    const to=recipientConfiguration()[tenant]||[];
    return operations.insert({key,kind:'monthly',tenantId:tenant,month,content,payload:{to,report,
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
module.exports={ensureMonthlyReport,listMonthlyReports,archivePreviousMonth,startDomainMonthlyReports};
