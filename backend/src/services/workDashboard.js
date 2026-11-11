const mongoose = require('mongoose');
const Decimal = require('decimal.js').clone({ precision: 40 });
const { databaseEngine, query } = require('../postgres');
const User = require('../models/user');
const { WorkItem } = require('../models/workItem');
const SubWorkItem = require('../models/subWorkItem');
const { latestRates, convertTotals } = require('./mnbExchangeRates');
const { getDefaultCurrency } = require('./tenantCurrency');
const { workCalendar, workPeriodStart } = require('./workTurnover');
const Tenant = require('../models/tenant');

const stages = {
  inquiry: 'Lead', offer: 'Lead', to_start: 'Active', in_progress: 'Active', on_hold: 'On Hold',
  completed_billable: 'Completed', invoiced: 'Completed', paid: 'Completed', closed: 'Completed',
  cancelled: 'Cancelled', lost: 'Lost'
};
const stageNames = [...new Set(Object.values(stages))];
const deadlineNames = ['Overdue', 'Due in 14 days', 'On track', 'No deadline'];
const financeMetrics = [
  { key: 'paid', label: 'Received' },
  { key: 'receivable', label: 'Invoiced, unpaid' },
  { key: 'unbilled', label: 'Not yet invoiced' }
];
const sizeNames = ['Small', 'Medium', 'Large', 'Unclassified'];
const paymentStatuses = ['not_invoiced', 'invoiced', 'partially_paid', 'paid'];
const checkNames = ['No owner', 'No backup', 'No status', 'No client', 'No service type', 'No amount', 'No currency',
  'Payment status missing', 'Paid amount missing', 'Invoiced amount missing', "'Not Invoiced' but amount invoiced",
  'Marked Paid but balance open', 'Paid > invoiced', 'No deadline', 'No next action', 'Action overdue',
  'Not updated >14 days', 'Payment overdue', 'Stage formula overwritten'];
const isoDay = /^\d{4}-\d{2}-\d{2}$/;
const day = (value) => !value ? null : isoDay.test(value) ? value : workCalendar.format(new Date(value));
const dayNumber = (value) => Date.parse(value) / 86400000;
const fail = (message) => Object.assign(new Error(message), { statusCode: 400 });

async function workReporting(req, previous, sizeEnabled) {
  const input = req.body?.reporting;
  if (input === undefined) return previous;
  if (req.scope.tenantType === 'client' || !input || typeof input !== 'object' || Array.isArray(input)) {
    throw fail('Invalid work reporting fields.');
  }
  const result = { ...previous };
  for (const key of ['backupId', 'nextAction', 'actionDue', 'invoicedAmount', 'paidAmount', 'paymentStatus', 'projectSize']) {
    if (!Object.hasOwn(input, key)) continue;
    const value = input[key];
    if (key === 'projectSize' && !sizeEnabled) throw fail('Project size grouping is disabled.');
    if (value === null || value === '') { delete result[key]; continue; }
    if (key === 'backupId' && value !== previous.backupId) {
      if (typeof value !== 'string' || !/^[0-9a-f]{24}$/.test(value)) throw fail('Select a backup from this tenant.');
      const tenantId = req.scope.tenantId;
      const exists = databaseEngine() === 'postgresql'
        ? (await query('SELECT 1 FROM users WHERE id=$1 AND tenant_id=$2', [value, tenantId])).rowCount
        : await User.exists({ _id: value, tenantId });
      if (!exists) throw fail('Select a backup from this tenant.');
    }
    if (key === 'nextAction' && (typeof value !== 'string' || !value.trim() || value.trim().length > 500)) throw fail('Invalid next action.');
    if (key === 'actionDue' && (typeof value !== 'string' || !isoDay.test(value) ||
        !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) throw fail('Invalid action deadline.');
    if (key.endsWith('Amount') && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 ||
        value > 999999999999 || new Decimal(value).decimalPlaces() > 2)) throw fail('Enter a nonnegative amount with up to two decimals.');
    if (key === 'paymentStatus' && !paymentStatuses.includes(value)) throw fail('Invalid payment status.');
    if (key === 'projectSize' && !sizeNames.slice(0, 3).includes(value)) throw fail('Invalid project size.');
    result[key] = key === 'nextAction' ? value.trim() : value;
  }
  return result;
}

