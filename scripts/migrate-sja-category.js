/**
 * migrate-sja-category.js
 *
 * Kjør migrasjon for SJA kategori-felt mot én eller alle tenant-databaser.
 *
 * Bruk:
 *   node scripts/migrate-sja-category.js              → alle aktive tenants
 *   node scripts/migrate-sja-category.js airtech       → kun airtech
 *   node scripts/migrate-sja-category.js --dry-run     → vis hva som ville kjørt
 *
 * Forutsetning: .env må være konfigurert (eller Cloud SQL Proxy må kjøre)
 */

// Last .env kun lokalt (ikke i Cloud Run)
if (!process.env.K_SERVICE) {
  require('dotenv').config();

  // Lokalt på Windows: bruk TCP via Cloud SQL Proxy, ikke Unix socket
  // Cloud SQL Proxy må kjøre: cloud-sql-proxy --port <port> <connection-name>
  // Sett til tom streng (ikke delete) — dotenv overskriver ikke eksisterende vars,
  // så database.js sin dotenv-kall vil ikke gjenopprette den.
  if (process.env.CLOUD_SQL_CONNECTION_NAME) {
    process.env.CLOUD_SQL_CONNECTION_NAME = '';
    process.env.DB_HOST = process.env.DB_HOST || '127.0.0.1';
    process.env.DB_PORT = process.env.DB_PORT || '5433';
    console.log(`🔧 Lokalt modus: bruker TCP ${process.env.DB_HOST}:${process.env.DB_PORT} (Cloud SQL Proxy)`);
  }
}

const db = require('../src/config/database');

// Idempotent SQL — trygt å kjøre flere ganger
const MIGRATION_SQL = `
ALTER TABLE hms_sja
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS subcategory TEXT;
`;

const VERIFY_SQL = `
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'hms_sja'
  AND column_name IN ('category', 'subcategory')
ORDER BY column_name;
`;

async function getAllTenantDatabases() {
  const adminPool = await db.getPool('servfix_admin');
  const result = await adminPool.query(
    'SELECT id, database_name FROM tenants WHERE is_active = true ORDER BY id'
  );
  return result.rows;
}

async function migrateTenantDatabase(tenantId, databaseName, dryRun) {
  console.log(`\n🏢 Tenant: ${tenantId} (${databaseName})`);

  if (dryRun) {
    console.log('   🔍 [DRY RUN] Ville kjørt:');
    console.log('   ' + MIGRATION_SQL.trim().replace(/\n/g, '\n   '));
    return { success: true, dryRun: true };
  }

  try {
    const pool = await db.getPool(databaseName);

    // Sjekk om hms_sja-tabellen eksisterer
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'hms_sja'
      ) AS exists
    `);

    if (!tableCheck.rows[0].exists) {
      console.log('   ⚠️  Tabell hms_sja finnes ikke — hopper over');
      return { success: true, skipped: true, reason: 'table_not_found' };
    }

    // Kjør migrasjonen
    await pool.query(MIGRATION_SQL);
    console.log('   ✅ Migrasjon kjørt');

    // Bekreft kolonnene finnes
    const verify = await pool.query(VERIFY_SQL);
    const foundCols = verify.rows.map(r => r.column_name);

    if (foundCols.includes('category') && foundCols.includes('subcategory')) {
      console.log('   ✅ Verifisert: category og subcategory finnes i hms_sja');
    } else {
      console.warn(`   ⚠️  Verifisering feilet — fant kun: ${foundCols.join(', ')}`);
    }

    return { success: true, columns: foundCols };

  } catch (error) {
    console.error(`   ❌ Feil: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const specificTenant = args.find(a => !a.startsWith('--'));

  console.log('=== SJA KATEGORI-MIGRASJON ===');
  if (dryRun) console.log('🔍 DRY RUN — ingen endringer vil bli gjort');
  console.log('');

  try {
    let tenants;

    if (specificTenant) {
      // Enkelt-tenant modus
      const adminPool = await db.getPool('servfix_admin');
      const result = await adminPool.query(
        'SELECT id, database_name FROM tenants WHERE id = $1',
        [specificTenant]
      );
      if (result.rows.length === 0) {
        console.error(`❌ Tenant '${specificTenant}' ikke funnet i servfix_admin`);
        process.exit(1);
      }
      tenants = result.rows;
      console.log(`Kjører kun for tenant: ${specificTenant}`);
    } else {
      // Alle aktive tenants
      tenants = await getAllTenantDatabases();
      console.log(`Fant ${tenants.length} aktive tenant(s):`);
      tenants.forEach(t => console.log(`  - ${t.id} → ${t.database_name}`));
    }

    // Kjør migrasjon for hver tenant
    const results = [];
    for (const tenant of tenants) {
      const result = await migrateTenantDatabase(tenant.id, tenant.database_name, dryRun);
      results.push({ tenant: tenant.id, ...result });
    }

    // Oppsummering
    console.log('\n=== OPPSUMMERING ===');
    const ok = results.filter(r => r.success && !r.skipped && !r.dryRun).length;
    const skipped = results.filter(r => r.skipped).length;
    const failed = results.filter(r => !r.success).length;

    console.log(`✅ Vellykket: ${ok}`);
    if (skipped > 0) console.log(`⏭️  Hoppet over: ${skipped}`);
    if (failed > 0) {
      console.log(`❌ Feilet: ${failed}`);
      results.filter(r => !r.success).forEach(r => {
        console.log(`   - ${r.tenant}: ${r.error}`);
      });
    }

    if (dryRun) {
      console.log('\n💡 Kjør uten --dry-run for å faktisk utføre migrasjonen');
    }

    process.exit(failed > 0 ? 1 : 0);

  } catch (error) {
    console.error('\n❌ Fatal feil:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await db.closeAll();
  }
}

main();
