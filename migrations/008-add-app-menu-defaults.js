#!/usr/bin/env node

/**
 * Migrasjon 008: Legg til app_menu defaults i tenant settings.json (GCS)
 *
 * App-menyen styrer synlighet og tittel for menyvalgene på teknikerens home.html.
 * Migrasjonen er idempotent og fyller bare inn manglende nøkler/felter.
 *
 * Bruk:
 *   node migrations/008-add-app-menu-defaults.js
 *   node migrations/008-add-app-menu-defaults.js --tenant=airtechdev
 *   node migrations/008-add-app-menu-defaults.js --dry-run
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
  console.error('GCS_BUCKET_NAME er ikke satt i miljøet');
  process.exit(1);
}

const storage = new Storage();
const bucket = storage.bucket(bucketName);

const DEFAULT_APP_MENU = {
  planned_service: { visible: true, title: 'Planlagte service' },
  planlegg_oppdrag: { visible: true, title: 'Planlegg oppdrag' },
  hasteordre: { visible: true, title: 'Opprett hasteordre' },
  search_orders: { visible: true, title: 'Søk ordre' },
  hms: { visible: true, title: 'HMS' }
};

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

function mergeAppMenu(current) {
  const existing = current || {};
  return Object.keys(DEFAULT_APP_MENU).reduce((acc, key) => {
    acc[key] = {
      ...DEFAULT_APP_MENU[key],
      ...(existing[key] || {})
    };
    return acc;
  }, {});
}

function hasMissingDefaults(current) {
  if (!current) return true;
  return Object.keys(DEFAULT_APP_MENU).some(key => {
    const item = current[key];
    return !item || typeof item.visible !== 'boolean' || !item.title;
  });
}

async function main() {
  console.log('========================================');
  console.log('  ServFix — GCS-migrasjon');
  console.log('  008-add-app-menu-defaults');
  console.log('========================================');
  if (DRY_RUN) console.log('  MODE: DRY RUN (ingen endringer)');
  if (ONLY_TENANT) console.log(`  TENANT: kun "${ONLY_TENANT}"`);
  console.log(`  GCS bucket: ${bucketName}`);
  console.log('');

  const adminPool = new Pool({ ...getBaseConfig(), database: 'servfix_admin' });
  let tenants;
  try {
    let query = 'SELECT id FROM tenants WHERE is_active = true';
    const params = [];
    if (ONLY_TENANT) { query += ' AND id = $1'; params.push(ONLY_TENANT); }
    query += ' ORDER BY id';
    tenants = (await adminPool.query(query, params)).rows;
  } catch (err) {
    console.error('Kunne ikke koble til servfix_admin:', err.message);
    await adminPool.end();
    process.exit(1);
  }
  await adminPool.end();

  if (tenants.length === 0) {
    console.error('Ingen aktive tenants funnet');
    process.exit(1);
  }

  const results = [];
  for (const tenant of tenants) {
    const tid = tenant.id;
    console.log(`-- Tenant: ${tid} --`);
    try {
      const settings = await loadSettings(tid);
      if (!settings) {
        console.log('  settings.json finnes ikke - hopper over');
        results.push({ tenant: tid, status: 'skipped' });
        continue;
      }

      if (!hasMissingDefaults(settings.app_menu)) {
        console.log('  Allerede oppdatert - ingen endring');
        results.push({ tenant: tid, status: 'already_exists' });
        continue;
      }

      const nextAppMenu = mergeAppMenu(settings.app_menu);
      if (DRY_RUN) {
        console.log('  [DRY RUN] Ville lagt til app_menu defaults');
        results.push({ tenant: tid, status: 'dry-run' });
        continue;
      }

      settings.app_menu = nextAppMenu;
      settings.lastUpdated = new Date().toISOString();
      await saveSettings(tid, settings);
      console.log('  app_menu defaults lagret');
      results.push({ tenant: tid, status: 'added' });
    } catch (err) {
      console.error(`  Feil: ${err.message}`);
      results.push({ tenant: tid, status: 'error', error: err.message });
    }
  }

  console.log('');
  console.log('Oppsummering:');
  for (const r of results) {
    console.log(`  ${r.tenant}: ${r.status}${r.error ? ' - ' + r.error : ''}`);
  }

  process.exit(results.some(r => r.status === 'error') ? 1 : 0);
}

main().catch(err => { console.error('Fatal feil:', err); process.exit(1); });
