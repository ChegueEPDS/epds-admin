const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const store = require('../repositories/postgres/workBoardRepository');
const fileStorage = require('../services/fileStorageService');

const TERMINAL = new Set(['completed_billable','invoiced','paid','closed','cancelled']);
const CATEGORIES = new Set(['offer','contract_draft','contract','order','performance_certificate','other']);
const LABELS = {offer:'Ajánlat',contract_draft:'Szerződéstervezet',contract:'Szerződés',order:'Megrendelés',performance_certificate:'Teljesítésigazolás',other:'Egyéb'};
const clean = (v) => String(v || '').trim().replace(/\s+/g,' ');
const tax = (v) => String(v || '').trim().toUpperCase().replace(/[^0-9A-Z]/g,'');
const fail = (message,statusCode=400) => Object.assign(new Error(message),{statusCode});
const safeFile = (v) => clean(v).replace(/[\\/\u0000-\u001f\u007f]+/g,'_').slice(0,180)||'document';
const userName = (u) => [u?.firstName,u?.lastName].filter(Boolean).join(' ').trim()||u?.email||'Unknown user';

function presentSub(s,w){const amount=Number(s.amount||0),total=Number(w.totalAmount||0);return {...s,
  subWorkNumber:`${w.workNumber}/${String(s.sequenceNumber).padStart(2,'0')}`,percentage:total>0?amount/total*100:0};}
function presentWork(w){const subs=(w.subWorks||[]).filter(s=>(w.archivedAt||!s.archivedAt)&&s.status!=='cancelled');
  const total=Number(w.totalAmount||0),allocated=subs.reduce((n,s)=>n+Number(s.amount||0),0),paid=subs.reduce((n,s)=>n+Number(s.paidAmount||0),0);
  return {...w,marginPercent:total>0?(total-Number(w.costAmount||0))/total*100:0,allocatedAmount:allocated,
    allocatedPercentage:total>0?allocated/total*100:0,remainingAmount:total-allocated,paidAmount:paid,
    subWorkCount:subs.length,subWorks:subs.map(s=>presentSub(s,w))};}
function presentClient(c){return c?{id:String(c.id||c._id),taxNumber:c.tax_number||c.taxNumber,name:c.name,country:c.country||'HU',
  postalCode:c.postal_code||c.postalCode||'',city:c.city||'',address:c.address||'',email:c.email||'',phone:c.phone||''}:null;}
function presentDoc(d){return {id:d.id,workItemId:d.workItemId,category:d.category,categoryLabel:LABELS[d.category]||d.category,
  displayName:d.displayName,fileName:d.fileName,contentType:d.contentType,size:d.size,uploadedByName:d.uploadedByName||'',uploadedAt:d.createdAt};}
async function run(res,fn){try{await fn();}catch(e){console.error('[work-board-pg]',e);res.status(e.statusCode||500).json({error:e.statusCode?e.message:'Work board operation failed'});}}

exports.listWorks=(req,res)=>run(res,async()=>{const page=Math.max(1,Number(req.query.page)||1),limit=Math.min(100,Math.max(1,Number(req.query.limit)||25));
  const result=await store.list({tenantId:req.scope.tenantId,status:String(req.query.status||(req.query.active==='true'?'active':'all')),search:clean(req.query.search),page,limit});
  res.json({works:result.works.map(presentWork),pagination:{page,limit,total:result.total,pages:Math.max(1,Math.ceil(result.total/limit))},summary:result.summary});});
exports.activeOptions=(req,res)=>run(res,async()=>{const result=await store.list({tenantId:req.scope.tenantId,status:'active',limit:250,page:1});
  res.json({works:result.works.map(w=>({id:w.id,workNumber:w.workNumber,name:w.name,customer:w.customer||'',status:w.status,
    subWorks:(w.subWorks||[]).filter(s=>!TERMINAL.has(s.status)).map(s=>({id:s.id,sequenceNumber:s.sequenceNumber,
      subWorkNumber:`${w.workNumber}/${String(s.sequenceNumber).padStart(2,'0')}`,name:s.name,status:s.status}))}))});});
exports.getWork=(req,res)=>run(res,async()=>{const w=await store.findWork(req.scope.tenantId,req.params.id,req.query.includeDeleted==='true');if(!w)throw fail('Work not found',404);res.json({work:presentWork(w)});});
exports.createWork=(req,res)=>run(res,async()=>{if(!clean(req.body?.name))throw fail('Work name is required');
  const client=req.body?.clientId?(await store.listClients(req.scope.tenantId)).find(c=>c.id===req.body.clientId):null;
  const users=req.body?.responsibleUserId?await store.listUsers(req.scope.tenantId):[];const user=users.find(u=>u.id===req.body?.responsibleUserId);
  const w=await store.createWork(req.scope.tenantId,req.userId,{...req.body,name:clean(req.body.name),customer:client?.name||'',responsible:user?`${user.firstName} ${user.lastName}`.trim():'',year:req.body?.year});res.status(201).json({work:presentWork({...w,subWorks:[]})});});
