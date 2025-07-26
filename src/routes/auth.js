const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/database');

const router = express.Router();

// Login
router.post('/login', async (req, res) => {
  try {
    const { technicianId, password, tenantId } = req.body;
    
    // Bruk tenant fra request eller body
    const tenant = tenantId || req.tenantId;
    
    // Hent database connection for denne tenant
    const pool = await db.getTenantConnection(tenant);
    
    // Finn tekniker
    const result = await pool.query(
      'SELECT * FROM technicians WHERE id = $1 AND is_active = true',
      [technicianId]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Ugyldig brukernavn eller passord' });
    }
    
    const technician = result.rows[0];
    
    // Sjekk passord
    const validPassword = await bcrypt.compare(password, technician.password_hash);
    
    if (!validPassword) {
      return res.status(401).json({ error: 'Ugyldig brukernavn eller passord' });
    }
    
    // Lagre i session
    req.session.technicianId = technician.id;
    req.session.tenantId = tenant;
    console.log('Session set for technician:', req.session.technicianId, 'Tenant:', req.session.tenantId);
    
    res.json({
      success: true,
      technician: {
        id: technician.id,
        name: technician.name,
        initials: technician.initials
      }
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Check auth status
router.get('/me', async (req, res) => {
  console.log('Checking auth status for session:', req.session.technicianId);
  if (!req.session.technicianId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  try {
    const pool = await db.getTenantConnection(req.session.tenantId);
    const result = await pool.query(
      'SELECT id, name, initials FROM technicians WHERE id = $1',
      [req.session.technicianId]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }
    
    res.json({
      technician: result.rows[0],
      tenant: req.session.tenantId
    });
    
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;