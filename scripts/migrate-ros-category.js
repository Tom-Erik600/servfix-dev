/**
 * migrate-ros-category.js
 *
 * Legger til category TEXT-kolonne på hms_ros for alle aktive tenants.
 *
 * Bruk:
 *   node scripts/migrate-ros-category.js              → alle tenants
 *   node scripts/migrate-ros-category.js airtech       → kun airtech
 *   node scripts/migrate-ros-category.js --dry-run     → vis uten å kjøre
 */

if (!process.env.K_SERVICE) {
  require('dotenv').config();
}

const db = require('../src/config/database');

const MIGRATION_SQL = `
ALTER TABLE hms_ros
  ADD COLUMN IF NOT EXISTS category TEXT;
`;

const VERIFY_SQL = `
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'hms_ros'
  AND column_name = 'category';
`;

async function getAllTenants() {
  const adminPool = await db.getPool('servfix_admin');
  const result = await adminPool.query(
    'SELECT id, database_name FROM tenants WHERE is_active = true ORDER BY id'
  );
  return result.rows;
}

async function migrateTenant(tenantId, databaseName, dryRun) {
  console.log(`\n🏢 Tenant: ${tenantId} (${databaseName})`);

  if (dryRun) {
    console.log('   🔍 [DRY RUN] Ville kjørt ALTER TABLE hms_ros ADD COLUMN IF NOT EXISTS category TEXT');
    return { success: true, dryRun: true };
  }

  try {
    const pool = await db.getPool(databaseName);

    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables WHERE table_name = 'hms_ros'
      ) AS exists
    `);

    if (!tableCheck.rows[0].exists) {
      console.log('   ⚠️  Tabell hms_ros finnes ikke — hopper over');
      return { success: true, skipped: true };
    }

    await pool.query(MIGRATION_SQL);
    console.log('   ✅ Migrasjon kjørt');

    const verify = await pool.query(VERIFY_SQL);
    if (verify.rows.length > 0) {
      console.log('   ✅ Verifisert: category-kolonne finnes i hms_ros');
    } else {
      console.warn('   ⚠️  Verifisering feilet');
    }

    return { success: true };

  } catch (error) {
    console.error(`   ❌ Feil: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const specificTenant = args.find(a => !a.startsWith('--'));

  console.log('=== ROS KATEGORI-MIGRASJON ===');
  if (dryRun) console.log('🔍 DRY RUN — ingen endringer vil bli gjort');

  try {
    let tenants;
    if (specificTenant) {
      const adminPool = await db.getPool('servfix_admin');
      const result = await adminPool.query(
        'SELECT id, database_name FROM tenants WHERE id = $1',
        [specificTenant]
      );
      if (result.rows.length === 0) {
        console.error(`❌ Tenant '${specificTenant}' ikke funnet`);
        process.exit(1);
      }
      tenants = result.rows;
    } else {
      tenants = await getAllTenants();
      console.log(`\nFant ${tenants.length} aktive tenant(s):`);
      tenants.forEach(t => console.log(`  - ${t.id} → ${t.database_name}`));
    }

    const results = [];
    for (const tenant of tenants) {
      const result = await migrateTenant(tenant.id, tenant.database_name, dryRun);
      results.push({ tenant: tenant.id, ...result });
    }

    console.log('\n=== OPPSUMMERING ===');
    const ok = results.filter(r => r.success && !r.skipped && !r.dryRun).length;
    const skipped = results.filter(r => r.skipped).length;
    const failed = results.filter(r => !r.success).length;
    console.log(`✅ Vellykket: ${ok}`);
    if (skipped > 0) console.log(`⏭️  Hoppet over: ${skipped}`);
    if (failed > 0) {
      console.log(`❌ Feilet: ${failed}`);
      results.filter(r => !r.success).forEach(r => console.log(`   - ${r.tenant}: ${r.error}`));
    }

    process.exit(failed > 0 ? 1 : 0);

  } catch (error) {
    console.error('\n❌ Fatal feil:', error.message);
    process.exit(1);
  } finally {
    await db.closeAll();
  }
}

main();
