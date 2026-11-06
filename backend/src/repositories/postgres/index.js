const { registerPostgresRepository } = require('../repositoryRegistry');
const tenant = require('./tenantRepository');
const user = require('./userRepository');
const session = require('./sessionRepository');
const auth = require('./authRepository');
const workBoard = require('./workBoardRepository');
const effort = require('./effortRepository');
const scheduledJob = require('./scheduledJobRepository');
const domainHealth = require('./domainHealthRepository');
const license = require('./licenseRepository');
const integration = require('./integrationRepository');

let registered = false;

function registerImplementedRepositories() {
  if (registered) return;
  registerPostgresRepository('tenant', tenant);
  registerPostgresRepository('user', user);
  registerPostgresRepository('session', session);
  registerPostgresRepository('auth', auth);
  registerPostgresRepository('workBoard', workBoard);
  registerPostgresRepository('effort', effort);
  registerPostgresRepository('scheduledJob', scheduledJob);
  registerPostgresRepository('domainHealth', domainHealth);
  registerPostgresRepository('clientCompany', workBoard);
  registerPostgresRepository('license', license);
  registerPostgresRepository('integration', integration);
  registerPostgresRepository('webhook', integration);
  registered = true;
}

module.exports = { registerImplementedRepositories };
