const REQUIRED_POSTGRES_REPOSITORIES = Object.freeze([
  'auth', 'session', 'tenant', 'user', 'clientCompany', 'workBoard', 'effort',
  'domainHealth', 'license', 'integration', 'webhook', 'scheduledJob'
]);

const implementations = new Map();

function registerPostgresRepository(name, implementation) {
  if (!REQUIRED_POSTGRES_REPOSITORIES.includes(name)) throw new Error(`Unknown repository: ${name}`);
  if (!implementation || typeof implementation !== 'object') throw new Error(`Invalid repository: ${name}`);
  implementations.set(name, implementation);
}

function postgresRuntimeReadiness() {
  const ready = REQUIRED_POSTGRES_REPOSITORIES.filter((name) => implementations.has(name));
  const missing = REQUIRED_POSTGRES_REPOSITORIES.filter((name) => !implementations.has(name));
  return { ready, missing, complete: missing.length === 0 };
}

function assertPostgresRuntimeReady() {
  const status = postgresRuntimeReadiness();
  if (!status.complete) {
    throw new Error(`PostgreSQL runtime is not ready; missing repositories: ${status.missing.join(', ')}`);
  }
}

function repository(name) {
  const value = implementations.get(name);
  if (!value) throw new Error(`PostgreSQL repository is not registered: ${name}`);
  return value;
}

module.exports = {
  REQUIRED_POSTGRES_REPOSITORIES, registerPostgresRepository,
  postgresRuntimeReadiness, assertPostgresRuntimeReady, repository
};
