require('dotenv').config();
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

async function createAdminUser() {
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: 'servfix_admin'
  });

  try {
    const email = 'admin@servfix.no';
    const password = 'Admin123!'; // BYTT DETTE!
    const hash = await bcrypt.hash(password, 10);
    
    const result = await pool.query(
      `INSERT INTO admin_users (email, password_hash, name) 
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE
       SET password_hash = $2
       RETURNING *`,
      [email, hash, 'Admin User']
    );
    
    console.log('✅ Admin bruker opprettet:', result.rows[0]);
    console.log('📧 Email:', email);
    console.log('🔑 Password:', password);
    
  } catch (error) {
    console.error('❌ Feil:', error);
  } finally {
    await pool.end();
  }
}

createAdminUser();