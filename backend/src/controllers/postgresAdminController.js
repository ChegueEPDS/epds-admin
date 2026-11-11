const bcrypt=require('bcryptjs');
const {query}=require('../postgres');
const userRepository=require('../repositories/postgres/userRepository');
const tenantRepository=require('../repositories/postgres/tenantRepository');
const { validateDefaultCurrency } = require('../services/tenantCurrency');
const { workTurnoverError } = require('../services/workTurnover');
const {ASSIGNABLE_ROLES,SUPERADMIN_EMAIL}=require('../services/userSeedService');
function userView(u){const t=u.tenantId&&typeof u.tenantId==='object'?u.tenantId:null;return{id:String(u._id),email:u.email,firstName:u.firstName,lastName:u.lastName,role:u.role,tenantId:t?String(t._id):u.tenantId||null,tenantName:t?.name||null,tenantDisplayName:t?.displayName||t?.name||null,azureId:u.azureId||null,lastLoginAt:u.lastLoginAt||null,createdAt:u.createdAt,updatedAt:u.updatedAt};}
function tenantView(t) {
  return { id: String(t._id), name: t.name, displayName: t.displayName || t.name, type: t.type,
    defaultCurrency: t.defaultCurrency, workTurnoverDay: t.workTurnoverDay, alignWorkSequence: t.alignWorkSequence,
    features: t.features || {}, financeAccess: t.features?.financeAccess?.enabled === true,
    ownerUserId: t.ownerUserId || null, createdAt: t.createdAt, updatedAt: t.updatedAt };
}
const role=x=>ASSIGNABLE_ROLES.includes(String(x||'User').trim())?String(x||'User').trim():null;
exports.listUsers=async(req,res,next)=>{try{res.json({users:(await userRepository.listAll()).map(userView)});}catch(e){next(e);}};
exports.createUser=async(req,res,next)=>{try{const email=String(req.body?.email||'').trim().toLowerCase(),password=String(req.body?.password||''),tenantId=String(req.body?.tenantId||''),r=role(req.body?.role);if(!email.includes('@')||password.length<8||!req.body?.firstName||!req.body?.lastName||!tenantId||!r)return res.status(400).json({error:'Valid user data is required'});if(!await tenantRepository.findById(tenantId))return res.status(404).json({error:'Tenant not found'});if(await userRepository.findByEmail(email))return res.status(409).json({error:'User already exists'});const u=await userRepository.save({email,firstName:String(req.body.firstName).trim(),lastName:String(req.body.lastName).trim(),tenantId,role:email===SUPERADMIN_EMAIL?'SuperAdmin':r,password:await bcrypt.hash(password,12),emailVerified:true});res.status(201).json({user:userView(u)});}catch(e){if(e.code==='23505')return res.status(409).json({error:'User already exists'});next(e);}};
async function updateUser(req, res, next, onlyRole = false) {
  try {
    const user = await userRepository.findById(req.params.id, { includePassword: true });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.email === SUPERADMIN_EMAIL) return res.status(400).json({ error: 'SuperAdmin user cannot be edited' });
    const nextRole = role(req.body?.role);
    if (!nextRole) return res.status(400).json({ error: 'Valid role is required' });
    user.role = nextRole;

    if (!onlyRole && !user.azureId) {
      const email = String(req.body?.email || '').trim().toLowerCase();
      const tenantId = String(req.body?.tenantId || '');
      if (!email.includes('@') || !req.body?.firstName || !req.body?.lastName || !await tenantRepository.findById(tenantId)) {
        return res.status(400).json({ error: 'Valid user data is required' });
      }
      const other = await userRepository.findByEmail(email);
      if (other && other._id !== user._id) return res.status(409).json({ error: 'User already exists' });
      Object.assign(user, { email, tenantId, firstName: String(req.body.firstName).trim(), lastName: String(req.body.lastName).trim() });
      if (req.body.password) {
        if (String(req.body.password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
        user.password = await bcrypt.hash(String(req.body.password), 12);
      }
    } else if (!onlyRole && req.body?.tenantId && req.body.tenantId !== user.tenantId) {
      const current = user.tenantId ? await tenantRepository.findById(user.tenantId) : null;
      if (req.body.tenantId === 'company-default' && current?.type === 'finance') {
        user.tenantId = null;
      } else {
        const target = await tenantRepository.findById(req.body.tenantId);
        if (target?.type !== 'finance' || nextRole !== 'Finance') {
          return res.status(400).json({ error: 'Select a Finance tenant and the Finance role.' });
        }
        user.tenantId = target._id;
      }
    }
    const saved = await userRepository.save(user);
    return res.json({ user: userView(saved) });
  } catch (error) { next(error); }
}
exports.updateUser=(a,b,c)=>updateUser(a,b,c,false);exports.updateUserRole=(a,b,c)=>updateUser(a,b,c,true);
exports.listTenants=async(req,res,next)=>{try{res.json({tenants:(await tenantRepository.list()).map(tenantView)});}catch(e){next(e);}};
async function saveTenant(req, res, next, existing = null) {
  try {
    const name = String(req.body?.name || '').trim().toLowerCase();
    const displayName = String(req.body?.displayName || req.body?.name || '').trim();
    const type = String(req.body?.type || 'company').trim().toLowerCase();
    if (!name || !['company', 'client', 'finance'].includes(type)) return res.status(400).json({ error: 'Valid tenant data is required' });
    if (existing && (type === 'finance') !== (existing.type === 'finance')) {
      return res.status(400).json({ error: 'Create a separate Finance tenant.' });
    }
    let defaultCurrency;
    if (req.body?.defaultCurrency !== undefined) {
      defaultCurrency = validateDefaultCurrency(req.body.defaultCurrency, existing?.defaultCurrency);
      if (!defaultCurrency) return res.status(400).json({ error: 'Select an available default currency.' });
    }
    const { workTurnoverDay, alignWorkSequence } = req.body || {};
    const turnoverError = workTurnoverError({ workTurnoverDay, alignWorkSequence });
    if (turnoverError) return res.status(400).json({ error: turnoverError });
    const duplicate = await tenantRepository.findByName(name);
    if (duplicate && duplicate._id !== existing?._id) return res.status(409).json({ error: 'Tenant already exists' });
    const financeAccess = req.body?.financeAccess ?? existing?.features?.financeAccess?.enabled;
    const features = type === 'finance' ? {} : { ...req.body?.features, financeAccess: { enabled: financeAccess === true } };
    const saved = await tenantRepository.save({ ...existing, name, displayName, type, defaultCurrency, workTurnoverDay, alignWorkSequence,
      features, seats: existing?.seats || { max: 0, used: 0 }, seatsManaged: existing?.seatsManaged || 'manual' });
    await query('UPDATE license_customers SET customer_name=$2,normalized_customer_name=lower($2),updated_at=now() WHERE tenant_id=$1', [saved._id, displayName]);
    await query(`UPDATE domain_monitors SET owner=$2,updated_at=now() WHERE tenant_id=$1 AND $3<>'exnb-exva'`, [saved._id, displayName, name]);
    return res.status(existing ? 200 : 201).json({ tenant: tenantView(saved) });
  } catch (error) { next(error); }
}
exports.createTenant=(req,res,next)=>saveTenant(req,res,next);exports.updateTenant=async(req,res,next)=>{const t=await tenantRepository.findById(req.params.id);if(!t)return res.status(404).json({error:'Tenant not found'});return saveTenant(req,res,next,t);};
