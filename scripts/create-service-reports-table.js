require('dotenv').config();
const { Pool } = require('pg');

async function createServiceReportsTable() {
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: 'airtech_db'
  });

  try {
    console.log('Oppretter service_reports tabell...');
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS service_reports (
        id VARCHAR(255) PRIMARY KEY,
        order_id VARCHAR(255) NOT NULL,
        equipment_id VARCHAR(255) NOT NULL,
        technician_id VARCHAR(255) NOT NULL,
        report_data JSONB NOT NULL DEFAULT '{}',
        status VARCHAR(50) DEFAULT 'draft',
        sent_to_customer BOOLEAN DEFAULT FALSE,
        sent_date TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    console.log('Service_reports tabell opprettet!');
    
  } catch (error) {
    console.error('Feil:', error);
  } finally {
    await pool.end();
  }
}

createServiceReportsTable();