const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const { defer, of, throwError } = require('rxjs');

function loadAuthService() {
  const filename = join(__dirname, '../src/app/services/auth.service.ts');
  const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, experimentalDecorators: true }
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, queueMicrotask,
    require(name) {
      if (name === '@angular/core') return { Injectable: () => (target) => target };
      if (name.includes('environment')) return { environment: { apiBaseUrl: '/api' } };
      if (name.includes('msal.config')) return { loginRequest: {} };
      return require(name);
    }
  }, { filename });
  return exports.AuthService;
}

test('reload restores the session after construction without circular interceptor resolution', async () => {
  const AuthService = loadAuthService();
  let service;
  let requests = 0;
  const user = { id: 'superadmin', role: 'SuperAdmin' };
  const http = {
    get: () => defer(() => {
      requests++;
      // The real interceptor resolves this service and reads its tenant context.
      if (!service) throw new Error('NG0200: circular dependency');
      service.getTenantContextId();
      return of({ user });
    }),
    post: () => { throw new Error('Valid session must not require refresh'); }
  };
  service = new AuthService(http, {}, {});
  assert.equal(requests, 0);
  await new Promise(queueMicrotask);
  assert.equal(requests, 1);
  assert.equal(service.isAuthenticated(), true);
  service.setTenantContext({ id: 'tenant-b', features: {} });
  assert.equal(service.getTenantContextId(), 'tenant-b');
  assert.equal(service.getCurrentUser(), user);
});

test('expired access token is refreshed on startup before authentication is ready', async () => {
  const AuthService = loadAuthService();
  let refreshed = 0;
  const service = new AuthService({
    get: () => throwError(() => ({ status: 401 })),
    post: () => { refreshed++; return of({ user: { id: 'admin', role: 'SuperAdmin' } }); }
  }, {}, {});
  let ready;
  service.authReady$.subscribe(value => { ready = value; });
  assert.equal(ready, false);
  await new Promise(queueMicrotask);
  assert.equal(refreshed, 1);
  assert.equal(ready, true);
  assert.equal(service.isAuthenticated(), true);
});

test('a new Webhook Tester tab restores a regular tenant user without another login', async () => {
  const AuthService = loadAuthService();
  const user = {
    id: 'tenant-user', role: 'User', tenantId: 'tenant-a',
    tenantFeatures: { webhookTester: { enabled: true, edit: true, delete: false } }
  };
  function openTab() {
    let service;
    service = new AuthService({
      get: (url, options) => defer(() => {
        assert.equal(url, '/api/auth/me');
        assert.equal(options.withCredentials, true);
        assert.ok(service, 'interceptor must resolve a fully constructed service');
        service.getTenantContextId();
        return of({ user });
      }),
      post: () => { throw new Error('Opening a tab must not require login'); }
    }, {}, {});
    return service;
  }
  const originalTab = openTab();
  await new Promise(queueMicrotask);
  const webhookTab = openTab();
  await new Promise(queueMicrotask);
  assert.equal(originalTab.isAuthenticated(), true);
  assert.equal(webhookTab.isAuthenticated(), true);
  assert.equal(webhookTab.canAccessFeature('webhookTester'), true);
  assert.equal(webhookTab.getCurrentUser().id, user.id);
});
