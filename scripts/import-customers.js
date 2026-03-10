/**
 * Import-script: Henter kunder fra Tripletex og lagrer i lokal customers-tabell.
 *
 * Bruk:
 *   node scripts/import-customers.js --tenant=airtech
 *
 * Scriptet:
 *   1. Kobler til riktig tenant-database
 *   2. Henter alle kunder fra Tripletex API
 *   3. Lagrer i customers-tabellen (upsert)
 *   4. Lagrer servfixmail-kontakter i customer_contacts
 *   5. Logger resultat med detaljer
 */
require('dotenv').config();

// Tving lokal DB når scriptet kjøres lokalt (unngå Cloud SQL socket)
delete process.env.CLOUD_SQL_CONNECTION_NAME;

const customerImportService = require('../src/services/customerImportService');
const db = require('../src/config/database');

// Parse --tenant=xxx fra argumenter
function getTenantArg() {
  const arg = process.argv.find(a => a.startsWith('--tenant='));
  if (!arg) {
    console.error('❌ Bruk: node scripts/import-customers.js --tenant=airtech');
    process.exit(1);
  }
  return arg.split('=')[1];
}

async function main() {
  const tenantId = getTenantArg();
  console.log('='.repeat(60));
  console.log(`🚀 Kundeimport — Tenant: ${tenantId}`);
  console.log('='.repeat(60));

  const startTime = Date.now();

  try {
    const stats = await customerImportService.importFromTripletex(tenantId);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('\n' + '='.repeat(60));
    console.log('📊 RESULTAT:');
    console.log(`   Nye kunder importert:  ${stats.imported}`);
    console.log(`   Eksisterende oppdatert: ${stats.updated}`);
    console.log(`   Skippet (lokalt endret): ${stats.skipped}`);
    console.log(`   Kontakter opprettet:    ${stats.contacts_created}`);
    console.log(`   Feil:                   ${stats.errors.length}`);
    console.log(`   Tid:                    ${elapsed}s`);

    if (stats.errors.length > 0) {
      console.log('\n⚠️  FEIL:');
      stats.errors.forEach(e => console.log(`   - ${e}`));
    }

    console.log('='.repeat(60));
  } catch (error) {
    console.error('\n❌ KRITISK FEIL:', error.message);
    console.error(error.stack);
    process.exitCode = 1;
  } finally {
    await db.closeAll();
  }
}

main();
