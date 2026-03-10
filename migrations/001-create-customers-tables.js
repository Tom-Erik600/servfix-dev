#!/usr/bin/env node

/**
 * Migrasjon: Opprett customers, customer_contacts, tenant_integrations
 * + legg til local_customer_id på orders og equipment.
 *
 * Bruk:
 *   node migrations/001-create-customers-tables.js                    # Alle tenants
 *   node migrations/001-create-customers-tables.js --tenant=airtech   # Kun én
 *   node migrations/001-create-customers-tables.js --dry-run          # Vis SQL, ikke kjør
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

// ── SQL-migrasjonen ───────────────────────────────────────────────
const MIGRATION_SQL = `
-- STEG 1: customers
CREATE TABLE IF NOT EXISTS customers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    organization_number VARCHAR(20),
    customer_number VARCHAR(50),
    physical_address TEXT,
    postal_address TEXT,
    phone VARCHAR(50),
    email VARCHAR(255),
    invoice_email VARCHAR(255),
    external_source VARCHAR(50),
    external_id VARCHAR(100),
    last_synced_at TIMESTAMP,
    notes TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_external ON customers(external_source, external_id);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);
CREATE INDEX IF NOT EXISTS idx_customers_active ON customers(is_active);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_customers_external_unique') THEN
        CREATE UNIQUE INDEX idx_customers_external_unique
            ON customers(external_source, external_id)
            WHERE external_id IS NOT NULL;
    END IF;
END$$;

-- STEG 2: customer_contacts
CREATE TABLE IF NOT EXISTS customer_contacts (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    role VARCHAR(100),
    is_report_recipient BOOLEAN DEFAULT false,
    notes TEXT,
    is_primary BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contacts_customer ON customer_contacts(customer_id);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_contacts_report') THEN
        CREATE INDEX idx_contacts_report ON customer_contacts(customer_id, is_report_recipient)
            WHERE is_report_recipient = true;
    END IF;
END$$;

-- STEG 3: tenant_integrations
CREATE TABLE IF NOT EXISTS tenant_integrations (
    id SERIAL PRIMARY KEY,
    tenant_id VARCHAR(50) NOT NULL,
    provider VARCHAR(50) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    config JSONB NOT NULL DEFAULT '{}',
    last_sync_at TIMESTAMP,
    sync_status VARCHAR(50),
    sync_error TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_integrations_tenant_provider') THEN
        CREATE UNIQUE INDEX idx_integrations_tenant_provider
            ON tenant_integrations(tenant_id, provider);
    END IF;
END$$;

-- STEG 4: local_customer_id på orders
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders' AND column_name = 'local_customer_id'
    ) THEN
        ALTER TABLE orders ADD COLUMN local_customer_id INTEGER REFERENCES customers(id);
        CREATE INDEX idx_orders_local_customer ON orders(local_customer_id);
    END IF;
END$$;

-- STEG 5: local_customer_id på equipment
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'equipment' AND column_name = 'local_customer_id'
    ) THEN
        ALTER TABLE equipment ADD COLUMN local_customer_id INTEGER REFERENCES customers(id);
        CREATE INDEX idx_equipment_local_customer ON equipment(local_customer_id);
    END IF;
END$$;
`;

// ── Verifiserings-SQL ─────────────────────────────────────────────
const VERIFY_SQL = `
SELECT
    (SELECT count(*) FROM information_schema.tables WHERE table_name = 'customers') as customers_ok,
    (SELECT count(*) FROM information_schema.tables WHERE table_name = 'customer_contacts') as contacts_ok,
    (SELECT count(*) FROM information_schema.tables WHERE table_name = 'tenant_integrations') as integrations_ok,
    (SELECT count(*) FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'local_customer_id') as orders_ok,
    (SELECT count(*) FROM information_schema.columns WHERE table_name = 'equipment' AND column_name = 'local_customer_id') as equipment_ok;
`;

// ── Hovedlogikk ───────────────────────────────────────────────────
async function main() {
  console.log('========================================');
  console.log('  ServFix — Database-migrering');
  console.log('  001-create-customers-tables');
  console.log('========================================');
  if (DRY_RUN) console.log('  MODE: DRY RUN (ingen endringer)');
  if (ONLY_TENANT) console.log(`  TENANT: kun "${ONLY_TENANT}"`);
  console.log('');

  const baseConfig = getBaseConfig();

  // 1. Koble til admin-databasen for å hente tenants
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
      console.log(MIGRATION_SQL);
      results.push({ tenant: tenant.id, status: 'dry-run' });
      continue;
    }

    const pool = new Pool({ ...baseConfig, database: tenant.database_name });
    try {
      await pool.query(MIGRATION_SQL);
      console.log('  ✅ Migrering fullført');

      // 3. Verifiser
      const verify = await pool.query(VERIFY_SQL);
      const v = verify.rows[0];
      const allOk = Object.values(v).every(val => parseInt(val) === 1);

      if (allOk) {
        console.log('  ✅ Verifisering OK — alle tabeller og kolonner opprettet');
      } else {
        console.log('  ⚠️  Verifisering — noe mangler:');
        console.log(`      customers: ${v.customers_ok === '1' ? '✅' : '❌'}`);
        console.log(`      customer_contacts: ${v.contacts_ok === '1' ? '✅' : '❌'}`);
        console.log(`      tenant_integrations: ${v.integrations_ok === '1' ? '✅' : '❌'}`);
        console.log(`      orders.local_customer_id: ${v.orders_ok === '1' ? '✅' : '❌'}`);
        console.log(`      equipment.local_customer_id: ${v.equipment_ok === '1' ? '✅' : '❌'}`);
      }

      results.push({ tenant: tenant.id, status: allOk ? 'ok' : 'partial', details: v });
    } catch (err) {
      console.error(`  ❌ Feil: ${err.message}`);
      results.push({ tenant: tenant.id, status: 'error', error: err.message });
    } finally {
      await pool.end();
    }
    console.log('');
  }

  // 4. Oppsummering
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
