#!/usr/bin/env node

/**
 * Migrasjon 002: Flytt tenant_integrations fra per-tenant DB → servfix_admin.
 *
 * Hva dette gjør:
 *   1. Fail-loud guard: if servfix_admin.tenant_integrations eksisterer med rader → ABORT.
 *   2. CREATE TABLE tenant_integrations i servfix_admin med config_version + trigger.
 *   3. For hver aktiv tenant-DB der tabellen finnes:
 *      - Verifiser 0 rader (safety net). Hvis rader > 0: kopier til admin med tenant_id.
 *      - DROP TABLE i tenant-DB.
 *   4. Oppretter lookup-index + updated_at-trigger i admin.
 *
 * Bruk:
 *   node migrations/002-move-tenant-integrations-to-admin.js            # Alle tenants
 *   node migrations/002-move-tenant-integrations-to-admin.js --dry-run  # Vis hva som ville skjedd
 *   node migrations/002-move-tenant-integrations-to-admin.js --tenant=airtech
 *
 * IDEMPOTENT:
 *   - Hvis admin-tabellen allerede finnes og har 0 rader: re-run er safe (CREATE IF NOT EXISTS).
 *   - Hvis admin-tabellen finnes med rader: ABORT (fail-loud guard).
 *   - Hvis tenant-tabellen allerede er droppet: skip og logg.
 *
 * PRE-FLIGHT KRAV (kjør manuelt før dette scriptet mot prod):
 *   - Verifiser at ingen tenant-DB har rader i tenant_integrations.
 *   - Forventet basert på empirisk sjekk 2026-05-08: alle miljøer har 0 rader.
 */

'use strict';

require('dotenv').config();
const { Pool } = require('pg');

// ── CLI-flagg ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const tenantFlag = args.find((a) => a.startsWith('--tenant='));
const ONLY_TENANT = tenantFlag ? tenantFlag.split('=')[1] : null;

// ── DB-konfig (mirrors src/config/database.js) ────────────────────────────
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
    port: parseInt(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  };
}

// ── SQL for ny admin-tabell ───────────────────────────────────────────────
const ADMIN_CREATE_SQL = `
CREATE TABLE IF NOT EXISTS tenant_integrations (
  id              SERIAL PRIMARY KEY,
  tenant_id       VARCHAR NOT NULL,
  provider        VARCHAR NOT NULL,
  is_active       BOOLEAN DEFAULT true,
  config          JSONB NOT NULL DEFAULT '{}'::jsonb,
  config_version  INTEGER NOT NULL DEFAULT 1,
  last_sync_at    TIMESTAMP,
  sync_status     VARCHAR,
  sync_error      TEXT,
  created_at      TIMESTAMP DEFAULT now(),
  updated_at      TIMESTAMP DEFAULT now(),
  CONSTRAINT uq_tenant_integrations_tenant_provider UNIQUE (tenant_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_tenant_integrations_lookup
  ON tenant_integrations (tenant_id, provider)
  WHERE is_active = true;

CREATE OR REPLACE FUNCTION trg_tenant_integrations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  IF NEW.config IS DISTINCT FROM OLD.config THEN
    NEW.config_version = OLD.config_version + 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_name = 'tenant_integrations_updated_at'
      AND event_object_table = 'tenant_integrations'
  ) THEN
    CREATE TRIGGER tenant_integrations_updated_at
      BEFORE UPDATE ON tenant_integrations
      FOR EACH ROW EXECUTE FUNCTION trg_tenant_integrations_updated_at();
  END IF;
END;
$$;
`;

