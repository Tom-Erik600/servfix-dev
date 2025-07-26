
require('dotenv').config();
const { Pool } = require('pg');

async function setupAdminDb() {
  // Koble til standard 'postgres' database for å opprette den nye databasen
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: 'postgres'
  });

  const dbName = 'servfix_admin';

  try {
    // Sjekk om databasen allerede eksisterer
    const res = await pool.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [dbName]);
    if (res.rowCount === 0) {
      console.log(`Oppretter database: ${dbName}...`);
      await pool.query(`CREATE DATABASE ${dbName}`);
      console.log(`Database ${dbName} opprettet.`);
    } else {
      console.log(`Database ${dbName} eksisterer allerede.`);
    }
  } catch (error) {
    console.error(`Feil ved oppretting av database ${dbName}:`, error);
  } finally {
    await pool.end();
  }

  // Koble til den nye admin-databasen for å opprette tabellen
  const adminPool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: dbName
  });

  try {
    console.log('Oppretter "tenants"-tabellen...');
    await adminPool.query(`
      CREATE TABLE IF NOT EXISTS tenants (
        id VARCHAR(255) PRIMARY KEY,
        database_name VARCHAR(255) NOT NULL,
        is_active BOOLEAN DEFAULT true
      );
    `);
    console.log('"tenants"-tabellen er klar.');

    console.log('Oppretter "session"-tabellen...');
    await adminPool.query(`
      CREATE TABLE IF NOT EXISTS session (
        sid VARCHAR NOT NULL COLLATE "default" PRIMARY KEY,
        sess JSON NOT NULL,
        expire TIMESTAMP(6) WITH TIME ZONE NOT NULL
      ) WITH (OIDS=FALSE);
      CREATE INDEX IF NOT EXISTS IDX_session_expire ON session (expire);
    `);
    console.log('"session"-tabellen er klar.');

    console.log('Oppretter "admin_users"-tabellen...');
    await adminPool.query(`
      CREATE TABLE IF NOT EXISTS admin_users (
        email VARCHAR(255) PRIMARY KEY,
        password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(255)
      );
    `);
    console.log('"admin_users"-tabellen er klar.');

    // Legg til en test-tenant
    console.log('Legger til test-tenant "airtech"...');
    await adminPool.query(`
      INSERT INTO tenants (id, database_name)
      VALUES ('airtech', 'airtech_db')
      ON CONFLICT (id) DO NOTHING;
    `);
    console.log('Test-tenant "airtech" er lagt til.');

  } catch (error) {
    console.error('Feil ved oppsett av "tenants"-tabellen:', error);
  } finally {
    await adminPool.end();
  }

  // Koble til airtech_db for å opprette checklist_templates tabellen
  const airtechPool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: 'airtech_db'
  });

  try {
    console.log('Sletter eksisterende "checklist_templates"-tabell (hvis den finnes)...');
    await airtechPool.query(`DROP TABLE IF EXISTS checklist_templates;`);
    console.log('Oppretter "checklist_templates"-tabellen i airtech_db...');
    await airtechPool.query(`
      CREATE TABLE IF NOT EXISTS checklist_templates (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        equipment_type VARCHAR(255),
        template_data JSONB
      );
    `);
    console.log('"checklist_templates"-tabellen er klar i airtech_db.');
  } catch (error) {
    console.error('Feil ved oppsett av "checklist_templates"-tabellen:', error);
  } finally {
    await airtechPool.end();
  }
}

setupAdminDb();
