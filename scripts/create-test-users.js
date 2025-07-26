require('dotenv').config();
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

async function createTestUser() {
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: 'airtech_db'
  });

  try {
    // Hash passord
    const password = 'test123'; // BYTT DETTE!
    const hash = await bcrypt.hash(password, 10);
    
    // Opprett tekniker
    const result = await pool.query(
      `INSERT INTO technicians (id, name, initials, password_hash) 
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE
       SET password_hash = $4
       RETURNING *`,
      ['TECH-001', 'Test Tekniker', 'TT', hash]
    );
    
    console.log('✅ Tekniker opprettet:', result.rows[0]);
    console.log('📝 Logg inn med:');
    console.log('   Initials: TT');
    console.log('   Password:', password);
    
  } catch (error) {
    console.error('❌ Feil:', error);
  } finally {
    await pool.end();
  }
}

createTestUser();