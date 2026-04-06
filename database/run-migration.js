// Kjør service_address_migration.sql på alle aktive tenant-databaser
'use strict';
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

if (!process.env.K_SERVICE) {
  require('dotenv').config();
}

const sql = fs.readFileSync(path.join(__dirname, 'service_address_migration.sql'), 'utf8');

async function migrate(dbName) {
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: dbName,
  });
  try {
    const result = await pool.query(sql);
    const confirm = Array.isArray(result) ? result[result.length - 1] : result;
    console.log(`✅ [${dbName}] Migrering OK. Kolonner bekreftet:`, confirm.rows);
  } catch (err) {
    console.error(`❌ [${dbName}] Feil:`, err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

async function main() {
  // Hent alle aktive tenant-databaser
  const adminPool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: 'servfix_admin',
  });

  let tenants;
  try {
    const res = await adminPool.query('SELECT id, database_name FROM tenants WHERE is_active = true');
    tenants = res.rows;
    console.log(`🔍 Fant ${tenants.length} aktive tenants:`, tenants.map(t => t.database_name));
  } finally {
    await adminPool.end();
  }

  for (const tenant of tenants) {
    await migrate(tenant.database_name);
  }
}

main();