exports.updateWork=(req,res)=>run(res,async()=>{const input={...req.body};if(Object.hasOwn(input,'clientId')){const c=(await store.listClients(req.scope.tenantId)).find(x=>x.id===input.clientId);input.customer=c?.name||'';}
  if(Object.hasOwn(input,'responsibleUserId')){const u=(await store.listUsers(req.scope.tenantId)).find(x=>x.id===input.responsibleUserId);input.responsible=u?`${u.firstName} ${u.lastName}`.trim():'';}
  const w=await store.updateWork(req.scope.tenantId,req.params.id,req.userId,input);if(!w)throw fail('Work not found',404);const full=await store.findWork(req.scope.tenantId,w.id);res.json({work:presentWork(full)});});
exports.archiveWork=(req,res)=>run(res,async()=>{if(!await store.archiveWork(req.scope.tenantId,req.params.id,req.userId))throw fail('Work not found',404);res.status(204).end();});
exports.restoreWork=(req,res)=>run(res,async()=>{const w=await store.restoreWork(req.scope.tenantId,req.params.id,req.userId);if(!w)throw fail('Work not found',404);res.json({work:presentWork(await store.findWork(req.scope.tenantId,w.id))});});
exports.createSubWork=(req,res)=>run(res,async()=>{if(!clean(req.body?.name))throw fail('Sub-work name is required');const s=await store.createSubWork(req.scope.tenantId,req.params.id,req.userId,req.body);if(!s)throw fail('Work not found',404);const w=await store.findWork(req.scope.tenantId,req.params.id);res.status(201).json({subWork:presentSub(s,w)});});
exports.updateSubWork=(req,res)=>run(res,async()=>{const s=await store.updateSubWork(req.scope.tenantId,req.params.subWorkId,req.userId,req.body);if(!s)throw fail('Sub-work not found',404);const w=await store.findWork(req.scope.tenantId,s.workItemId);res.json({subWork:presentSub(s,w)});});
exports.archiveSubWork=(req,res)=>run(res,async()=>{if(!await store.archiveSubWork(req.scope.tenantId,req.params.subWorkId,req.userId))throw fail('Sub-work not found',404);res.status(204).end();});
exports.listClients=(req,res)=>run(res,async()=>res.json({clients:(await store.listClients(req.scope.tenantId)).map(presentClient)}));
exports.lookupClientByTaxNumber=(req,res)=>run(res,async()=>{const n=tax(req.query.taxNumber);if(!n)throw fail('Tax number is required');const c=await store.findClientByTaxNumber(n);res.json({client:presentClient(c),linked:c?await store.isClientLinked(c.id,req.scope.tenantId):false});});
exports.createOrLinkClient=(req,res)=>run(res,async()=>{const n=tax(req.body?.taxNumber),name=clean(req.body?.name);if(!n||!name)throw fail(!n?'Tax number is required':'Company name is required');
  const existing=await store.findClientByTaxNumber(n);const c=await store.saveClient(req.scope.tenantId,req.userId,{...req.body,name,normalizedTaxNumber:n});res.status(existing?200:201).json({client:presentClient(c),matchedExisting:Boolean(existing)});});
exports.listTenantUsers=(req,res)=>run(res,async()=>res.json({users:(await store.listUsers(req.scope.tenantId)).map(u=>({id:u.id,fullName:`${u.firstName} ${u.lastName}`.trim()||u.email,email:u.email}))}));
exports.listDocuments=(req,res)=>run(res,async()=>res.json({documents:(await store.listDocuments(req.scope.tenantId,req.params.id)).map(presentDoc)}));
exports.uploadDocument=(req,res)=>run(res,async()=>{if(!req.file?.buffer?.length)throw fail('No file provided');const category=String(req.body?.category||'');if(!CATEGORIES.has(category))throw fail('Valid document category is required');const custom=clean(req.body?.customName);if(category==='other'&&!custom)throw fail('Custom document name is required for Other');
  const fileName=safeFile(req.file.originalname),storageKey=`work-documents/${req.scope.tenantId}/${req.params.id}/${crypto.randomUUID()}-${fileName}`;await fileStorage.uploadBuffer(storageKey,req.file.buffer);
  try{const d=await store.createDocument(req.scope.tenantId,req.params.id,req.userId,{category,displayName:category==='other'?custom:LABELS[category],fileName,storageKey,contentType:req.file.mimetype,size:req.file.size,uploadedByName:userName(req.user)});if(!d)throw fail('Work not found',404);res.status(201).json({document:presentDoc(d)});}catch(e){await fileStorage.deleteFile(storageKey).catch(()=>{});throw e;}});
exports.downloadDocument=(req,res)=>run(res,async()=>{const d=await store.findDocument(req.scope.tenantId,req.params.documentId);if(!d)throw fail('Document not found',404);const dl=await fileStorage.openDownloadStream(d.storageKey,req.headers.range);res.status(dl.partial?206:200);res.setHeader('Content-Type',d.contentType||'application/octet-stream');res.setHeader('Accept-Ranges','bytes');res.setHeader('Content-Length',dl.end-dl.start+1);if(dl.partial)res.setHeader('Content-Range',`bytes ${dl.start}-${dl.end}/${dl.size}`);res.setHeader('Content-Disposition',`attachment; filename="${safeFile(d.fileName)}"`);await pipeline(dl.stream,res);});
exports.deleteDocument=(req,res)=>run(res,async()=>{const d=await store.deleteDocument(req.scope.tenantId,req.params.documentId);if(!d)throw fail('Document not found',404);await fileStorage.deleteFile(d.storageKey).catch(()=>{});res.status(204).end();});
