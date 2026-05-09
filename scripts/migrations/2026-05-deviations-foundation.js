#!/usr/bin/env node

/**
 * Migrasjon: Foundation for avvikshåndtering (Fase 1)
 *
 * Oppretter:
 *   - deviations (persistent avvik-enhet med EXCLUDE-constraint)
 *   - deviation_observations (hver observasjon av avvik)
 *   - Utvider avvik_images med FK til deviations-modellen
 *   - updated_at-trigger på deviations
 *
 * Idempotent: kan kjøres flere ganger uten feil.
 *
 * Bruk:
 *   node scripts/migrations/2026-05-deviations-foundation.js airtechdev
 *   node scripts/migrations/2026-05-deviations-foundation.js airtechdev --dry-run
 *   node scripts/migrations/2026-05-deviations-foundation.js --all
 *   node scripts/migrations/2026-05-deviations-foundation.js --all --dry-run
 */

const path = require('path');

// dotenv kun utenfor Cloud Run
if (!process.env.K_SERVICE) {
  require('dotenv').config({ path: path.join(__dirname, '../../.env') });

  // Lokalt på Windows: bruk TCP via Cloud SQL Proxy, ikke Unix socket
  if (process.env.CLOUD_SQL_CONNECTION_NAME) {
    process.env.CLOUD_SQL_CONNECTION_NAME = '';
    process.env.DB_HOST = process.env.DB_HOST || '127.0.0.1';
    process.env.DB_PORT = process.env.DB_PORT || '5433';
    console.log(`🔧 Lokalt modus: bruker TCP ${process.env.DB_HOST}:${process.env.DB_PORT} (Cloud SQL Proxy)`);
  }
}

const db = require('../../src/config/database');

