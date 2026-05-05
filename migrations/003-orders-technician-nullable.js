#!/usr/bin/env node

/**
 * Migrasjon: Gjør orders.technician_id nullable + legg til partiell indeks
 *
 * Bakgrunn: Pool-tekniker-modell krever at ordre kan opprettes uten tildelt
 * tekniker. Kolonnen er nullable i schema-baseline, men eldre prod-DBer kan
 * ha NOT NULL-constraint fra en tidligere versjon.
 *
 * STEG 1: DROP NOT NULL på technician_id (no-op hvis allerede nullable)
 * STEG 2: Opprett partiell indeks idx_orders_available for ytelse på
 *         "Ledige oppdrag"-spørringer (WHERE technician_id IS NULL)
 *
 * Bruk:
 *   node migrations/003-orders-technician-nullable.js                    # Alle tenants
 *   node migrations/003-orders-technician-nullable.js --tenant=airtech   # Kun én
 *   node migrations/003-orders-technician-nullable.js --dry-run          # Vis SQL, ikke kjør
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

// ── STEG 1: Drop NOT NULL hvis satt ───────────────────────────────
const DROP_NOT_NULL_SQL = `
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders'
      AND column_name = 'technician_id'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE orders ALTER COLUMN technician_id DROP NOT NULL;
    RAISE NOTICE 'technician_id: NOT NULL droppet';
  ELSE
    RAISE NOTICE 'technician_id: allerede nullable, ingen endring';
  END IF;
END$$;
`;

// ── STEG 2: Partiell indeks for ledige oppdrag ────────────────────
// NB: Separate databaser per tenant — ingen tenant_id-kolonne i orders
const CREATE_INDEX_SQL = `
CREATE INDEX IF NOT EXISTS idx_orders_available
  ON orders (scheduled_date)
  WHERE technician_id IS NULL;
`;

// ── Verifiserings-SQL ─────────────────────────────────────────────
const VERIFY_SQL = `
SELECT
  (SELECT is_nullable FROM information_schema.columns
   WHERE table_name = 'orders' AND column_name = 'technician_id') AS is_nullable,
  (SELECT COUNT(*) FROM pg_indexes
   WHERE indexname = 'idx_orders_available') AS index_ok;
`;

// ── Hovedlogikk ───────────────────────────────────────────────────
async function main() {
  console.log('========================================');
  console.log('  ServFix — Database-migrering');
  console.log('  003-orders-technician-nullable');
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
      console.log('  STEG 1: DROP NOT NULL');
      console.log(DROP_NOT_NULL_SQL);
      console.log('  STEG 2: CREATE INDEX');
      console.log(CREATE_INDEX_SQL);
      results.push({ tenant: tenant.id, status: 'dry-run' });
      continue;
    }

    const pool = new Pool({ ...baseConfig, database: tenant.database_name });
    try {
      // STEG 1
      console.log('  🔧 Steg 1: Sjekker NOT NULL-constraint på technician_id...');
      await pool.query(DROP_NOT_NULL_SQL);
      console.log('  ✅ Steg 1 fullført');

      // STEG 2
      console.log('  📇 Steg 2: Oppretter partiell indeks idx_orders_available...');
      await pool.query(CREATE_INDEX_SQL);
      console.log('  ✅ Steg 2 fullført');

      // Verifiser
      const verify = await pool.query(VERIFY_SQL);
      const v = verify.rows[0];
      const nullableOk = v.is_nullable === 'YES';
      const indexOk = parseInt(v.index_ok) === 1;

      if (nullableOk && indexOk) {
        console.log('  ✅ Verifisering OK');
        console.log(`      technician_id nullable: ✅`);
        console.log(`      idx_orders_available:   ✅`);
      } else {
        console.log('  ⚠️  Verifisering — noe mangler:');
        console.log(`      technician_id nullable: ${nullableOk ? '✅' : '❌'} (verdi: ${v.is_nullable})`);
        console.log(`      idx_orders_available:   ${indexOk ? '✅' : '❌'}`);
      }

      results.push({ tenant: tenant.id, status: (nullableOk && indexOk) ? 'ok' : 'partial', details: v });
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
