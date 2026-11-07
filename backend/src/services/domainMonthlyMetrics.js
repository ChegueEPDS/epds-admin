const TIME_ZONE = 'Europe/Budapest';
function monthKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone:TIME_ZONE,year:'numeric',month:'2-digit'}).formatToParts(date);
  return `${parts.find(part=>part.type==='year').value}-${parts.find(part=>part.type==='month').value}`;
}
function midnight(year,month) {
  const target=Date.UTC(year,month-1,1);
  let guess=target;
  for(let i=0;i<3;i++) {
    const parts=new Intl.DateTimeFormat('en-GB',{timeZone:TIME_ZONE,year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric',second:'numeric',hourCycle:'h23'}).formatToParts(new Date(guess));
    const p=Object.fromEntries(parts.filter(part=>part.type!=='literal').map(part=>[part.type,Number(part.value)]));
    guess += target-Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);
  }
  return new Date(guess);
}
function monthPeriod(month,now=new Date()) {
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw Object.assign(new Error('Use a closed month in YYYY-MM format'),{statusCode:400});
  const [year,m]=month.split('-').map(Number);
  const from=midnight(year,m),to=midnight(m===12?year+1:year,m===12?1:m+1);
  if(to>now || year<2020)throw Object.assign(new Error('Only closed months can be reported'),{statusCode:400});
  return {month,from,to,timeZone:TIME_ZONE};
}
function previousMonth(now=new Date()) {
  const [year,month]=monthKey(now).split('-').map(Number);
  return `${month===1?year-1:year}-${String(month===1?12:month-1).padStart(2,'0')}`;
}
// A measurement represents at most two normal monitor intervals; missing time is unknown.
function calculateMonthlyMetrics(checks,period,maxSampleAgeMs=30*60000) {
  const from=+period.from,to=+period.to;
  const sorted=checks.filter(check=>Number.isFinite(+new Date(check.checkedAt)) && +new Date(check.checkedAt)<to).sort((a,b)=>+new Date(a.checkedAt)-+new Date(b.checkedAt));
  let availableMs=0,downMs=0;
  const incidents=[];
  let active=null;
  const responseTimes=[];
  for(let index=0;index<sorted.length;index++) {
    const check=sorted[index];
    const time=+new Date(check.checkedAt);
    const next=index+1<sorted.length?+new Date(sorted[index+1].checkedAt):to;
    const end=Math.min(next,time+maxSampleAgeMs,to);
    const start=Math.max(from,time);
    const failure=!check.ok && check.errorType!=='slow_response';
    if(time>=from && check.ok && Number.isFinite(check.responseMs)) responseTimes.push(check.responseMs);
    if(end<=start)continue;
    if(failure) {
      downMs+=end-start;
      if(active && active.end===start)active.end=end;
      else { active={start,end,reasonCode:check.errorType||'connection',recovered:false};incidents.push(active); }
    } else {
      availableMs+=end-start;
      if(active && active.end===start){active.recovered=true;active=null;}
    }
    if(next>end)active=null;
  }
  const knownMs=availableMs+downMs,totalMs=to-from;
  const recovered=incidents.filter(incident=>incident.recovered);
  responseTimes.sort((a,b)=>a-b);
  const metric={ totalMs,knownMs,unknownMs:Math.max(0,totalMs-knownMs),availableMs,downMs,
    coveragePercent:Math.round(knownMs/totalMs*1000)/10,
    uptimePercent:knownMs?Math.round(availableMs/knownMs*10000)/100:null,
    incidentCount:incidents.length,
    meanRecoveryMs:recovered.length?Math.round(recovered.reduce((sum,incident)=>sum+incident.end-incident.start,0)/recovered.length):null,
    averageMs:responseTimes.length?Math.round(responseTimes.reduce((a,b)=>a+b,0)/responseTimes.length):null,
    p95Ms:responseTimes.length?responseTimes[Math.ceil(responseTimes.length*.95)-1]:null,
    incidents:incidents.map(incident=>({startedAt:new Date(incident.start).toISOString(),endedAt:new Date(incident.end).toISOString(),durationMs:incident.end-incident.start,reasonCode:incident.reasonCode,recovered:incident.recovered})) };
  metric.assessment=metric.coveragePercent<95
    ? 'Measurement coverage is incomplete. Availability applies only to observed time; missing time is not counted as healthy.'
    : metric.incidentCount ? `${metric.incidentCount} service interruptions were observed. Review the incident details and recovery times below.`
    : 'No service interruption was observed during the covered period.';
  return metric;
}
module.exports={TIME_ZONE,monthKey,monthPeriod,previousMonth,calculateMonthlyMetrics};
