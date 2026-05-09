#!/usr/bin/env node

/**
 * Migrasjon: Opprett recurring_orders-tabell for periode-fanen (Trinn 4)
 *
 * Bakgrunn: Trinn 4 introduserer en "Periode"-fane i admin-planleggeren der
 * admin kan definere en regel (kunde + anlegg + frekvens + dato-intervall) og
 * generere serviceoppdrag for hele perioden i én operasjon.
 *
 * Tabellen lagres i hver tenant-database. orders-tabellen røres IKKE.
 *
 * Idempotent: Bruker IF NOT EXISTS for både tabell og indekser.
 *
 * Bruk:
 *   node migrations/006-create-recurring-orders.js                      # Alle tenants
 *   node migrations/006-create-recurring-orders.js --tenant=airtechdev  # Kun én
 *   node migrations/006-create-recurring-orders.js --dry-run            # Vis SQL
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

// ── SQL: opprett tabell + indekser idempotent ─────────────────────
const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS recurring_orders (
  id              SERIAL PRIMARY KEY,
  customer_id     INTEGER NOT NULL,
  customer_name   VARCHAR(255) NOT NULL,
  technician_id   VARCHAR(255) REFERENCES technicians(id) ON DELETE SET NULL,
  equipment_ids   JSONB NOT NULL DEFAULT '[]'::jsonb,
  description     TEXT,
  service_type    VARCHAR(100) DEFAULT 'Generell service',
  service_address_street       VARCHAR(255),
  service_address_postal_code  VARCHAR(20),
  service_address_city         VARCHAR(100),

  start_date      DATE NOT NULL,
  end_date        DATE NOT NULL,
  frequency_type  VARCHAR(20) NOT NULL CHECK (frequency_type IN
                    ('daily','weekly','monthly','yearly','every_x_days','weekdays')),
  frequency_value INTEGER,
  weekdays        INTEGER[],
  scheduled_time  TIME,

  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  last_generated_at TIMESTAMPTZ,
  generated_count INTEGER NOT NULL DEFAULT 0,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_recurring_dates CHECK (end_date >= start_date)
);
`;

const CREATE_INDEX_CUSTOMER_SQL = `
CREATE INDEX IF NOT EXISTS idx_recurring_orders_customer
  ON recurring_orders(customer_id);
`;

const CREATE_INDEX_ACTIVE_SQL = `
CREATE INDEX IF NOT EXISTS idx_recurring_orders_active
  ON recurring_orders(is_active);
`;

// ── Verifisering ──────────────────────────────────────────────────
const VERIFY_SQL = `
SELECT
  EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'recurring_orders'
  ) AS table_exists,
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_name = 'recurring_orders') AS column_count;
`;

// ── Hovedlogikk ───────────────────────────────────────────────────
async function main() {
  console.log('========================================');
  console.log('  ServFix — Database-migrering');
  console.log('  006-create-recurring-orders');
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
      console.log('  STEG 1: CREATE TABLE recurring_orders');
      console.log(CREATE_TABLE_SQL);
      console.log('  STEG 2: CREATE INDEX idx_recurring_orders_customer');
      console.log(CREATE_INDEX_CUSTOMER_SQL);
      console.log('  STEG 3: CREATE INDEX idx_recurring_orders_active');
      console.log(CREATE_INDEX_ACTIVE_SQL);
      results.push({ tenant: tenant.id, status: 'dry-run' });
      continue;
    }

    const pool = new Pool({ ...baseConfig, database: tenant.database_name });
    try {
      console.log('  🔧 Steg 1: CREATE TABLE recurring_orders (idempotent)...');
      await pool.query(CREATE_TABLE_SQL);
      console.log('  ✅ Steg 1 fullført');

      console.log('  🔧 Steg 2: CREATE INDEX idx_recurring_orders_customer...');
      await pool.query(CREATE_INDEX_CUSTOMER_SQL);
      console.log('  ✅ Steg 2 fullført');

      console.log('  🔧 Steg 3: CREATE INDEX idx_recurring_orders_active...');
      await pool.query(CREATE_INDEX_ACTIVE_SQL);
      console.log('  ✅ Steg 3 fullført');

      // Verifiser
      const verify = await pool.query(VERIFY_SQL);
      const v = verify.rows[0];
      const tableOk = v.table_exists === true;
      const expectedColumns = 19; // se schema over
      const colCountOk = parseInt(v.column_count) >= expectedColumns;

      if (tableOk && colCountOk) {
        console.log('  ✅ Verifisering OK');
        console.log(`      Tabell finnes: ✅`);
        console.log(`      Kolonneantall: ${v.column_count} ✅`);
      } else {
        console.log('  ⚠️  Verifisering — noe mangler:');
        console.log(`      Tabell finnes: ${tableOk ? '✅' : '❌'}`);
        console.log(`      Kolonneantall: ${v.column_count} ${colCountOk ? '✅' : '❌ (forventet ≥' + expectedColumns + ')'}`);
      }

      results.push({ tenant: tenant.id, status: (tableOk && colCountOk) ? 'ok' : 'partial', details: v });
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
