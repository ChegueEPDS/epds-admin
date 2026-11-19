const {query}=require('../postgres');
const tenantRepository=require('../repositories/postgres/tenantRepository');
const { validateDefaultCurrency } = require('../services/tenantCurrency');
const { workTurnoverError } = require('../services/workTurnover');
function tenantView(t) {
  return { id: String(t._id), name: t.name, displayName: t.displayName || t.name, type: t.type,
    defaultCurrency: t.defaultCurrency, workTurnoverDay: t.workTurnoverDay, alignWorkSequence: t.alignWorkSequence,
    features: t.features || {}, financeAccess: t.features?.financeAccess?.enabled === true,
    ownerUserId: t.ownerUserId || null, createdAt: t.createdAt, updatedAt: t.updatedAt };
}
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
