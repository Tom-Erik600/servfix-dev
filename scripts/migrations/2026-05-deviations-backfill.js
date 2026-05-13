// scripts/migrations/2026-05-deviations-backfill.js
//
// Backfill-script for tenants som aktiverer deviations-modulen og har
// eksisterende avvik-data i avvik_images fra FØR fase 2 var aktiv.
//
// ⚠️  IKKE kjør dette mot Air-Tech (airtechdev/airtechtest/airtech).
// ⚠️  IKKE kjør dette mot Varingskollen — de har ingen historiske data å backfille.
// ⚠️  Skriptet er for fremtidige tenants som migrerer fra et annet system.
//
// Bruk:
//   node scripts/migrations/2026-05-deviations-backfill.js <tenant-id> [--dry-run]
//
// Idempotens:
//   - Filtrerer på ai.deviation_id IS NULL → hopper over allerede backfillede bilder
//   - ON CONFLICT på (service_report_id, deviation_id) i deviation_observations
//   - INSERT med ON CONFLICT DO NOTHING på deviations (via unique_open_deviation
//     er det ikke mulig å ha duplikat for lukket — vi bruker en temp unique index)
//   - Kan kjøres flere ganger uten å duplikere data
//
// Logikk:
//   1. Finn alle unike (equipment_id, checklist_item_id)-par fra avvik_images
//      der deviation_id ennå ikke er satt.
//   2. For hvert par: opprett én deviation med status='closed',
//      closure_mode='legacy_migrated', closed_at = nyeste rapport-dato.
//   3. For hver rapport som hadde avvik på dette punktet: opprett observation.
//   4. Oppdater avvik_images med deviation_id og deviation_observation_id.

'use strict';

const path  = require('path');
const db    = require(path.resolve(__dirname, '../../src/config/database'));

// ---------------------------------------------------------------------------
// Kjernefunksjon for én tenant
// ---------------------------------------------------------------------------

