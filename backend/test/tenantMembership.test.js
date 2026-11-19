const test = require('node:test');
const assert = require('node:assert/strict');
const sessions = require('../src/services/authSessionService');
const Tenant = require('../src/models/tenant');

const tenantA = '000000000000000000000001';
const tenantB = '000000000000000000000002';
const tenantC = '000000000000000000000003';

test('a request can select an assigned tenant and uses only its feature permissions', async (t) => {
  const user = {
    id: 'account', role: 'Admin', tenantId: tenantA, tenantType: 'company',
    tenantFeatures: { licenses: { enabled: true, edit: true } }
  };
  let memberships = [tenantB];
  t.mock.method(sessions, 'getAccessTokenFromRequest', () => ({ token: 'fixture' }));
  t.mock.method(sessions, 'validateCsrf', () => true);
  t.mock.method(sessions, 'authenticateAccessToken', async () => ({
    user, additionalTenantIds: memberships, session: { _id: 'session' }
  }));
  const find = t.mock.method(Tenant, 'findById', (id) => ({
    lean: async () => ({
      _id: id, name: 'second-tenant', type: 'client', features: { workBoard: true, mail: true }
    })
  }));
  const { requireAuth } = require('../src/middlewares/authMiddleware');
  const request = (id) => new Promise((resolve) => {
    const req = { headers: id ? { 'x-tenant-context': id } : {} };
    const res = { status(code) { this.code = code; return this; }, json() { resolve({ status: this.code }); } };
    requireAuth(req, res, () => resolve({ status: 200, scope: req.scope }));
  });

  assert.equal((await request()).scope.tenantId, tenantA);
  assert.equal((await request(tenantC)).status, 403);
  assert.equal(find.mock.callCount(), 0);
  const { scope } = await request(tenantB);
  assert.equal(scope.tenantId, tenantB);
  assert.equal(scope.tenantType, 'client');
  assert.equal(scope.tenantFeatures.workBoard.edit, true);
  assert.equal(scope.tenantFeatures.licenses.enabled, false);
  assert.equal(scope.tenantFeatures.mail.enabled, false);
  memberships = [];
  assert.equal((await request(tenantB)).status, 403);
});