async function reportWorks(tenantId) {
  if (databaseEngine() === 'postgresql') {
    const { rows } = await query(`SELECT w.id,w.work_number AS "workNumber",w.name,w.status,w.customer,w.responsible,w.currency,w.deadline,w.reporting,
      w.responsible_user_id AS "ownerId",w.entity_id AS "entityId",w.service_type_id AS "serviceTypeId",
      w.total_amount AS "totalAmount",w.created_at AS "createdAt",w.updated_at AS "updatedAt",w.invoice_number AS "invoiceNumber",
      w.invoice_date AS "invoiceDate",w.invoice_payment_deadline AS "paymentDue",p.paid AS "subPaid",p.invoiced AS "subInvoice"
      FROM work_items w LEFT JOIN (
        SELECT work_item_id,sum(paid_amount) FILTER (WHERE paid_amount>0) AS paid,
          bool_or(invoice_number<>'' OR invoice_date IS NOT NULL OR status IN ('invoiced','paid')) AS invoiced
        FROM sub_work_items WHERE tenant_id=$1 AND archived_at IS NULL AND status NOT IN ('cancelled','lost') GROUP BY work_item_id
      ) p ON p.work_item_id=w.id
      WHERE w.tenant_id=$1 AND w.archived_at IS NULL ORDER BY w.id`, [tenantId]);
    return rows;
  }
  const scope = { tenantId: new mongoose.Types.ObjectId(tenantId), archivedAt: { $exists: false } };
  const [works, subPayments] = await Promise.all([
    WorkItem.find(scope).select('workNumber name status customer responsible responsibleUserId entityId serviceTypeId currency deadline totalAmount reporting createdAt updatedAt invoiceNumber invoiceDate invoicePaymentDeadline').sort('_id').lean(),
    SubWorkItem.aggregate([{ $match: { ...scope, status: { $nin: ['cancelled', 'lost'] } } },
      { $group: { _id: '$workItemId', paid: { $sum: { $toDecimal: '$paidAmount' } },
        invoiced: { $max: { $or: [
          { $ne: [{ $ifNull: ['$invoiceNumber', ''] }, ''] },
          { $ne: [{ $ifNull: ['$invoiceDate', null] }, null] },
          { $in: ['$status', ['invoiced', 'paid']] }
        ] } } } }])
  ]);
  const payments = new Map(subPayments.map((row) => [String(row._id), row]));
  return works.map((work) => {
    const payment = payments.get(String(work._id));
    return { ...work, ownerId: work.responsibleUserId, paymentDue: work.invoicePaymentDeadline,
      subPaid: Number(payment?.paid) > 0 ? payment.paid.toString() : null, subInvoice: payment?.invoiced };
  });
}

function group(rows, key, label, initial = []) {
  const groups = new Map(initial.map((entry) => [entry.id, { id: entry.id, label: entry.label, rows: [] }]));
  for (const row of rows) {
    const id = key(row);
    if (!groups.has(id)) groups.set(id, { id, label: label(row), rows: [] });
    groups.get(id).rows.push(row);
  }
  return [...groups.values()];
}

