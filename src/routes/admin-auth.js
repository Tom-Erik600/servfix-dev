const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/database');

const router = express.Router();

// Admin login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Admin bruker alltid servfix_admin database
    const pool = await db.getPool('servfix_admin');
    
    // Username kan være email
    const result = await pool.query(
      'SELECT * FROM admin_users WHERE email = $1',
      [username]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Ugyldig brukernavn eller passord' });
    }
    
    const admin = result.rows[0];
    const validPassword = await bcrypt.compare(password, admin.password_hash);
    
    if (!validPassword) {
      return res.status(401).json({ error: 'Ugyldig brukernavn eller passord' });
    }
    
    // Lagre admin session
    req.session.isAdmin = true;
    req.session.adminId = admin.id;
    req.session.adminEmail = admin.email;
    
    res.json({
      success: true,
      admin: {
        id: admin.id,
        email: admin.email,
        name: admin.name
      }
    });
    
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get current admin
router.get('/me', (req, res) => {
  if (!req.session.isAdmin) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  res.json({
    admin: {
      id: req.session.adminId,
      email: req.session.adminEmail
    }
  });
});

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

module.exports = router;