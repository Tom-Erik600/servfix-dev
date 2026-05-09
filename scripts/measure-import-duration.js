#!/usr/bin/env node

/**
 * scripts/measure-import-duration.js
 *
 * Q3-ii blocker check — measures importFromTripletex duration against test DB.
 *
 * PREREQUISITES:
 *   - Cloud SQL proxy running on port 5433 (test env):
 *       C:\tools\cloud-sql-proxy.x64.exe --port 5433 servfix-test:europe-north1:servfix-test-db
 *   - E:\apps\servfix-test\.env present with DB credentials for test
 *   - migration 002 already run against test (tenant_integrations in servfix_admin)
 *   - At least one tripletex integration row in servfix_admin.tenant_integrations for the tenant
 *
 * USAGE:
 *   node scripts/measure-import-duration.js
 *   node scripts/measure-import-duration.js --tenant=airtech --runs=3
 *   node scripts/measure-import-duration.js --tenant=airtech --runs=5 --env=E:\apps\servfix-test\.env
 *
 * EXIT CODES:
 *   0 — all runs completed, median ≤ 400s
 *   1 — run error (exception, config missing, etc.)
 *   2 — BLOCKER: median > 400s — do NOT deploy Fase 1a, open Cloud Run Jobs workstream first
 *
 * OUTPUT:
 *   JSON to stdout with per-run timings + aggregate stats.
 *   Human-readable summary to stderr.
 */

'use strict';

const path = require('path');
const fs = require('fs');

// ── CLI args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const tenantFlag = args.find((a) => a.startsWith('--tenant='));
const runsFlag = args.find((a) => a.startsWith('--runs='));
const envFlag = args.find((a) => a.startsWith('--env='));

const TENANT_ID = tenantFlag ? tenantFlag.split('=')[1] : 'airtech';
const RUNS = parseInt(runsFlag ? runsFlag.split('=')[1] : '3', 10);
const ENV_FILE = envFlag
  ? envFlag.split('=')[1]
  : path.resolve(__dirname, '..', '..', 'servfix-test', '.env');

// ── Load test .env ────────────────────────────────────────────────────────
if (!fs.existsSync(ENV_FILE)) {
  console.error(`❌ .env file not found: ${ENV_FILE}`);
  console.error('   Pass --env=path/to/.env or ensure E:\\apps\\servfix-test\\.env exists.');
  process.exit(1);
}

// Override dotenv to load from test env (not the dev .env in cwd)
const dotenv = require('dotenv');
const parsed = dotenv.parse(fs.readFileSync(ENV_FILE));
for (const [k, v] of Object.entries(parsed)) {
  if (!process.env[k]) process.env[k] = v; // don't overwrite already-set vars
}

// ── Load service (after env is set) ───────────────────────────────────────
const customerImportService = require('../src/services/customerImportService');

// ── Run ───────────────────────────────────────────────────────────────────
const BLOCKER_MS = 400_000; // 400s

async function runOnce(runNum) {
  console.error(`\n--- Run ${runNum}/${RUNS} (tenant=${TENANT_ID}) ---`);
  const result = await customerImportService.importFromTripletexInstrumented(TENANT_ID);
  console.error(
    `    total=${(result.totalMs / 1000).toFixed(1)}s  fetch=${(result.fetchMs / 1000).toFixed(1)}s  ` +
    `per-customer median=${result.perCustomerMs.median.toFixed(0)}ms p95=${result.perCustomerMs.p95.toFixed(0)}ms`
  );
  console.error(
    `    imported=${result.imported} updated=${result.updated} skipped=${result.skipped} errors=${result.errors.length}`
  );
  return result;
}

async function main() {
  console.error('========================================');
  console.error('  ServFix — Import duration measurement');
  console.error(`  tenant=${TENANT_ID}  runs=${RUNS}`);
  console.error(`  env=${ENV_FILE}`);
  console.error('========================================');

  const results = [];
  for (let i = 1; i <= RUNS; i++) {
    try {
      results.push(await runOnce(i));
    } catch (err) {
      console.error(`❌ Run ${i} failed: ${err.message}`);
      console.error(err.stack);
      process.exit(1);
    }
  }

  // ── Aggregate ─────────────────────────────────────────────────────────
  const totals = results.map((r) => r.totalMs).sort((a, b) => a - b);
  const median = totals[Math.floor(totals.length / 2)];
  const p95 = totals[Math.floor(totals.length * 0.95)] ?? totals[totals.length - 1];
  const min = totals[0];
  const max = totals[totals.length - 1];

  const output = {
    tenant: TENANT_ID,
    runs: results.map((r, i) => ({
      run: i + 1,
      totalMs: Math.round(r.totalMs),
      fetchMs: Math.round(r.fetchMs),
      perCustomerMs: {
        median: Math.round(r.perCustomerMs.median),
        p95: Math.round(r.perCustomerMs.p95),
      },
      imported: r.imported,
      updated: r.updated,
      skipped: r.skipped,
      errors: r.errors.length,
    })),
    aggregate: {
      median: Math.round(median),
      p95: Math.round(p95),
      min: Math.round(min),
      max: Math.round(max),
    },
    blocker_threshold_ms: BLOCKER_MS,
    blocker: median > BLOCKER_MS,
  };

  // ── Human-readable summary ────────────────────────────────────────────
  console.error('\n========================================');
  console.error('  Results');
  console.error('========================================');
  console.error(`  Median total:  ${(median / 1000).toFixed(1)}s`);
  console.error(`  p95 total:     ${(p95 / 1000).toFixed(1)}s`);
  console.error(`  Min / Max:     ${(min / 1000).toFixed(1)}s / ${(max / 1000).toFixed(1)}s`);
  console.error(`  Blocker (>400s median): ${output.blocker ? '❌ YES — DO NOT DEPLOY FASE 1a' : '✅ NO — safe to proceed'}`);

  // JSON to stdout
  console.log(JSON.stringify(output, null, 2));

  if (output.blocker) {
    console.error('\n❌ BLOCKER: median import time > 400s.');
    console.error('   Open Cloud Run Jobs workstream before Fase 1a deploy.');
    process.exit(2);
  }

  console.error('\n✅ Timing within acceptable range. Fase 1a deploy is unblocked.');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Unexpected error:', err);
  process.exit(1);
});
