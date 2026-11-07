// Run on an independent host. This service never accesses the application's database.
require('dotenv').config();
const express=require('express');
const crypto=require('crypto');
const rateLimit=require('express-rate-limit');
const {performDomainProbe,normalizeBaseUrl}=require('../src/services/domainMonitorService');
const token=process.env.DOMAIN_PROBE_TOKEN;
if(!token || token.length<32)throw new Error('Set DOMAIN_PROBE_TOKEN to at least 32 random characters');
const allowed=new Set(String(process.env.DOMAIN_PROBE_ALLOWED_HOSTS||'').split(',').map(value=>value.trim().toLowerCase()).filter(Boolean));
if(!allowed.size)throw new Error('DOMAIN_PROBE_ALLOWED_HOSTS must contain the exact monitored hostnames');
const app=express();
app.use(express.json({limit:'8kb'}));
app.use(rateLimit({windowMs:60000,limit:120,standardHeaders:true,legacyHeaders:false}));
app.post('/probe',async(req,res)=>{
  const supplied=Buffer.from(String(req.headers.authorization||'').replace(/^Bearer /,''));
  const expected=Buffer.from(token);
  if(supplied.length!==expected.length || !crypto.timingSafeEqual(supplied,expected))return res.sendStatus(401);
  try{
    const baseUrl=normalizeBaseUrl(req.body.baseUrl);
    if(!allowed.has(new URL(baseUrl).hostname))return res.status(403).json({error:'Host not allowed'});
    const result=await performDomainProbe({baseUrl,healthConfig:req.body.healthConfig||{}});
    res.setHeader('Cache-Control','no-store');res.json(result);
  }catch{res.status(400).json({error:'Invalid probe request'});}
});
app.listen(Number(process.env.DOMAIN_PROBE_PORT||4310),'127.0.0.1',()=>console.log('Domain probe listening on loopback; publish through an HTTPS reverse proxy.'));
