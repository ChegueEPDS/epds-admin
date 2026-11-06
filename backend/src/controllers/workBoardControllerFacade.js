const mongo = require('./workBoardController');
const postgres = require('./postgresWorkBoardController');
const { databaseEngine } = require('../postgres');

const facade = { TERMINAL_STATUSES: mongo.TERMINAL_STATUSES, _test: mongo._test };
for (const name of Object.keys(postgres)) {
  facade[name] = (req, res, next) => databaseEngine() === 'postgresql'
    ? postgres[name](req, res, next)
    : mongo[name](req, res, next);
}
module.exports = facade;
