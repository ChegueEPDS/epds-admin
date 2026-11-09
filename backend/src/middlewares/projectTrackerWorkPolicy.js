const repo = require('../services/projectTrackerStore');
const board = require('../services/projectTrackerWorks');
const { statuses, extendedStatuses, trackerStatuses, currencies } = require('../services/projectTrackerDomain');

const legacyFinancial = ['invoiceNumber', 'invoiceDate', 'invoicePaymentDeadline', 'paidAmount', 'paidAt'];
const recognized = (value) => Object.hasOwn(statuses, value);
const respond = (res, status, error) => res.status(status).json({ error });

function projectTrackerWorkPolicy(operation) {
  return async (req, res, next) => {
    try {
      const input = req.body || {};
      const tenant = req.scope.tenantId;
      const enabled = Boolean(req.scope.tenantFeatures?.projectTracker?.enabled);
      const admin = ['Admin', 'SuperAdmin'].includes(req.role);
      const sub = operation === 'subEdit' ? await board.target(tenant, 'subWork', req.params.subWorkId) : null;
      if (operation === 'subEdit' && (!sub || sub.archivedAt)) return respond(res, 404, 'Sub-work not found');
      const workId = sub?.workItemId || req.params.id;
      const work = workId ? await board.work(tenant, workId) : null;
      if (workId && (!work || work.archivedAt)) return respond(res, 404, 'Work not found');
      const record = workId ? await repo.get(tenant, 'work', workId) : null;
      const managedBilling = enabled || Boolean(record?.data.invoices?.length || record?.data.opening || record?.data.importKeys?.length);
      if (enabled && work && !admin && work.responsibleUserId !== req.userId && record?.data.backupId !== req.userId) {
        return respond(res, 403, 'Only the work owner, backup or an administrator can edit this work');
      }
      const currentStatus = sub?.status || work?.status;
      if (Object.hasOwn(input, 'statusReason')) {
        if (typeof input.statusReason !== 'string' || input.statusReason.length > 1000) return respond(res, 400, 'Invalid delivery status reason');
        input.statusReason = input.statusReason.trim();
      }
      if (enabled && ['workCreate', 'workEdit'].includes(operation) && input.status !== currentStatus &&
          ['cancelled', 'lost'].includes(input.status) && !input.statusReason) {
        return respond(res, 400, 'Enter a reason for losing or cancelling this scope');
      }
      if (input.status && !recognized(input.status)) return respond(res, 400, 'Invalid work status');
      if (input.status && input.status !== currentStatus) {
        if (enabled && !trackerStatuses.includes(input.status)) return respond(res, 400, 'Record billing changes in Project Tracker');
        if (!enabled && extendedStatuses.includes(input.status)) return respond(res, 400, 'Enable Project Tracker to select this status');
        if (managedBilling && ['invoiced', 'paid'].includes(input.status)) return respond(res, 400, 'Record billing changes in Project Tracker');
      }
      if (managedBilling) {
        for (const key of legacyFinancial) delete input[key];
        if (work && operation === 'workEdit' && input.currency && input.currency !== work.currency &&
            (record?.data.invoices?.length || record?.data.opening)) {
          return respond(res, 409, 'Reconcile the existing billing records before changing the work currency');
        }
      }
      if (Object.hasOwn(input, 'currency')) {
        const currency = typeof input.currency === 'string' ? input.currency.trim().toUpperCase() : '';
        if (!currencies.includes(currency)) return respond(res, 400, 'Invalid currency');
        input.currency = currency;
      }
      if (operation === 'workEdit' && enabled && !admin && Object.hasOwn(input, 'responsibleUserId') &&
        (input.responsibleUserId || null) !== work.responsibleUserId) {
        return respond(res, 403, 'Only tenant administrators can reassign a work');
      }
      if (operation === 'workCreate' && enabled && !admin) {
        if (input.responsibleUserId && input.responsibleUserId !== req.userId) {
          return respond(res, 403, 'Only tenant administrators can assign a new work to another user');
        }
        input.responsibleUserId = req.userId;
      }
      if (input.responsibleUserId && !(await board.users(tenant)).some((user) => user.id === input.responsibleUserId)) {
        return respond(res, 400, 'Responsible user is not available in this tenant');
      }
      if (operation === 'workEdit' && !input.clientId && !work.clientId && work.customer) delete input.clientId;
      if (input.clientId && !await board.target(tenant, 'client', input.clientId)) {
        return respond(res, 400, 'Client is not linked to this tenant');
      }
      return next();
    } catch (error) { next(error); }
  };
}
module.exports = { projectTrackerWorkPolicy };
