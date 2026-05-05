#!/usr/bin/env node

/**
 * Migrasjon: Legg til updated_at-kolonne på orders-tabellen
 *
 * Bakgrunn: claim-endpointet (POST /orders/:id/claim) setter
 * `updated_at = NOW()`, men kolonnen fantes ikke i den opprinnelige
 * tabelldefinisjonen. Dette medfører 500-feil ved claim.
 *
 * STEG 1: Legg til `updated_at TIMESTAMPTZ DEFAULT NOW()` idempotent
 * STEG 2: Bakfyll eksisterende rader med created_at (gir fornuftig historikk)
 *
 * Bruk:
 *   node migrations/004-orders-add-updated-at.js                    # Alle tenants
 *   node migrations/004-orders-add-updated-at.js --tenant=airtech   # Kun én
 *   node migrations/004-orders-add-updated-at.js --dry-run          # Vis SQL, ikke kjør
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

// ── STEG 1: Legg til updated_at idempotent ────────────────────────
const ADD_COLUMN_SQL = `
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE orders ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
    RAISE NOTICE 'updated_at: kolonne lagt til';
  ELSE
    RAISE NOTICE 'updated_at: kolonne finnes allerede, ingen endring';
  END IF;
END $$;
`;

// ── STEG 2: Bakfyll eksisterende rader ────────────────────────────
// Rader som ble lagt til av STEG 1 vil ha updated_at = NOW() (kolonnedefault).
// Rader som allerede hadde kolonnen (ved re-kjøring) røres ikke av WHERE-klausulen.
// Vi korrigerer ved å sette updated_at = created_at der updated_at er null,
// eller der updated_at er svært nær NOW() (innen 5 sekunder — tegn på kolonnetillegg).
const BACKFILL_SQL = `
UPDATE orders
   SET updated_at = created_at
 WHERE updated_at IS NULL
    OR (created_at IS NOT NULL AND updated_at > NOW() - INTERVAL '5 seconds');
`;

// ── Verifiserings-SQL ─────────────────────────────────────────────
const VERIFY_SQL = `
SELECT
  (SELECT is_nullable FROM information_schema.columns
   WHERE table_name = 'orders' AND column_name = 'updated_at') AS col_exists,
  (SELECT COUNT(*) FROM orders WHERE updated_at IS NULL) AS null_count;
`;

// ── Hovedlogikk ───────────────────────────────────────────────────
async function main() {
  console.log('========================================');
  console.log('  ServFix — Database-migrering');
  console.log('  004-orders-add-updated-at');
  console.log('========================================');
  if (DRY_RUN) console.log('  MODE: DRY RUN (ingen endringer)');
  if (ONLY_TENANT) console.log(`  TENANT: kun "${ONLY_TENANT}"`);
  console.log('');

  const baseConfig = getBaseConfig();

  // 1. Hent tenants fra admin-databasen
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

  // 2. Kjør migrering per tenant
  for (const tenant of tenants) {
    console.log(`── Tenant: ${tenant.id} (${tenant.database_name}) ──`);

    if (DRY_RUN) {
      console.log('  [DRY RUN] SQL som ville blitt kjørt:');
      console.log('  STEG 1: ADD COLUMN updated_at (idempotent)');
      console.log(ADD_COLUMN_SQL);
      console.log('  STEG 2: BACKFILL updated_at = created_at');
      console.log(BACKFILL_SQL);
      results.push({ tenant: tenant.id, status: 'dry-run' });
      continue;
    }

    const pool = new Pool({ ...baseConfig, database: tenant.database_name });
    try {
      // STEG 1
      console.log('  🔧 Steg 1: Sjekker/legger til updated_at-kolonne...');
      await pool.query(ADD_COLUMN_SQL);
      console.log('  ✅ Steg 1 fullført');

      // STEG 2
      console.log('  📅 Steg 2: Bakfyller updated_at = created_at for eksisterende rader...');
      const backfill = await pool.query(BACKFILL_SQL);
      console.log(`  ✅ Steg 2 fullført (${backfill.rowCount} rader oppdatert)`);

      // Verifiser
      const verify = await pool.query(VERIFY_SQL);
      const v = verify.rows[0];
      const colOk = v.col_exists !== null;
      const noNulls = parseInt(v.null_count) === 0;

      if (colOk && noNulls) {
        console.log('  ✅ Verifisering OK');
        console.log(`      updated_at kolonne: ✅`);
        console.log(`      Rader med NULL: ${v.null_count} ✅`);
      } else {
        console.log('  ⚠️  Verifisering — noe mangler:');
        console.log(`      updated_at kolonne: ${colOk ? '✅' : '❌'}`);
        console.log(`      Rader med NULL: ${v.null_count} ${noNulls ? '✅' : '⚠️'}`);
      }

      results.push({ tenant: tenant.id, status: (colOk && noNulls) ? 'ok' : 'partial', details: v });
    } catch (err) {
      console.error(`  ❌ Feil: ${err.message}`);
      results.push({ tenant: tenant.id, status: 'error', error: err.message });
    } finally {
      await pool.end();
    }
    console.log('');
  }

  // 3. Oppsummering
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
