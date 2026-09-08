#!/usr/bin/env node
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const { connectDb } = require('../src/db');
const { runPerformanceMigration } = require('../src/services/performanceMigrationService');

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  await connectDb();
  const result = await runPerformanceMigration({ dryRun });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
