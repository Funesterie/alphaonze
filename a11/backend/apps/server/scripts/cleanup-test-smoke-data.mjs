#!/usr/bin/env node
import process from 'process';
import { runCleanupTestData } from './cleanup-test-smoke-data-lib.mjs';

const connectionString = process.env.PGURL || process.env.DATABASE_URL || 'postgres://localhost:5432/db';
const dryRun = !process.argv.includes('--apply');
const verbose = true;

console.log(`[A11 CLEANUP] Connecting to Postgres. Dry-run: ${dryRun}`);
runCleanupTestData({ dryRun, verbose, connectionString })
  .then((result) => {
    if (result.dryRun) {
      console.log(`[A11 CLEANUP] Dry-run complete. ${result.totalPlanned} rows would be deleted. Use --apply to actually delete.`);
      for (const plan of result.plans) {
        console.log(`[PLAN] ${plan.table}: ${plan.count} rows would be deleted.`);
      }
    } else {
      console.log(`[A11 CLEANUP] Cleanup complete. ${result.deleted} rows deleted.`);
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error('[A11 CLEANUP] Error:', err);
    process.exit(1);
  });
