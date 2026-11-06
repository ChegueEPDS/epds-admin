const mongoose = require('mongoose');
const { query } = require('../../postgres');

const oid = () => String(new mongoose.Types.ObjectId());
const coreKeys = new Set(['_id','id','tenantId','customerName','normalizedCustomerName','description','status','statusVersion','integrationEventVersion','orderedFromStatus','objectLimitOption','customObjectLimit','expiresAt','createdBy','updatedBy','createdAt','updatedAt']);

function hydrate(row) {
  if (!row) return null;
  const tenant = row.tenant_id ? { _id: row.tenant_id, id: row.tenant_id, name: row.tenant_name, displayName: row.tenant_display_name, type: row.tenant_type } : null;
  const value = {
    ...(row.details || {}), _id: row.id, id: row.id, tenantId: tenant,
    customerName: row.customer_name, normalizedCustomerName: row.normalized_customer_name,
    description: row.description, status: row.status, statusVersion: Number(row.status_version),
    integrationEventVersion: Number(row.integration_event_version), orderedFromStatus: row.ordered_from_status,
    objectLimitOption: row.object_limit_option, customObjectLimit: row.custom_object_limit,
    expiresAt: row.expires_at, createdBy: row.created_by, updatedBy: row.updated_by,
    createdAt: row.created_at, updatedAt: row.updated_at
  };
  Object.defineProperties(value, {
    save: { enumerable: false, value: async function saveBound(){const saved=await save(this);Object.assign(this,saved);return this;} },
    populate: { enumerable: false, value: async function populateBound(){return this;} },
    deleteOne: { enumerable: false, value: async function deleteBound(){return remove(this._id);} },
    constructor: { enumerable: false, value: { updateOne: updateIntegrationVersion } }
  });
  return value;
}

const select = `SELECT l.*,t.name tenant_name,t.display_name tenant_display_name,t.type tenant_type FROM license_customers l LEFT JOIN tenants t ON t.id=l.tenant_id`;
async function list({tenantId=null,all=false,limit=100}={}){const p=[];let where='';if(!all){p.push(tenantId);where=` WHERE l.tenant_id=$1`;}p.push(limit);const r=await query(`${select}${where} ORDER BY l.customer_name LIMIT $${p.length}`,p);return r.rows.map(hydrate);}
async function listForIntegration({cursor=null,updatedAfter=null,limit=51}={}){const p=[],w=[];if(cursor){p.push(cursor.updatedAt,cursor.id);w.push(`(l.updated_at>$1 OR (l.updated_at=$1 AND l.id>$2))`);}else if(updatedAfter){p.push(updatedAfter);w.push(`l.updated_at>$1`);}p.push(limit);const r=await query(`${select}${w.length?' WHERE '+w.join(' AND '):''} ORDER BY l.updated_at,l.id LIMIT $${p.length}`,p);return r.rows.map(hydrate);}
async function findById(id,{tenantId=null,all=false}={}){const p=[id],w=['l.id=$1'];if(!all){p.push(tenantId);w.push(`l.tenant_id=$${p.length}`);}const r=await query(`${select} WHERE ${w.join(' AND ')}`,p);return hydrate(r.rows[0]);}
async function save(d){const id=String(d._id||d.id||oid());const tenantId=d.tenantId?String(d.tenantId._id||d.tenantId.id||d.tenantId):null;const details={};for(const [k,v] of Object.entries(d)){if(!coreKeys.has(k)&&typeof v!=='function')details[k]=v;}const r=await query(`INSERT INTO license_customers(id,tenant_id,customer_name,normalized_customer_name,description,status,status_version,integration_event_version,ordered_from_status,object_limit_option,custom_object_limit,expires_at,details,created_by,updated_by,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,coalesce($16,now()),now()) ON CONFLICT(id) DO UPDATE SET tenant_id=EXCLUDED.tenant_id,customer_name=EXCLUDED.customer_name,normalized_customer_name=EXCLUDED.normalized_customer_name,description=EXCLUDED.description,status=EXCLUDED.status,status_version=EXCLUDED.status_version,integration_event_version=EXCLUDED.integration_event_version,ordered_from_status=EXCLUDED.ordered_from_status,object_limit_option=EXCLUDED.object_limit_option,custom_object_limit=EXCLUDED.custom_object_limit,expires_at=EXCLUDED.expires_at,details=EXCLUDED.details,updated_by=EXCLUDED.updated_by,updated_at=now() RETURNING id`,[id,tenantId,d.customerName,d.normalizedCustomerName,d.description||'',d.status||'active',Number(d.statusVersion||0),Number(d.integrationEventVersion||0),d.orderedFromStatus||'',d.objectLimitOption||'1000',d.customObjectLimit??null,d.expiresAt,JSON.stringify(details),d.createdBy||null,d.updatedBy||null,d.createdAt||null]);return findById(r.rows[0].id,{all:true});}
async function remove(id){const r=await query('DELETE FROM license_customers WHERE id=$1 RETURNING id',[id]);return Boolean(r.rows[0]);}
async function updateIntegrationVersion(filter,update){const version=Number(update?.$set?.integrationEventVersion||0);const id=String(filter._id);const r=await query('UPDATE license_customers SET integration_event_version=$2,updated_at=now() WHERE id=$1 AND integration_event_version<$2 RETURNING id',[id,version]);return{modifiedCount:r.rowCount};}
async function expireActive(today){const r=await query(`UPDATE license_customers SET status='expired',status_version=status_version+1,updated_at=now() WHERE status='active' AND expires_at<$1 RETURNING id`,[today]);return r.rowCount;}
module.exports={expireActive,findById,hydrate,list,listForIntegration,remove,save,updateIntegrationVersion};