async function main() {
  console.log('========================================');
  console.log('  ServFix – Database-migrering');
  console.log('  002-move-tenant-integrations-to-admin');
  console.log('========================================');
  if (DRY_RUN) console.log('  MODE: DRY RUN (ingen endringer)');
  if (ONLY_TENANT) console.log(`  TENANT: kun "${ONLY_TENANT}"`);
  console.log('');

  const baseConfig = getBaseConfig();

  // ── Steg 1: Koble til admin, hent tenants ─────────────────────────────
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
    console.log(`Fant ${tenants.length} aktiv(e) tenant(s) i servfix_admin.`);
  } catch (err) {
    console.error('❌ Kunne ikke koble til servfix_admin:', err.message);
    await adminPool.end().catch(() => {});
    process.exit(1);
  }

  if (tenants.length === 0) {
    console.error('❌ Ingen aktive tenants funnet' + (ONLY_TENANT ? ` med id="${ONLY_TENANT}"` : ''));
    await adminPool.end().catch(() => {});
    process.exit(1);
  }

  // ── Steg 2: Fail-loud guard — admin-tabellen finnes med rader ─────────
  try {
    const existsRes = await adminPool.query(
      `SELECT to_regclass('public.tenant_integrations') AS t`
    );
    if (existsRes.rows[0].t) {
      const countRes = await adminPool.query(
        `SELECT count(*) AS n FROM tenant_integrations`
      );
      const rowCount = parseInt(countRes.rows[0].n, 10);
      if (rowCount > 0) {
        console.error(
          `❌ ABORT: servfix_admin.tenant_integrations eksisterer allerede med ${rowCount} rader.` +
          '\n   Uventet tilstand — manuell undersøkelse kreves før migrasjonen kan kjøres.'
        );
        await adminPool.end().catch(() => {});
        process.exit(1);
      }
      console.log('ℹ️  servfix_admin.tenant_integrations finnes allerede (0 rader) — CREATE vil bruke IF NOT EXISTS.');
    }
  } catch (err) {
    console.error('❌ Feil ved guard-sjekk mot admin:', err.message);
    await adminPool.end().catch(() => {});
    process.exit(1);
  }

  // ── Steg 3: CREATE admin-tabell ───────────────────────────────────────
  if (DRY_RUN) {
    console.log('\n[DRY RUN] Ville kjørt i servfix_admin:');
    console.log(ADMIN_CREATE_SQL);
  } else {
    try {
      await adminPool.query(ADMIN_CREATE_SQL);
      console.log('✅ servfix_admin.tenant_integrations opprettet (med config_version + trigger).');
    } catch (err) {
      console.error('❌ Feil ved CREATE TABLE i admin:', err.message);
      await adminPool.end().catch(() => {});
      process.exit(1);
    }
  }

  // ── Steg 4: Per-tenant: kopier eventuelle rader + DROP TABLE ──────────
  const results = [];

  for (const tenant of tenants) {
    const { id: tenantId, database_name: dbName } = tenant;
    console.log(`\n── Tenant: ${tenantId} (${dbName}) ──`);

    const tenantPool = new Pool({ ...baseConfig, database: dbName });
    try {
      // Sjekk om tabellen finnes i tenant-DB
      const existsRes = await tenantPool.query(
        `SELECT to_regclass('public.tenant_integrations') AS t`
      );
      if (!existsRes.rows[0].t) {
        console.log(`  ℹ️  Tabellen finnes ikke i ${dbName} — ingenting å gjøre.`);
        results.push({ tenant: tenantId, db: dbName, status: 'skipped-not-found' });
        continue;
      }

      // Sjekk rader — safety net
      const countRes = await tenantPool.query(
        `SELECT count(*) AS n FROM tenant_integrations`
      );
      const rowCount = parseInt(countRes.rows[0].n, 10);

      if (rowCount > 0) {
        // Empirisk uventet — kopier til admin så ingen data går tapt
        console.warn(
          `  ⚠️  UVENTET: ${dbName}.tenant_integrations har ${rowCount} rad(er). Kopierer til admin før DROP.`
        );
        if (!DRY_RUN) {
          const rowsRes = await tenantPool.query(
            `SELECT provider, is_active, config, last_sync_at, sync_status, sync_error, created_at
             FROM tenant_integrations`
          );
          for (const row of rowsRes.rows) {
            await adminPool.query(
              `INSERT INTO tenant_integrations
                 (tenant_id, provider, is_active, config, last_sync_at, sync_status, sync_error, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
               ON CONFLICT (tenant_id, provider) DO NOTHING`,
              [
                tenantId,
                row.provider,
                row.is_active,
                row.config,
                row.last_sync_at,
                row.sync_status,
                row.sync_error,
                row.created_at,
              ]
            );
          }
          console.log(`  ✅ ${rowCount} rad(er) kopiert til servfix_admin.tenant_integrations.`);
        } else {
          console.log(`  [DRY RUN] Ville kopiert ${rowCount} rad(er) til admin.`);
        }
      }

      // DROP TABLE + SEQUENCE i tenant-DB
      if (DRY_RUN) {
        console.log(`  [DRY RUN] Ville kjørt: DROP TABLE IF EXISTS tenant_integrations; DROP SEQUENCE IF EXISTS tenant_integrations_id_seq;`);
        results.push({ tenant: tenantId, db: dbName, status: 'dry-run', rows: rowCount });
      } else {
        await tenantPool.query(`DROP TABLE IF EXISTS tenant_integrations`);
        await tenantPool.query(`DROP SEQUENCE IF EXISTS tenant_integrations_id_seq`);
        console.log(`  ✅ tenant_integrations + sequence droppet fra ${dbName}.`);
        results.push({ tenant: tenantId, db: dbName, status: 'dropped', rows: rowCount });
      }
    } catch (err) {
      console.error(`  ❌ Feil for tenant ${tenantId} (${dbName}):`, err.message);
      results.push({ tenant: tenantId, db: dbName, status: 'error', error: err.message });
    } finally {
      await tenantPool.end().catch(() => {});
    }
  }

  await adminPool.end().catch(() => {});

  // ── Oppsummering ──────────────────────────────────────────────────────
  console.log('\n========================================');
  console.log('  Oppsummering');
  console.log('========================================');
  results.forEach((r) => {
    const icon = r.status === 'error' ? '❌' : r.status === 'skipped-not-found' ? 'ℹ️ ' : '✅';
    console.log(`  ${icon} ${r.tenant} (${r.db}): ${r.status}${r.rows != null ? ` (${r.rows} rader)` : ''}${r.error ? ` — ${r.error}` : ''}`);
  });

  const errors = results.filter((r) => r.status === 'error');
  if (errors.length > 0) {
    console.error(`\n❌ ${errors.length} tenant(s) feilet. Se feil over.`);
    process.exit(1);
  }

  console.log('\n✅ Migrering fullført.');
}

main().catch((err) => {
  console.error('❌ Uventet feil:', err);
  process.exit(1);
});
