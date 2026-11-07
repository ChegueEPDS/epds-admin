const { databaseEngine, query } = require('../postgres');
const Model = require('../models/domainOperation');
function mongoItem(item) {
  if (item?.content && !Buffer.isBuffer(item.content)) item.content = Buffer.from(typeof item.content.value === 'function' ? item.content.value(true) : item.content.buffer || item.content);
  return item;
}
const pg = () => databaseEngine() === 'postgresql';
function present(row) {
  return row && { key: row.key, kind: row.kind, tenantId: row.tenant_id, month: row.month, payload: row.payload,
    content: row.content, sentAt: row.sent_at, attempts: row.attempts, nextAttemptAt: row.next_attempt_at };
}
async function insert(item) {
  if (!pg()) return mongoItem(await Model.findOneAndUpdate({ key: item.key }, { $setOnInsert: item }, { upsert: true, new: true }).lean());
  const result = await query(`INSERT INTO domain_operations(key,kind,tenant_id,month,payload,content) VALUES($1,$2,$3,$4,$5::jsonb,$6) ON CONFLICT(key) DO NOTHING RETURNING *`, [item.key,item.kind,item.tenantId,item.month||null,JSON.stringify(item.payload),item.content||null]);
  return present(result.rows[0]) || find(item.key);
}
async function find(key) {
  return pg() ? present((await query('SELECT * FROM domain_operations WHERE key=$1',[key])).rows[0]) : mongoItem(await Model.findOne({key}).lean());
}
async function monthly(tenantId) {
  if (!pg()) return Model.find({tenantId,kind:'monthly'}).select('-content').sort({month:-1}).lean();
  return (await query("SELECT key,kind,tenant_id,month,payload,sent_at FROM domain_operations WHERE tenant_id=$1 AND kind='monthly' ORDER BY month DESC",[tenantId])).rows.map(present);
}
async function pending() {
  if (!pg()) return (await Model.find({sentAt:null,nextAttemptAt:{$lte:new Date()},'payload.to.0':{$exists:true}}).sort({createdAt:1}).limit(20).lean()).map(mongoItem);
  return (await query("SELECT * FROM domain_operations WHERE sent_at IS NULL AND next_attempt_at<=now() AND jsonb_array_length(payload->'to')>0 ORDER BY created_at LIMIT 20")).rows.map(present);
}
async function delivered(key) {
  if (!pg()) return Model.updateOne({key},{$set:{sentAt:new Date(),lastError:null}});
  await query('UPDATE domain_operations SET sent_at=now(),last_error=NULL WHERE key=$1',[key]);
}
async function failed(item,error) {
  const nextAttemptAt=new Date(Date.now()+Math.min(6*3600000,60000*2**Math.min(item.attempts||0,8)));
  if (!pg()) return Model.updateOne({key:item.key},{$inc:{attempts:1},$set:{lastError:String(error.message).slice(0,300),nextAttemptAt}});
  await query('UPDATE domain_operations SET attempts=attempts+1,last_error=$2,next_attempt_at=$3 WHERE key=$1',[item.key,String(error.message).slice(0,300),nextAttemptAt]);
}
module.exports={insert,find,monthly,pending,delivered,failed};
