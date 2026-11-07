const test=require('node:test');
const assert=require('node:assert/strict');
const {confirmMeasurement,remoteProbeConfiguration}=require('../src/services/domainReliabilityService');
const {sanitizeCustomerReport,reportScope}=require('../src/services/domainCustomerReportService');
const {monthPeriod,previousMonth,calculateMonthlyMetrics}=require('../src/services/domainMonthlyMetrics');
const {recipientConfiguration}=require('../src/services/domainNotificationService');
const up={ok:true,status:'ok',checkedAt:'2026-10-01T12:00:00Z',responseMs:100};
const down={ok:false,status:'error',checkedAt:'2026-10-01T12:00:00Z',errorType:'connection'};
const delay=async()=>{};
function probe(sequence){let i=0;return async()=>sequence[Math.min(i++,sequence.length-1)];}
test('transient errors are retried and only three consecutive failures confirm downtime',async()=>{
  const transient=await confirmMeasurement({localProbe:probe([down,up]),delay});assert.equal(transient.decision,'up');assert.equal(transient.attempts.length,2);
  const outage=await confirmMeasurement({localProbe:probe([down]),delay});assert.equal(outage.decision,'down');assert.equal(outage.attempts.length,3);
});
test('recovery requires consecutive successful measurements',async()=>{
  const pending=await confirmMeasurement({localProbe:probe([up,down,up]),recovering:true,delay});assert.equal(pending.decision,'unknown');
  const recovered=await confirmMeasurement({localProbe:probe([up]),recovering:true,delay});assert.equal(recovered.decision,'up');assert.equal(recovered.attempts.length,2);
});
test('regional disagreement or offline measuring infrastructure does not confirm downtime',async()=>{
  for(const run of [probe([up]),async()=>{throw Error('offline');}]){
    const result=await confirmMeasurement({localProbe:probe([down]),remoteProbes:[{name:'remote',run}],delay});assert.equal(result.decision,'unknown');assert.equal(result.quorum,2);
  }
});
test('independent measuring locations confirm by majority',async()=>{
  const result=await confirmMeasurement({localProbe:probe([down]),remoteProbes:[{name:'a',run:probe([down])},{name:'b',run:probe([up])}],delay});assert.equal(result.decision,'down');
});
test('probe configuration rejects duplicate names and insecure transport',()=>{
  for(const config of [{name:'local',url:'https://probe.example',token:'x'},{name:'a',url:'http://probe.example',token:'x'},{name:'a',url:'https://u:p@probe.example',token:'x'}])assert.throws(()=>remoteProbeConfiguration(JSON.stringify([config])));
});
test('customer serialization removes internal addresses, tenant IDs and raw diagnostic messages',()=>{
  const report={owner:'Client',ownerSlug:'client',generatedAt:new Date().toISOString(),domains:[{domain:{id:'1',name:'Service',baseUrl:'http://internal',tenantId:'secret-tenant',healthConfig:{checkPath:'/secret'},lastError:'raw-secret',lastCheckedAt:new Date(),displayStatus:'ok',availability:{status:'ok'},performance:{status:'ok'}},overview:{windows:[],incidents:[{reasonCode:'custom',reasonText:'raw-secret'}],history24h:[],tls:{},lastFailedCheck:{errorMessage:'raw-secret',finalUrl:'http://internal'}},pageSpeed:{mainIssue:'raw-secret'}}]};
  assert.doesNotMatch(JSON.stringify(sanitizeCustomerReport(report)),/raw-secret|internal|secret-tenant|healthConfig/);
  assert.equal(sanitizeCustomerReport(report,Date.now()+3600000).domains[0].domain.displayStatus,'unknown');
});
test('tenant context constrains superadmin customer reports',()=>{
  assert.deepEqual(reportScope({role:'SuperAdmin',tenantId:'x'}),{tenantId:'x',all:false});assert.equal(reportScope({role:'User',tenantId:'x'}).all,false);assert.equal(reportScope({role:'SuperAdmin'}).all,true);
});
test('calendar months use Budapest midnight including daylight saving transition',()=>{
  const period=monthPeriod('2026-10',new Date('2026-11-02T00:00:00Z'));assert.equal(period.from.toISOString(),'2026-09-30T22:00:00.000Z');assert.equal(period.to.toISOString(),'2026-10-31T23:00:00.000Z');assert.equal((period.to-period.from)/3600000,745);
  assert.equal(previousMonth(new Date('2026-01-15T12:00:00Z')),'2025-12');assert.throws(()=>monthPeriod('2026-11',new Date('2026-11-07T00:00:00Z')));assert.throws(()=>monthPeriod('2026-13'));
});
test('monthly metrics count downtime, recovery and unknown gaps separately',()=>{
  const period={from:new Date('2026-10-01T00:00:00Z'),to:new Date('2026-10-01T02:00:00Z')};
  const checks=[{...up,checkedAt:'2026-10-01T00:00:00Z'},{...down,checkedAt:'2026-10-01T00:15:00Z'},{...up,checkedAt:'2026-10-01T00:30:00Z'}];
  const metrics=calculateMonthlyMetrics(checks,period);assert.equal(metrics.downMs,15*60000);assert.equal(metrics.knownMs,60*60000);assert.equal(metrics.unknownMs,60*60000);assert.equal(metrics.uptimePercent,75);assert.equal(metrics.meanRecoveryMs,15*60000);assert.equal(calculateMonthlyMetrics([],period).uptimePercent,null);
});
test('old slow-but-successful responses are not counted as downtime',()=>{
  const period={from:new Date('2026-10-01T00:00:00Z'),to:new Date('2026-10-01T00:15:00Z')};assert.equal(calculateMonthlyMetrics([{...down,errorType:'slow_response',checkedAt:period.from}],period).downMs,0);
});
test('customer notification recipients require tenant IDs and reject header injection',()=>{
  assert.throws(()=>recipientConfiguration('{"bad":["a@example.com"]}'));assert.throws(()=>recipientConfiguration('{"012345678901234567890123":["a@example.com\\nBcc: b@example.com"]}'));
  assert.equal(recipientConfiguration('{"012345678901234567890123":["a@example.com","a@example.com"]}')['012345678901234567890123'].length,1);
});