function prepareWork(work, asOf, today, config, snapshot) {
  const reporting = work.reporting || {};
  const stage = Object.hasOwn(stages, work.status) ? stages[work.status] : 'Unknown';
  const active = stage === 'Active';
  const lead = stage === 'Lead';
  const completed = stage === 'Completed';
  const currency = String(work.currency || '').trim().toUpperCase() || '?';
  const contract = new Decimal(work.totalAmount || 0);
  const invoiced = reporting.invoicedAmount == null ? null : new Decimal(reporting.invoicedAmount);
  const paidValue = reporting.paidAmount ?? work.subPaid;
  const paid = paidValue == null ? null : new Decimal(paidValue);
  const payment = reporting.paymentStatus || ({ paid: 'paid', invoiced: 'invoiced' })[work.status] ||
    (work.invoiceNumber || work.invoiceDate || work.subInvoice ? 'invoiced' : '');
  const expectsPaid = ['paid', 'partially_paid'].includes(payment);
  const expectsInvoice = ['paid', 'partially_paid', 'invoiced'].includes(payment) || paid?.gt(0);
  const receivable = invoiced === null ? null : invoiced.minus(paid || 0);
  const unbilledScope = !['Lead', 'Cancelled', 'Lost'].includes(stage) && !contract.isZero();
  const unbilled = !unbilledScope || (invoiced === null && expectsInvoice) ? null : contract.minus(invoiced || 0);
  const deadlineDate = day(work.deadline);
  const daysLeft = deadlineDate ? dayNumber(deadlineDate) - today : null;
  const deadline = ['Completed', 'Cancelled', 'Lost'].includes(stage) ? 'Closed' : daysLeft === null ? 'No deadline'
    : daysLeft < 0 ? 'Overdue' : daysLeft <= 14 ? 'Due in 14 days' : 'On track';
  const stale = (active || lead) && (!work.updatedAt || today - dayNumber(day(work.updatedAt)) > 14);
  const checks = [
    [!work.ownerId && !work.responsible, 'No owner'], [active && !reporting.backupId, 'No backup'],
    [stage === 'Unknown', 'No status'], [!work.customer, 'No client'], [!work.serviceTypeId, 'No service type'],
    [active && contract.isZero(), 'No amount'], [!contract.isZero() && currency === '?', 'No currency'],
    [!payment && ((completed && !contract.isZero()) || (active && invoiced?.gt(0))), 'Payment status missing'],
    [expectsPaid && paid === null, 'Paid amount missing'], [expectsInvoice && invoiced === null, 'Invoiced amount missing'],
    [payment === 'not_invoiced' && invoiced?.gt(0), "'Not Invoiced' but amount invoiced"],
    [payment === 'paid' && receivable?.gt('0.01'), 'Marked Paid but balance open'],
    [paid !== null && invoiced !== null && paid.minus(invoiced).gt('0.01'), 'Paid > invoiced'],
    [active && !work.deadline, 'No deadline'], [(active || lead) && !reporting.nextAction, 'No next action'],
    [(active || lead) && reporting.actionDue && reporting.actionDue < asOf, 'Action overdue'],
    [stale, 'Not updated >14 days'], [work.paymentDue && day(work.paymentDue) < asOf && receivable?.gt('0.01'), 'Payment overdue']
  ].filter(([condition]) => condition).map(([, label]) => label);
  let size = reporting.projectSize || 'Unclassified';
  if (config.projectSizeGrouping && size === 'Unclassified' && !contract.isZero()) {
    const source = currency === 'HUF' ? { quote: '1', unit: 1 } : snapshot?.rates[currency];
    const eur = snapshot?.rates.EUR;
    const value = currency === 'EUR' ? contract : source && eur
      ? contract.times(source.quote).times(eur.unit).div(source.unit).div(eur.quote) : null;
    if (value) size = value.lt(5000) ? 'Small' : value.lt(20000) ? 'Medium' : 'Large';
  }
  return { ...work, stage, active, lead, completed, deadline, deadlineDate, stale, currency, contract, invoiced, paid,
    receivable, unbilled, unbilledScope, checks, size };
}

function financialGap(row, key) {
  if (key === 'paid') return row.checks.includes('Paid amount missing');
  if (key === 'unbilled') return row.unbilledScope && row.checks.includes('Invoiced amount missing');
  return row.checks.includes('Invoiced amount missing') || row.checks.includes('Paid amount missing');
}

function financialWorks(rows, key) {
  return rows.filter((row) => (key !== 'paid' || row.active || row.completed) &&
    ((row[key] !== null && !row[key].isZero()) || financialGap(row, key)));
}

function totals(items, key, currency, fx) {
  return convertTotals(items.filter((row) => row[key] !== null)
    .map((row) => ({ currency: row.currency, amount: row[key].toString() })), currency, fx);
}

