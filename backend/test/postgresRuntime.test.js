const test = require('node:test');
const assert = require('node:assert/strict');

const registryPath = require.resolve('../src/repositories/repositoryRegistry');

test('PostgreSQL runtime refuses cutover while repositories are incomplete', () => {
  delete require.cache[registryPath];
  const registry = require(registryPath);
  const status = registry.postgresRuntimeReadiness();
  assert.equal(status.complete, false);
  assert.ok(status.missing.includes('auth'));
  assert.throws(() => registry.assertPostgresRuntimeReady(), /not ready/);
});

test('repository registry rejects unknown repository names', () => {
  delete require.cache[registryPath];
  const registry = require(registryPath);
  assert.throws(() => registry.registerPostgresRepository('unknown', {}), /Unknown repository/);
});

test('implemented PostgreSQL repositories satisfy the cutover guard', () => {
  delete require.cache[registryPath];
  delete require.cache[require.resolve('../src/repositories/postgres')];
  const registry = require(registryPath);
  require('../src/repositories/postgres').registerImplementedRepositories();
  const status = registry.postgresRuntimeReadiness();
  assert.ok(status.ready.includes('tenant'));
  assert.ok(status.ready.includes('user'));
  assert.ok(status.ready.includes('session'));
  assert.ok(status.ready.includes('workBoard'));
  assert.ok(status.ready.includes('effort'));
  assert.ok(status.ready.includes('scheduledJob'));
  assert.ok(status.ready.includes('domainHealth'));
  assert.ok(status.ready.includes('license'));
  assert.ok(status.ready.includes('integration'));
  assert.ok(status.ready.includes('webhook'));
  assert.deepEqual(status.missing, []);
  assert.equal(status.complete, true);
  assert.doesNotThrow(() => registry.assertPostgresRuntimeReady());
});
