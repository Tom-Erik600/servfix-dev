#!/usr/bin/env node

/**
 * Migrasjon: Legg til kommersielle utfall-kolonner på deviations (Avvik til omsetning v1)
 *
 * Legger til tre additive, nullbare kolonner på deviations-tabellen i hver tenant-database:
 *   - outcome             VARCHAR(20)   — fixed_on_site | wants_quote | not_applicable | NULL
 *   - outcome_handled_at  TIMESTAMPTZ   — settes når admin kvitterer ut
 *   - quote_id            VARCHAR(50)   — kobling til tilbudet laget fra avviket (nullbar)
 *
 * Uavhengig av eksisterende closure-livssyklus (status/closure_mode røres IKKE).
 * Idempotent: ADD COLUMN IF NOT EXISTS + CHECK-constraint kun hvis den mangler.
 *
 * Bruk:
 *   node migrations/009-add-deviations-commercial-columns.js                      # Alle tenants
 *   node migrations/009-add-deviations-commercial-columns.js --tenant=airtechdev  # Kun én
 *   node migrations/009-add-deviations-commercial-columns.js --dry-run            # Vis SQL
 */

require('dotenv').config();
const { Pool } = require('pg');

// ── CLI-flagg ──────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const tenantFlag = args.find(a => a.startsWith('--tenant='));
const ONLY_TENANT = tenantFlag ? tenantFlag.split('=')[1] : null;

// ── DB-konfig (samme logikk som src/config/database.js) ───────────
function getBaseConfig() {
  if (process.env.CLOUD_SQL_CONNECTION_NAME) {
    return {
      host: `/cloudsql/${process.env.CLOUD_SQL_CONNECTION_NAME}`,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
    };
  }
  return {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  };
}

// ── SQL: additive kolonner (idempotent) ───────────────────────────
const ADD_COLUMNS_SQL = `
ALTER TABLE deviations
  ADD COLUMN IF NOT EXISTS outcome            VARCHAR(20),
  ADD COLUMN IF NOT EXISTS outcome_handled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS quote_id           VARCHAR(50);
`;

// ── SQL: CHECK-constraint kun hvis den ikke finnes ────────────────
const ADD_CHECK_SQL = `
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'chk_deviations_outcome'
      AND table_name = 'deviations'
  ) THEN
    ALTER TABLE deviations
      ADD CONSTRAINT chk_deviations_outcome
      CHECK (outcome IS NULL OR outcome IN ('fixed_on_site','wants_quote','not_applicable'));
  END IF;
END $$;
`;

// ── Verifisering ──────────────────────────────────────────────────
const VERIFY_SQL = `
SELECT COUNT(*) AS column_count
FROM information_schema.columns
WHERE table_name = 'deviations'
  AND column_name IN ('outcome','outcome_handled_at','quote_id');
`;

// ── Hovedlogikk ───────────────────────────────────────────────────
async function main() {
  console.log('========================================');
  console.log('  ServFix — Database-migrering');
  console.log('  009-add-deviations-commercial-columns');
  console.log('========================================');
  if (DRY_RUN) console.log('  MODE: DRY RUN (ingen endringer)');
  if (ONLY_TENANT) console.log(`  TENANT: kun "${ONLY_TENANT}"`);
  console.log('');

  const baseConfig = getBaseConfig();

  const adminPool = new Pool({ ...baseConfig, database: 'servfix_admin' });

  let tenants;
  try {
    let query = 'SELECT id, database_name FROM tenants WHERE is_active = true';
    const params = [];
    if (ONLY_TENANT) {
      query += ' AND id = $1';
      params.push(ONLY_TENANT);
    }
    query += ' ORDER BY id';
    const result = await adminPool.query(query, params);
    tenants = result.rows;
  } catch (err) {
    console.error('❌ Kunne ikke koble til servfix_admin:', err.message);
    await adminPool.end();
    process.exit(1);
  }

  await adminPool.end();

  if (tenants.length === 0) {
    console.error('❌ Ingen aktive tenants funnet' + (ONLY_TENANT ? ` med id="${ONLY_TENANT}"` : ''));
    process.exit(1);
  }

  console.log(`Fant ${tenants.length} tenant(s):\n`);
  const results = [];

  for (const tenant of tenants) {
    console.log(`── Tenant: ${tenant.id} (${tenant.database_name}) ──`);

    if (DRY_RUN) {
      console.log('  [DRY RUN] SQL som ville blitt kjørt:');
      console.log('  STEG 1: ALTER TABLE deviations ADD COLUMN IF NOT EXISTS ...');
      console.log(ADD_COLUMNS_SQL);
      console.log('  STEG 2: ADD CONSTRAINT chk_deviations_outcome (kun hvis mangler)');
      console.log(ADD_CHECK_SQL);
      results.push({ tenant: tenant.id, status: 'dry-run' });
      continue;
    }

    const pool = new Pool({ ...baseConfig, database: tenant.database_name });
    try {
      console.log('  🔧 Steg 1: ADD COLUMN IF NOT EXISTS (outcome, outcome_handled_at, quote_id)...');
      await pool.query(ADD_COLUMNS_SQL);
      console.log('  ✅ Steg 1 fullført');

      console.log('  🔧 Steg 2: ADD CONSTRAINT chk_deviations_outcome (idempotent)...');
      await pool.query(ADD_CHECK_SQL);
      console.log('  ✅ Steg 2 fullført');

      const verify = await pool.query(VERIFY_SQL);
      const colCount = parseInt(verify.rows[0].column_count, 10);
      const ok = colCount === 3;

      if (ok) {
        console.log(`  ✅ Verifisering OK — alle 3 kolonner finnes`);
      } else {
        console.log(`  ⚠️  Verifisering — fant ${colCount}/3 kolonner`);
      }

      results.push({ tenant: tenant.id, status: ok ? 'ok' : 'partial', columns: colCount });
    } catch (err) {
      console.error(`  ❌ Feil: ${err.message}`);
      results.push({ tenant: tenant.id, status: 'error', error: err.message });
    } finally {
      await pool.end();
    }
    console.log('');
  }

  console.log('========================================');
  console.log('  OPPSUMMERING');
  console.log('========================================');
  for (const r of results) {
    const icon = r.status === 'ok' ? '✅' : r.status === 'dry-run' ? '🔍' : r.status === 'partial' ? '⚠️' : '❌';
    console.log(`  ${icon} ${r.tenant}: ${r.status}${r.error ? ' — ' + r.error : ''}`);
  }
  console.log('');

  const hasErrors = results.some(r => r.status === 'error');
  process.exit(hasErrors ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal feil:', err);
  process.exit(1);
});
