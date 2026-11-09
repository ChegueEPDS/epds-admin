const { databaseEngine, query } = require('../postgres');
const { WorkItem } = require('../models/workItem');
const SubWorkItem = require('../models/subWorkItem');
const ClientCompany = require('../models/clientCompany');
const User = require('../models/user');
const store = require('../repositories/postgres/workBoardRepository');
const { fail } = require('./projectTrackerDomain');

const pg = () => databaseEngine() === 'postgresql';
const mongoWork = (work) => work ? {
  ...work, id: String(work._id), responsibleUserId: work.responsibleUserId ? String(work.responsibleUserId) : null,
  clientId: work.clientId ? String(work.clientId) : null
} : null;
const pgWork = (row) => row ? {
  id: row.id, workNumber: row.work_number, name: row.name, customer: row.customer,
  clientId: row.client_id, responsibleUserId: row.responsible_user_id, responsible: row.responsible,
  status: row.status, statusReason: row.status_reason || '', deadline: row.deadline, currency: row.currency, totalAmount: Number(row.total_amount),
  description: row.description, completionDate: row.completion_date, invoiceNumber: row.invoice_number,
  invoiceDate: row.invoice_date, archivedAt: row.archived_at, updatedAt: row.updated_at
} : null;
const workProjection = 'work_number name customer client_id responsible_user_id responsible status status_reason deadline currency total_amount description completion_date invoice_number invoice_date archived_at updated_at';
const validId = (id) => typeof id === 'string' && /^[a-f0-9]{24}$/i.test(id);

async function works(tenantId) {
  const limit = 20001;
  const result = pg()
    ? (await query(`SELECT id,${workProjection.replaceAll(' ', ',')} FROM work_items WHERE tenant_id=$1 ORDER BY id LIMIT $2`, [tenantId, limit])).rows.map(pgWork)
    : (await WorkItem.find({ tenantId }).sort('_id').limit(limit)
      .select('workNumber name customer clientId responsibleUserId responsible status statusReason deadline currency totalAmount description completionDate invoiceNumber invoiceDate archivedAt updatedAt').lean()).map(mongoWork);
  if (result.length === limit) fail('This portfolio exceeds the reporting limit', 422);
  return result;
}
async function work(tenantId, id) {
  if (!validId(id)) return null;
  if (!pg()) return mongoWork(await WorkItem.findOne({ _id: id, tenantId }).lean());
  return pgWork((await query('SELECT * FROM work_items WHERE id=$1 AND tenant_id=$2', [id, tenantId])).rows[0]);
}
async function users(tenantId) {
  const entries = pg() ? await store.listUsers(tenantId) : await User.find({ tenantId, active: { $ne: false } }).select('firstName lastName email').lean();
  return entries.map((entry) => ({ id: String(entry.id || entry._id), name: [entry.firstName, entry.lastName].filter(Boolean).join(' ') || entry.email }));
}
async function clients(tenantId) {
  const entries = pg() ? await store.listClients(tenantId) : await ClientCompany.find({ tenantIds: tenantId }).select('name taxNumber').lean();
  return entries.map((entry) => ({ id: String(entry.id || entry._id), name: entry.name }));
}
async function target(tenantId, kind, id) {
  if (!validId(id)) return null;
  if (kind === 'work') return work(tenantId, id);
  if (kind === 'client') {
    return pg() ? (await store.isClientLinked(id, tenantId) ? { id } : null)
      : ClientCompany.exists({ _id: id, tenantIds: tenantId });
  }
  if (kind !== 'subWork') return null;
  if (pg()) {
    return (await query(`SELECT s.id,s.status,s.archived_at AS "archivedAt",s.work_item_id AS "workItemId"
      FROM sub_work_items s JOIN work_items w ON w.id=s.work_item_id AND w.tenant_id=s.tenant_id
      WHERE s.id=$1 AND s.tenant_id=$2 AND w.archived_at IS NULL`, [id, tenantId])).rows[0] || null;
  }
  const sub = await SubWorkItem.findOne({ _id: id, tenantId }).lean();
  if (!sub || !(await WorkItem.exists({ _id: sub.workItemId, tenantId, archivedAt: { $exists: false } }))) return null;
  return { ...sub, workItemId: String(sub.workItemId) };
}
async function subWorks(tenantId, workId) {
  const result = pg()
    ? (await query('SELECT id,name FROM sub_work_items WHERE tenant_id=$1 AND work_item_id=$2 AND archived_at IS NULL ORDER BY sequence_number', [tenantId, workId])).rows
    : await SubWorkItem.find({ tenantId, workItemId: workId, archivedAt: { $exists: false } }).select('name').sort('sequenceNumber').lean();
  return result.map((row) => ({ id: String(row.id || row._id), name: row.name }));
}
async function legacyBilling(tenantId, ids) {
  if (!ids.length) return new Map();
  let rows;
  if (pg()) {
    rows = (await query(`SELECT work_item_id AS id, SUM(paid_amount) AS paid FROM sub_work_items
      WHERE tenant_id=$1 AND work_item_id=ANY($2::varchar[]) AND
        (paid_amount>0 OR invoice_number<>'' OR invoice_date IS NOT NULL OR status=ANY($3::text[]))
      GROUP BY work_item_id`, [tenantId, ids, ['invoiced', 'paid']])).rows;
  } else {
    const { Types } = require('mongoose');
    rows = await SubWorkItem.aggregate([
      { $match: { tenantId: new Types.ObjectId(tenantId), workItemId: { $in: ids.map((id) => new Types.ObjectId(id)) },
        $or: [{ paidAmount: { $gt: 0 } }, { invoiceNumber: { $gt: '' } }, { invoiceDate: { $type: 'date' } },
          { status: { $in: ['invoiced', 'paid'] } }] } },
      { $group: { _id: '$workItemId', paid: { $sum: '$paidAmount' } } }
    ]);
  }
  return new Map(rows.map((row) => [String(row.id || row._id), { legacyBilling: true, legacyPaid: Number(row.paid || 0) }]));
}
module.exports = { works, work, users, clients, target, subWorks, legacyBilling };