async function backfillTenant(tenantId, databaseName, dryRun) {
  console.log(`\n🏢 Tenant: ${tenantId} (database: ${databaseName})`);
  if (dryRun) console.log('   🔍 DRY RUN — ingen endringer');

  const pool = await db.getPool(databaseName);
  const summary = { deviationsCreated: 0, observationsCreated: 0, imagesLinked: 0, skipped: 0 };

  // 1. Finn alle unike (equipment_id, checklist_item_id) der bilder ikke er backfillede.
  //    Vi joiner via service_reports for å hente equipment_id (avvik_images lagrer ikke
  //    equipment_id direkte — det gjøres via service_report → order → equipment).
  //
  //    Noen service_reports.equipment_id er VARCHAR; vi caster til INTEGER her.
  //    Se teknisk-gjeld-notat i deviationsService.js.
  const pairsResult = await pool.query(`
    SELECT
      sr.equipment_id::integer    AS equipment_id,
      ai.checklist_item_id        AS checklist_item_id,
      MAX(sr.created_at)          AS last_seen_at,
      COUNT(DISTINCT sr.id)       AS report_count
    FROM avvik_images ai
    JOIN service_reports sr ON sr.id = ai.service_report_id
    WHERE ai.deviation_id IS NULL
      AND ai.checklist_item_id IS NOT NULL
      AND sr.equipment_id ~ '^[0-9]+$'   -- filtrer ut evt. ikke-numeriske equipment_id-er
    GROUP BY sr.equipment_id::integer, ai.checklist_item_id
    ORDER BY sr.equipment_id::integer, ai.checklist_item_id
  `);

  console.log(`   📋 Fant ${pairsResult.rows.length} unik(e) (equipment, item)-par å backfille`);

  for (const pair of pairsResult.rows) {
    const { equipment_id, checklist_item_id, last_seen_at } = pair;

    // 2. Opprett deviation
    let deviationId;
    if (dryRun) {
      console.log(`   [DRY-RUN] Ville opprettet deviation: equipment=${equipment_id}, item=${checklist_item_id}`);
      summary.deviationsCreated++;
    } else {
      // INSERT med ON CONFLICT — hvis samme par allerede har en lukket deviation fra
      // en tidligere kjøring, la den stå (vi linker observasjoner til den i stedet).
      const deviationResult = await pool.query(`
        INSERT INTO deviations
          (equipment_id, checklist_item_id, checklist_item_label,
           status, closure_mode, closed_at,
           current_severity, current_summary, opened_in_report_id)
        SELECT
          $1, $2,
          COALESCE(ct.template_data->'checklistItems'->idx->'label', $2::jsonb)::text,
          'closed', 'legacy_migrated', $3,
          'medium', 'Historisk avvik (backfill)', NULL
        FROM (SELECT 0) dummy
        LEFT JOIN LATERAL (
          SELECT ct2.template_data, generate_subscripts(ct2.template_data->'checklistItems', 1) - 1 AS idx
          FROM equipment e2
          JOIN checklist_templates ct2 ON ct2.equipment_type = e2.systemtype
          WHERE e2.id = $1
          LIMIT 1
        ) ct ON TRUE
        ON CONFLICT DO NOTHING
        RETURNING id
      `, [equipment_id, checklist_item_id, last_seen_at]);

      if (deviationResult.rows.length === 0) {
        // Allerede eksisterer — hent eksisterende
        const existing = await pool.query(
          `SELECT id FROM deviations
           WHERE equipment_id = $1 AND checklist_item_id = $2
           ORDER BY created_at DESC LIMIT 1`,
          [equipment_id, checklist_item_id]
        );
        if (existing.rows.length === 0) {
          console.warn(`   ⚠️ Kunne ikke opprette eller finne deviation for equipment=${equipment_id}, item=${checklist_item_id} — hopper over`);
          summary.skipped++;
          continue;
        }
        deviationId = existing.rows[0].id;
        summary.skipped++; // Allerede backfillet
      } else {
        deviationId = deviationResult.rows[0].id;
        summary.deviationsCreated++;
      }
    }

    // 3. Opprett observations for alle rapporter som hadde avvik på dette punktet
    if (!dryRun && deviationId) {
      const reportsResult = await pool.query(`
        SELECT DISTINCT ai.service_report_id, sr.created_at, sr.technician_id
        FROM avvik_images ai
        JOIN service_reports sr ON sr.id = ai.service_report_id
        WHERE ai.checklist_item_id = $1
          AND sr.equipment_id::integer = $2
        ORDER BY sr.created_at
      `, [checklist_item_id, equipment_id]);

      for (const rpt of reportsResult.rows) {
        await pool.query(`
          INSERT INTO deviation_observations
            (deviation_id, service_report_id, observed_by_user_id, comment, severity)
          VALUES ($1, $2, $3, 'Historisk avvik (backfill)', 'medium')
          ON CONFLICT (service_report_id, deviation_id) DO NOTHING
        `, [deviationId, rpt.service_report_id, rpt.technician_id]);
        summary.observationsCreated++;
      }

      // 4. Link avvik_images til deviation og observation
      const linkResult = await pool.query(`
        UPDATE avvik_images ai
        SET deviation_id             = $1,
            deviation_observation_id = obs.id
        FROM deviation_observations obs
        WHERE obs.deviation_id       = $1
          AND obs.service_report_id  = ai.service_report_id
          AND ai.checklist_item_id   = $2
          AND ai.deviation_id IS NULL
        RETURNING ai.id
      `, [deviationId, checklist_item_id]);
      summary.imagesLinked += linkResult.rows.length;
    } else if (dryRun) {
      summary.observationsCreated += Number(pair.report_count);
    }
  }

  console.log(`\n   ✅ Backfill ferdig for ${tenantId}:`);
  console.log(`      deviations opprettet: ${summary.deviationsCreated}`);
  console.log(`      observations opprettet: ${summary.observationsCreated}`);
  console.log(`      bilder linket: ${summary.imagesLinked}`);
  if (summary.skipped > 0) {
    console.log(`      allerede backfillet (hoppet over): ${summary.skipped}`);
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Admin-DB helpers (samme mønster som fase 1-migreringen)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const PROTECTED_TENANTS = ['airtech', 'airtechdev', 'airtechtest'];

async function main() {
  const args         = process.argv.slice(2);
  const dryRun       = args.includes('--dry-run');
  const tenantId     = args.find(a => !a.startsWith('--'));

  console.log('=== DEVIATIONS BACKFILL ===');
  if (dryRun) console.log('MODE: DRY RUN (ingen endringer)');
  console.log('');

  if (!tenantId) {
    console.error('❌ Bruk: node 2026-05-deviations-backfill.js <tenant-id> [--dry-run]');
    console.error('');
    console.error('   Eksempel: node 2026-05-deviations-backfill.js varingtest --dry-run');
    console.error('');
    console.error('   ⚠️  Kjør ALDRI mot Air-Tech-tenants:', PROTECTED_TENANTS.join(', '));
    process.exitCode = 1;
    return;
  }

  // Beskyttelse mot utilsiktet kjøring mot Air-Tech
  if (PROTECTED_TENANTS.includes(tenantId)) {
    console.error(`❌ Tennant '${tenantId}' er en beskyttet Air-Tech-tenant.`);
    console.error('   Backfill skal ikke kjøres mot Air-Tech — avvikshåndteringsmodulen er av for dem.');
    process.exitCode = 1;
    return;
  }

  try {
    const tenant = await getTenantById(tenantId);
    await backfillTenant(tenant.id, tenant.database_name, dryRun);
    console.log('\n✅ Backfill fullført');
  } catch (err) {
    console.error('\n❌ Fatal feil:', err.message);
    process.exitCode = 1;
  } finally {
    await db.closeAll();
  }
}

main();