// Hvert statement kjøres separat for isolert feilhåndtering og tydelig logging
const SQL_STATEMENTS = [
  // =========================================================================
  // DEVIATIONS: Persistent avvik-enhet
  // =========================================================================
  `CREATE TABLE IF NOT EXISTS deviations (
    id                          SERIAL PRIMARY KEY,
    equipment_id                INTEGER NOT NULL REFERENCES equipment(id),
    checklist_item_id           VARCHAR(100) NOT NULL,
    checklist_item_label        TEXT,
    status                      VARCHAR(30) NOT NULL DEFAULT 'open',
    current_severity            VARCHAR(20),
    current_summary             TEXT,
    opened_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    opened_in_report_id         VARCHAR(50),
    assigned_to_user_id         VARCHAR(50),
    assigned_at                 TIMESTAMPTZ,
    deadline                    DATE,
    fixed_in_field_at           TIMESTAMPTZ,
    fixed_in_field_by           VARCHAR(50),
    fixed_in_field_note         TEXT,
    verified_at                 TIMESTAMPTZ,
    verified_by                 VARCHAR(50),
    closed_at                   TIMESTAMPTZ,
    closure_mode                VARCHAR(30),
    closure_comment             TEXT,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  // Status CHECK (drop+add for idempotens)
  `ALTER TABLE deviations DROP CONSTRAINT IF EXISTS deviations_status_check`,
  `ALTER TABLE deviations ADD CONSTRAINT deviations_status_check
    CHECK (status IN ('open', 'assigned', 'in_progress',
                      'fixed_pending_verification', 'closed'))`,

  // Severity CHECK
  `ALTER TABLE deviations DROP CONSTRAINT IF EXISTS deviations_severity_check`,
  `ALTER TABLE deviations ADD CONSTRAINT deviations_severity_check
    CHECK (current_severity IS NULL OR current_severity IN ('lav', 'medium', 'høy'))`,

  // Closure mode CHECK
  `ALTER TABLE deviations DROP CONSTRAINT IF EXISTS deviations_closure_mode_check`,
  `ALTER TABLE deviations ADD CONSTRAINT deviations_closure_mode_check
    CHECK (closure_mode IS NULL OR closure_mode IN
      ('fixed_on_visit', 'manual_close', 'accepted_by_customer', 'legacy_migrated'))`,

  // btree_gist trengs for EXCLUDE med likhet på ikke-range-typer
  `CREATE EXTENSION IF NOT EXISTS btree_gist`,

  // EXCLUDE-constraint: kun ett åpent avvik per (equipment, checklist_item)
  `ALTER TABLE deviations DROP CONSTRAINT IF EXISTS unique_open_deviation`,
  `ALTER TABLE deviations ADD CONSTRAINT unique_open_deviation
    EXCLUDE USING gist (
      equipment_id WITH =,
      checklist_item_id WITH =
    ) WHERE (status <> 'closed')`,

  `CREATE INDEX IF NOT EXISTS idx_deviations_equipment ON deviations(equipment_id)`,
  `CREATE INDEX IF NOT EXISTS idx_deviations_status ON deviations(status)`,
  `CREATE INDEX IF NOT EXISTS idx_deviations_assigned ON deviations(assigned_to_user_id)
    WHERE assigned_to_user_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_deviations_deadline ON deviations(deadline)
    WHERE deadline IS NOT NULL`,

  // =========================================================================
  // DEVIATION_OBSERVATIONS: Hver observasjon av et avvik
  // =========================================================================
  `CREATE TABLE IF NOT EXISTS deviation_observations (
    id                          SERIAL PRIMARY KEY,
    deviation_id                INTEGER NOT NULL REFERENCES deviations(id) ON DELETE CASCADE,
    service_report_id           VARCHAR(50) NOT NULL,
    observed_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    observed_by_user_id         VARCHAR(50),
    comment                     TEXT,
    severity                    VARCHAR(20),
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `ALTER TABLE deviation_observations
    DROP CONSTRAINT IF EXISTS deviation_observations_severity_check`,
  `ALTER TABLE deviation_observations ADD CONSTRAINT deviation_observations_severity_check
    CHECK (severity IS NULL OR severity IN ('lav', 'medium', 'høy'))`,

  `ALTER TABLE deviation_observations
    DROP CONSTRAINT IF EXISTS deviation_observations_unique`,
  `ALTER TABLE deviation_observations ADD CONSTRAINT deviation_observations_unique
    UNIQUE (service_report_id, deviation_id)`,

  `CREATE INDEX IF NOT EXISTS idx_obs_deviation ON deviation_observations(deviation_id)`,
  `CREATE INDEX IF NOT EXISTS idx_obs_report ON deviation_observations(service_report_id)`,

  // =========================================================================
  // AVVIK_IMAGES: Utvid med FK til deviations-modellen (begge nullable)
  // =========================================================================
  `ALTER TABLE avvik_images
    ADD COLUMN IF NOT EXISTS deviation_id INTEGER REFERENCES deviations(id),
    ADD COLUMN IF NOT EXISTS deviation_observation_id INTEGER REFERENCES deviation_observations(id)`,

  `CREATE INDEX IF NOT EXISTS idx_avvik_images_deviation
    ON avvik_images(deviation_id) WHERE deviation_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_avvik_images_observation
    ON avvik_images(deviation_observation_id) WHERE deviation_observation_id IS NOT NULL`,

  // =========================================================================
  // TRIGGER: Auto-oppdatering av updated_at på deviations
  // =========================================================================
  `CREATE OR REPLACE FUNCTION update_deviations_updated_at()
  RETURNS TRIGGER AS $$
  BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql`,

  `DROP TRIGGER IF EXISTS deviations_updated_at_trigger ON deviations`,
  `CREATE TRIGGER deviations_updated_at_trigger
    BEFORE UPDATE ON deviations
    FOR EACH ROW
    EXECUTE FUNCTION update_deviations_updated_at()`,
];

// Hent alle aktive tenants fra admin-DB (samme mønster som scripts/migrate-sja-photos.js)
async function getAllTenants() {
  const adminPool = await db.getPool('servfix_admin');
  const result = await adminPool.query(
    'SELECT id, database_name FROM tenants WHERE is_active = true ORDER BY id'
  );
  return result.rows;
}

// Slå opp én spesifikk tenant ved id
async function getTenantById(tenantId) {
  const adminPool = await db.getPool('servfix_admin');
  const result = await adminPool.query(
    'SELECT id, database_name FROM tenants WHERE id = $1',
    [tenantId]
  );
  if (result.rows.length === 0) {
    throw new Error(`Tenant '${tenantId}' ikke funnet i servfix_admin.tenants`);
  }
  return result.rows[0];
}

async function migrateTenant(tenantId, databaseName, dryRun = false) {
  console.log(`\n🏢 Tenant: ${tenantId} (database: ${databaseName})`);
  if (dryRun) console.log('   🔍 DRY RUN — ingen endringer');

  const pool = await db.getPool(databaseName);
  const results = { ok: 0, skipped: 0, failed: 0, errors: [] };

  for (const sql of SQL_STATEMENTS) {
    // Finn første ikke-tomme, ikke-kommentar-linje for logging
    const firstLine = sql.split('\n')
      .map(l => l.trim())
      .find(l => l && !l.startsWith('--')) || sql;
    const label = firstLine.substring(0, 80);

    if (dryRun) {
      console.log(`   [DRY-RUN] ${label}...`);
      results.ok++;
      continue;
    }

    try {
      await pool.query(sql);
      console.log(`   ✅ ${label}...`);
      results.ok++;
    } catch (err) {
      console.error(`   ❌ FEIL: ${err.message}`);
      console.error(`      SQL: ${label}...`);
      results.failed++;
      results.errors.push({ sql: label, error: err.message });
    }
  }

  if (results.failed > 0) {
    console.log(`\n   ⚠️  ${results.ok} ok, ${results.failed} feilet`);
    throw new Error(`Migrering feilet for tenant '${tenantId}' (${results.failed} feil)`);
  }

  console.log(`   ✅ Ferdig: ${results.ok} statements kjørt`);
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const all = args.includes('--all');
  const specificTenant = args.find(a => !a.startsWith('--'));

  console.log('=== DEVIATIONS FOUNDATION MIGRASJON ===');
  if (dryRun) console.log('MODE: DRY RUN (ingen endringer vil bli gjort)');
  console.log('');

  try {
    if (all) {
      const tenants = await getAllTenants();
      console.log(`📋 Fant ${tenants.length} aktive tenant(s):`);
      tenants.forEach(t => console.log(`   - ${t.id} → ${t.database_name}`));

      const summary = [];
      for (const t of tenants) {
        try {
          await migrateTenant(t.id, t.database_name, dryRun);
          summary.push({ tenant: t.id, status: dryRun ? 'dry-run' : 'ok' });
        } catch (err) {
          summary.push({ tenant: t.id, status: 'feilet', error: err.message });
        }
      }

      console.log('\n=== OPPSUMMERING ===');
      summary.forEach(r => {
        const icon = r.status === 'ok' ? '✅' : r.status === 'dry-run' ? '🔍' : '❌';
        console.log(`  ${icon} ${r.tenant}: ${r.status}${r.error ? ' — ' + r.error : ''}`);
      });

      const failed = summary.filter(r => r.status === 'feilet').length;
      process.exitCode = failed > 0 ? 1 : 0;

    } else if (specificTenant) {
      const t = await getTenantById(specificTenant);
      await migrateTenant(t.id, t.database_name, dryRun);
      console.log('\n✅ Migrering fullført');

    } else {
      console.error('❌ Bruk: node 2026-05-deviations-foundation.js <tenant-id> | --all [--dry-run]');
      process.exitCode = 1;
    }
  } catch (err) {
    console.error('\n❌ Fatal feil:', err.message);
    process.exitCode = 1;
  } finally {
    await db.closeAll();
  }
}

main();