function financialChart(rows, currency, fx) {
  return financeMetrics.map((metric) => {
    const items = financialWorks(rows, metric.key);
    const incomplete = items.filter((row) => financialGap(row, metric.key)).length;
    const value = totals(items, metric.key, currency, fx);
    if (incomplete && items.every((row) => row[metric.key] === null)) value.amount = null;
    return { ...metric, value, count: items.length, incomplete };
  });
}

function periodRows(works, config, fx, asOf, periodStart) {
  return works.filter((work) => {
    const created = day(work.createdAt);
    return created && created >= periodStart && created <= asOf;
  }).map((work) => prepareWork(work, asOf, dayNumber(asOf), config, fx.snapshot));
}

function buildDashboard(works, config, currency, fx, asOf = dashboardDate(), periodStart = workPeriodStart(asOf)) {
  const rows = periodRows(works, config, fx, asOf, periodStart);
  const reportedStages = rows.some((row) => row.stage === 'Unknown') ? [...stageNames, 'Unknown'] : stageNames;
  const count = (items, predicate) => items.filter(predicate).length;
  const money = (items, key = 'contract') => totals(items, key, currency, fx);
  const sum = (items, key) => {
    const known = items.filter((row) => row[key] !== null);
    return known.length ? known.reduce((total, row) => total.plus(row[key]), new Decimal(0)).toNumber() : null;
  };
  const contractRows = rows.filter((row) => row.active || row.completed);
  const activeRows = rows.filter((row) => row.active);
  const paymentGaps = count(rows, (row) =>
    row.checks.includes('Invoiced amount missing') || row.checks.includes('Paid amount missing'));
  const ownerStats = (items) => ({
    active: count(items, (row) => row.active), leads: count(items, (row) => row.lead),
    activeValue: money(items.filter((row) => row.active)), pipelineValue: money(items.filter((row) => row.lead)),
    overdue: count(items, (row) => row.deadline === 'Overdue'), stale: count(items, (row) => row.stale),
    attention: count(items, (row) => row.checks.length)
  });
  const owners = group(rows, (row) => row.ownerId ? String(row.ownerId) : row.responsible || '', (row) => row.responsible || 'Unassigned')
    .map(({ label, rows: items }) => ({ label, ...ownerStats(items) }));
  const catalogName = (catalog, id) => catalog.find((item) => item.id === id)?.label || 'Unassigned';
  const entities = group(rows, (row) => row.entityId || '', (row) => catalogName(config.entities, row.entityId),
    config.entities.filter((item) => !item.archived)).map(({ id, label, rows: items }) => ({
    id, label, counts: reportedStages.map((stage) => count(items, (row) => row.stage === stage)), total: items.length
  }));
  const services = group(rows, (row) => row.serviceTypeId || '', (row) => catalogName(config.serviceTypes, row.serviceTypeId),
    config.serviceTypes.filter((item) => !item.archived)).map(({ label, rows: items }) => ({
    label, active: count(items, (row) => row.active), leads: count(items, (row) => row.lead),
    completed: count(items, (row) => row.completed), value: money(items.filter((row) => row.active || row.completed))
  }));
  const payments = group(rows, (row) => row.currency, (row) => row.currency).map(({ label, rows: items }) => {
    const billedScope = items.filter((row) => row.active || row.completed);
    return { currency: label, contract: sum(billedScope, 'contract'), invoiced: sum(billedScope, 'invoiced'),
      paid: sum(billedScope, 'paid'), receivable: sum(items, 'receivable'), unbilled: sum(items, 'unbilled'),
      reportingReceivable: money(items, 'receivable'), reportingUnbilled: money(items, 'unbilled') };
  });
  const totalSizeValue = config.projectSizeGrouping ? money(contractRows) : null;
  const sizes = config.projectSizeGrouping ? sizeNames.map((label) => {
    const items = contractRows.filter((row) => row.size === label);
    const value = money(items);
    const knownCount = count(items, (row) => !row.contract.isZero() && !value.missingCurrencies.includes(row.currency) &&
      (!value.missingCurrencies.includes(currency) || row.currency === currency));
    return { label, count: items.length, value, average: knownCount && value.amount !== null ? value.amount / knownCount : null,
      share: totalSizeValue?.amount && value.amount !== null ? value.amount / totalSizeValue.amount : null };
  }) : null;
  const ownerTotal = ownerStats(rows);
  return {
    asOf, periodStart, currency, rateDate: fx.snapshot?.date || null, refreshFailed: fx.refresh?.failed === true, paymentGaps,
    aedRateDerived: fx.snapshot?.rates.AED?.source === 'cbuae-usd-peg' &&
      (currency === 'AED' || rows.some((row) => row.currency === 'AED')),
    summary: { ...ownerTotal, receivable: money(rows, 'receivable'), unbilled: money(rows, 'unbilled') },
    ownerTotal, owners, stages: reportedStages, entities,
    entityTotal: { counts: reportedStages.map((stage) => count(rows, (row) => row.stage === stage)), total: rows.length },
    payments, finance: financialChart(rows, currency, fx), services, sizes, totalSizeValue,
    deadlines: deadlineNames.map((label) => ({ label, count: count(activeRows, (row) => row.deadline === label) })),
    checks: checkNames.map((label) => ({ label, count: count(rows, (row) => row.checks.includes(label)) }))
  };
}

