#!/usr/bin/env node

/**
 * Migrasjon 007: Legg til show_avansert_tab + default_tab i module_flags (GCS)
 *
 * Bakgrunn: Trinn 4b introduserer tre planlegger-faner (Enkel, Avansert, Periode).
 * Avansert er det eksisterende standardoppsettet, og skal være aktivert som
 * default for alle eksisterende tenants.
 *
 * Idempotent: Legger bare til nøklene hvis de mangler; rører ikke eksisterende verdier.
 *
 * Bruk:
 *   node migrations/007-add-avansert-tab-defaults.js              # Alle tenants
 *   node migrations/007-add-avansert-tab-defaults.js --tenant=airtechdev
 *   node migrations/007-add-avansert-tab-defaults.js --dry-run
 */

require('dotenv').config();
const { Pool } = require('pg');
const { Storage } = require('@google-cloud/storage');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const tenantFlag = args.find(a => a.startsWith('--tenant='));
const ONLY_TENANT = tenantFlag ? tenantFlag.split('=')[1] : null;

const bucketName = process.env.GCS_BUCKET_NAME;
if (!bucketName) {
  console.error('❌ GCS_BUCKET_NAME er ikke satt i miljøet');
  process.exit(1);
}

const storage = new Storage();
const bucket = storage.bucket(bucketName);

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

async function loadSettings(tenantId) {
  const file = bucket.file(`tenants/${tenantId}/assets/settings.json`);
  const [exists] = await file.exists();
  if (!exists) return null;
  const [contents] = await file.download();
  return JSON.parse(contents.toString());
}

async function saveSettings(tenantId, settings) {
  const file = bucket.file(`tenants/${tenantId}/assets/settings.json`);
  await file.save(JSON.stringify(settings, null, 2), {
    metadata: { contentType: 'application/json' },
  });
}

async function main() {
  console.log('========================================');
  console.log('  ServFix — GCS-migrasjon');
  console.log('  007-add-avansert-tab-defaults');
  console.log('========================================');
  if (DRY_RUN) console.log('  MODE: DRY RUN (ingen endringer)');
  if (ONLY_TENANT) console.log(`  TENANT: kun "${ONLY_TENANT}"`);
  console.log(`  GCS bucket: ${bucketName}`);
  console.log('');

  const baseConfig = getBaseConfig();
  const adminPool = new Pool({ ...baseConfig, database: 'servfix_admin' });

  let tenants;
  try {
    let query = 'SELECT id FROM tenants WHERE is_active = true';
    const params = [];
    if (ONLY_TENANT) { query += ' AND id = $1'; params.push(ONLY_TENANT); }
    query += ' ORDER BY id';
    tenants = (await adminPool.query(query, params)).rows;
  } catch (err) {
    console.error('❌ Kunne ikke koble til servfix_admin:', err.message);
    await adminPool.end();
    process.exit(1);
  }
  await adminPool.end();

  if (tenants.length === 0) {
    console.error('❌ Ingen aktive tenants funnet');
    process.exit(1);
  }

  console.log(`Fant ${tenants.length} tenant(s):\n`);
  const results = [];

  for (const tenant of tenants) {
    const tid = tenant.id;
    console.log(`── Tenant: ${tid} ──`);

    try {
      const settings = await loadSettings(tid);

      if (!settings) {
        console.log('  ⚠️  settings.json finnes ikke — hopper over');
        results.push({ tenant: tid, status: 'skipped' });
        console.log('');
        continue;
      }

      if (!settings.module_flags) {
        console.log('  ⚠️  module_flags mangler — hopper over (kjør 005 først)');
        results.push({ tenant: tid, status: 'skipped', reason: 'no module_flags' });
        console.log('');
        continue;
      }

      const flags = settings.module_flags;
      const needsAvansert = !('show_avansert_tab' in flags);
      const needsDefault = !('default_tab' in flags);

      if (!needsAvansert && !needsDefault) {
        console.log('  ✅ Allerede oppdatert — ingen endring');
        results.push({ tenant: tid, status: 'already_exists' });
        console.log('');
        continue;
      }

      const patch = {};
      if (needsAvansert) patch.show_avansert_tab = true;
      if (needsDefault)  patch.default_tab = 'avansert';

      if (DRY_RUN) {
        console.log('  [DRY RUN] Ville lagt til:', JSON.stringify(patch));
        results.push({ tenant: tid, status: 'dry-run' });
        console.log('');
        continue;
      }

      settings.module_flags = { ...flags, ...patch };
      settings.lastUpdated = new Date().toISOString();
      await saveSettings(tid, settings);

      console.log(`  ✅ Lagt til: ${JSON.stringify(patch)}`);
      results.push({ tenant: tid, status: 'added' });
    } catch (err) {
      console.error(`  ❌ Feil: ${err.message}`);
      results.push({ tenant: tid, status: 'error', error: err.message });
    }
    console.log('');
  }

  console.log('========================================');
  console.log('  OPPSUMMERING');
  console.log('========================================');
  for (const r of results) {
    const icon = { added: '✅', already_exists: '✅', 'dry-run': '🔍', skipped: '⚠️', error: '❌' }[r.status] || '?';
    console.log(`  ${icon} ${r.tenant}: ${r.status}${r.error ? ' — ' + r.error : ''}`);
  }
  console.log('');

  process.exit(results.some(r => r.status === 'error') ? 1 : 0);
}

main().catch(err => { console.error('Fatal feil:', err); process.exit(1); });
