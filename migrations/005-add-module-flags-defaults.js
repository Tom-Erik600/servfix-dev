#!/usr/bin/env node

/**
 * Migrasjon: Legg til module_flags i settings.json for alle tenants (GCS)
 *
 * Bakgrunn: Trinn 2 introduserer modul-flagg per tenant i settings.json.
 * Eksisterende tenants har ikke en module_flags-blokk — denne migrasjonen
 * legger den til med alle flagg satt til false (sikker default).
 *
 * Idempotent: Hvis module_flags allerede finnes, røres ikke filen.
 *
 * Bruk:
 *   node migrations/005-add-module-flags-defaults.js              # Alle tenants
 *   node migrations/005-add-module-flags-defaults.js --tenant=airtech  # Kun én
 *   node migrations/005-add-module-flags-defaults.js --dry-run    # Vis hva som ville skje
 */

require('dotenv').config();
const { Pool } = require('pg');
const { Storage } = require('@google-cloud/storage');

// ── CLI-flagg ──────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const tenantFlag = args.find(a => a.startsWith('--tenant='));
const ONLY_TENANT = tenantFlag ? tenantFlag.split('=')[1] : null;

// ── Default module_flags ───────────────────────────────────────────
const DEFAULT_MODULE_FLAGS = {
  show_pool_technician: false,
  show_periode_tab: false,
  show_avvik_module: false,
  show_enkel_tab: false,
};

// ── GCS-oppsett (samme mønster som src/config/gcs.js) ─────────────
const bucketName = process.env.GCS_BUCKET_NAME;
if (!bucketName) {
  console.error('❌ GCS_BUCKET_NAME er ikke satt i miljøet');
  process.exit(1);
}

const storage = new Storage();
const bucket = storage.bucket(bucketName);

// ── DB-konfig (hent tenants fra servfix_admin) ─────────────────────
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

// ── GCS-hjelper: les settings.json for én tenant ──────────────────
async function loadSettings(tenantId) {
  const filePath = `tenants/${tenantId}/assets/settings.json`;
  const file = bucket.file(filePath);
  const [exists] = await file.exists();
  if (!exists) return null; // Filen finnes ikke
  const [contents] = await file.download();
  return JSON.parse(contents.toString());
}

// ── GCS-hjelper: skriv settings.json for én tenant ────────────────
async function saveSettings(tenantId, settings) {
  const filePath = `tenants/${tenantId}/assets/settings.json`;
  const file = bucket.file(filePath);
  await file.save(JSON.stringify(settings, null, 2), {
    metadata: { contentType: 'application/json' },
  });
}

// ── Hovedlogikk ───────────────────────────────────────────────────
async function main() {
  console.log('========================================');
  console.log('  ServFix — GCS-migrasjon');
  console.log('  005-add-module-flags-defaults');
  console.log('========================================');
  if (DRY_RUN) console.log('  MODE: DRY RUN (ingen endringer)');
  if (ONLY_TENANT) console.log(`  TENANT: kun "${ONLY_TENANT}"`);
  console.log(`  GCS bucket: ${bucketName}`);
  console.log('');

  // 1. Hent tenants fra servfix_admin
  const baseConfig = getBaseConfig();
  const adminPool = new Pool({ ...baseConfig, database: 'servfix_admin' });

  let tenants;
  try {
    let query = 'SELECT id FROM tenants WHERE is_active = true';
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

  // 2. Prosesser hver tenant
  for (const tenant of tenants) {
    const tenantId = tenant.id;
    console.log(`── Tenant: ${tenantId} ──`);

    try {
      const settings = await loadSettings(tenantId);

      if (settings === null) {
        console.log('  ⚠️  settings.json finnes ikke — hopper over');
        results.push({ tenant: tenantId, status: 'skipped', reason: 'no settings.json' });
        console.log('');
        continue;
      }

      if (settings.module_flags) {
        console.log('  ✅ module_flags finnes allerede — ingen endring');
        results.push({ tenant: tenantId, status: 'already_exists' });
        console.log('');
        continue;
      }

      if (DRY_RUN) {
        console.log('  [DRY RUN] Ville lagt til:');
        console.log('  ', JSON.stringify(DEFAULT_MODULE_FLAGS, null, 2).replace(/\n/g, '\n    '));
        results.push({ tenant: tenantId, status: 'dry-run' });
        console.log('');
        continue;
      }

      // Legg til module_flags og lagre
      settings.module_flags = { ...DEFAULT_MODULE_FLAGS };
      settings.lastUpdated = new Date().toISOString();
      await saveSettings(tenantId, settings);

      console.log('  ✅ module_flags lagt til og lagret');
      results.push({ tenant: tenantId, status: 'added' });
    } catch (err) {
      console.error(`  ❌ Feil: ${err.message}`);
      results.push({ tenant: tenantId, status: 'error', error: err.message });
    }
    console.log('');
  }

  // 3. Oppsummering
  console.log('========================================');
  console.log('  OPPSUMMERING');
  console.log('========================================');
  for (const r of results) {
    const icon = {
      added: '✅',
      already_exists: '✅',
      'dry-run': '🔍',
      skipped: '⚠️',
      error: '❌',
    }[r.status] || '?';
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