function dashboardDate() {
  return day(new Date());
}

async function dashboard(tenantId, config, currency, fx, asOf, periodStart) {
  return buildDashboard(await reportWorks(tenantId), config, currency, fx, asOf, periodStart);
}

function dashboardDrilldown(works, config, currency, fx, filter, asOf = dashboardDate(), periodStart = workPeriodStart(asOf)) {
  const rows = periodRows(works, config, fx, asOf, periodStart);
  let matched;
  let financeKey;
  if (filter.kind === 'deadline' && deadlineNames.includes(filter.value)) {
    matched = rows.filter((row) => row.active && row.deadline === filter.value);
  } else if (filter.kind === 'finance' && financeMetrics.some((metric) => metric.key === filter.value)) {
    financeKey = filter.value;
    matched = financialWorks(rows, financeKey);
  } else if (filter.kind === 'entity' && (stageNames.includes(filter.value) || filter.value === 'Unknown') && typeof filter.entityId === 'string') {
    matched = rows.filter((row) => (row.entityId || '') === filter.entityId && row.stage === filter.value);
  } else throw fail('Select a valid dashboard segment.');

  const limit = 25;
  const page = Math.min(Math.max(1, Math.floor(Number(filter.page) || 1)), Math.max(1, Math.ceil(matched.length / limit)));
  return { page, limit, total: matched.length, works: matched.slice((page - 1) * limit, page * limit).map((row) => ({
    id: String(row.id || row._id), workNumber: row.workNumber, name: row.name, responsible: row.responsible,
    stage: row.stage, deadline: row.deadlineDate, currency: row.currency,
    amount: financeKey ? row[financeKey]?.toString() ?? null : null,
    incomplete: financeKey ? financialGap(row, financeKey) : false,
    missingRate: Boolean(financeKey && row[financeKey] && !row[financeKey].isZero() && row.currency !== currency &&
      ((row.currency !== 'HUF' && !fx.snapshot?.rates[row.currency]) || (currency !== 'HUF' && !fx.snapshot?.rates[currency])))
  })) };
}

async function dashboardWorks(tenantId, config, filter) {
  const [works, currency, fx, tenant] = await Promise.all([reportWorks(tenantId), getDefaultCurrency(tenantId), latestRates(),
    databaseEngine() === 'postgresql'
      ? query('SELECT work_turnover_day AS "workTurnoverDay" FROM tenants WHERE id=$1', [tenantId]).then(({ rows }) => rows[0])
      : Tenant.findById(tenantId).select('workTurnoverDay').lean()]);
  const asOf = dashboardDate();
  return dashboardDrilldown(works, config, currency, fx, filter, asOf, workPeriodStart(asOf, tenant?.workTurnoverDay));
}

module.exports = { workReporting, dashboard, dashboardDate, dashboardWorks, buildDashboard, dashboardDrilldown };
