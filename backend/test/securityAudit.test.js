const test = require('node:test');
const assert = require('node:assert/strict');
const { eventFor, financialChange, tagChange } = require('../src/services/securityAudit');
const { canRecover } = require('../src/services/accountRecovery');

const tenantId = '000000000000000000000001';
const userId = '000000000000000000000002';
const id = '000000000000000000000003';

test('audit records the target tenant, actor, and before and after values without copying request data', () => {
  const req = {
    method: 'PATCH', route: { path: '/finance/tenants/:tenantId/works/:id' },
    params: { tenantId, id }, userId, role: 'Finance',
    body: { secret: 'sensitive-input' }, originalUrl: '/raw?token=sensitive-token'
  };
  financialChange(req, { status: 'invoiced' }, { status: 'paid' }, tenantId);
  const event = eventFor(req, 200);
  assert.equal(event.actorId, userId);
  assert.equal(event.tenantId, tenantId);
  assert.equal(event.targets.id, id);
  assert.deepEqual(event.changes.status, { before: 'invoiced', after: 'paid' });
  assert.doesNotMatch(JSON.stringify(event), /sensitive-/);
  assert.deepEqual(eventFor(req, 409).changes, {});
});

test('audit includes exports, role edits and deletion, without recording webhook inbox tokens', () => {
  const req = { userId, scope: { tenantId }, params: { id, token: 'inbox-secret' } };
  assert.equal(eventFor({ ...req, method: 'GET', route: { path: '/work-board/transfer/export' } }, 200).action, 'data.exported');
  const deleted = eventFor({ ...req, method: 'DELETE', route: { path: '/inboxes/:token/requests' } }, 204);
  assert.equal(deleted.action, 'record.deleted');
  assert.doesNotMatch(JSON.stringify(deleted), /inbox-secret/);
  tagChange(req, 'account.role_or_tenant_changed', { role: 'User' }, { role: 'Admin' }, ['role'], tenantId);
  assert.deepEqual(eventFor({ ...req, method: 'PATCH', route: { path: '/admin/users/:id' } }, 200).changes.role,
    { before: 'User', after: 'Admin' });
});

test('web recovery is limited to activated local non-SuperAdmin accounts', () => {
  const active = { loginMethod: 'password', emailVerified: true, password: 'hash', role: 'Finance' };
  assert.equal(canRecover(active), true);
  assert.equal(canRecover({ ...active, role: 'SuperAdmin' }), false);
  assert.equal(canRecover({ ...active, loginMethod: 'microsoft' }), false);
  assert.equal(canRecover({ ...active, emailVerified: false }), false);
});
