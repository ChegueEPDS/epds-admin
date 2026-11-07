require('dotenv').config();
const {databaseEngine,closePostgres}=require('../src/postgres');
async function migrate(){
  if(databaseEngine()==='postgresql'){
    await require('../src/services/domainSchemaMigrationService').ensureDomainCustomerSchema();
    await closePostgres();
  }else{
    const mongoose=require('mongoose');
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI, { autoIndex: false });
    const model=require('../src/models/domainHealthCheck');
    await model.createCollection();
    const indexes=await model.collection.indexes();
    const ttl=indexes.find(index=>index.key.checkedAt===1 && Object.keys(index.key).length===1 && index.expireAfterSeconds!==undefined);
    if(ttl)await mongoose.connection.db.command({collMod:model.collection.collectionName,index:{name:ttl.name,expireAfterSeconds:400*86400}});
    await model.createIndexes();
    await model.updateMany({errorType:'slow_response'},[{$set:{ok:true,status:'warning',warningType:'slow_response',warningMessage:'$errorMessage'}},{$unset:['errorType','errorMessage']}]);
    await require('../src/models/domainMonitor').updateMany({lastErrorType:'slow_response'},[{$set:{lastStatus:'warning',lastWarningType:'slow_response',lastWarning:'$lastError'}},{$unset:['lastErrorType','lastError','currentIssueSince']}]);
    await require('../src/models/domainOperation').createIndexes();
    await mongoose.disconnect();
  }
  console.log('Domain customer monitoring migration completed.');
}
migrate().catch(error=>{console.error(error.message);process.exitCode=1;});
