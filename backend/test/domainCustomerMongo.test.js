const test=require('node:test');
const assert=require('node:assert/strict');
const enabled=process.env.DOMAIN_CUSTOMER_MONGO_QA==='true';
test('MongoDB preserves customer state, report archive and mail retry metadata',{skip:!enabled},async()=>{
  const mongoose=require('mongoose');
  const uri=process.env.DOMAIN_CUSTOMER_MONGO_URL;
  assert.match(uri,/\/epds_customer_qa(?:\?|$)/,'Use the dedicated QA database');
  const Domain=require('../src/models/domainMonitor');
  const Check=require('../src/models/domainHealthCheck');
  const Operation=require('../src/models/domainOperation');
  const Lease=require('../src/models/scheduledJobLease');
  const ops=require('../src/repositories/domainOperationRepository');
  const {ensureMonthlyReport}=require('../src/services/domainMonthlyReportService');
  const {runDomainCheck}=require('../src/services/domainMonitorService');
  const axios=require('axios'),dns=require('dns').promises;
  const get=axios.get,lookup=dns.lookup;
  try{
    await mongoose.connect(uri);
    await Promise.all([Domain.deleteMany({}),Check.deleteMany({}),Operation.deleteMany({}),Lease.deleteMany({})]);
    await Promise.all([Domain.createIndexes(),Check.createIndexes(),Operation.createIndexes(),Lease.createIndexes()]);
    const domain=await Domain.create({name:'Mongo QA service',baseUrl:'https://mongo.example',normalizedUrl:'https://mongo.example',owner:'Client',tenantId:'111111111111111111111111',createdAt:new Date('2026-01-01')});
    dns.lookup=async()=>[{address:'93.184.215.14',family:4}];
    axios.get=async()=>({status:200,headers:{}});
    assert.equal((await runDomainCheck(domain)).ok,true);
    const stored=await Domain.findById(domain._id).lean();assert.equal(stored.monitoringState.decision,'up');
    assert.equal((await Check.findOne({domainId:domain._id}).lean()).measurement.quorum,1);
    await Check.create({domainId:domain._id,checkedAt:new Date('2026-10-05T00:00:00Z'),ok:true,status:'ok',responseMs:120});
    const report=await ensureMonthlyReport('111111111111111111111111','2026-10');assert.equal(report.content.slice(0,4).toString(),'%PDF');
    await ops.failed(report,Error('test'));assert.equal((await ops.find(report.key)).attempts,1);
    await ops.delivered(report.key);assert.ok((await ops.find(report.key)).sentAt);
    assert.equal((await ops.monthly('222222222222222222222222')).length,0);
  }finally{axios.get=get;dns.lookup=lookup;await mongoose.disconnect();}
});
