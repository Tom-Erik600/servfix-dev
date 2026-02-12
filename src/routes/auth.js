const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/database');

const router = express.Router();

// Login
router.post('/login', async (req, res) => {
  try {
    const { technicianId, password, tenantId } = req.body;

    // S5: Valider at body-tenant matcher subdomain (forhindrer cross-tenant login)
    const host = req.get('host') || '';
    const subdomain = host.split('.')[0];
    const isProductionHost = !host.startsWith('localhost') && !host.match(/^\d{1,3}\.\d{1,3}/);

    let tenant;
    if (isProductionHost && subdomain) {
      // Produksjon: bruk ALLTID subdomain som tenant — ignorer body
      if (tenantId && tenantId !== subdomain) {
        console.warn(`🔒 Tech login DENIED: body tenantId '${tenantId}' does not match subdomain '${subdomain}'`);
        return res.status(403).json({ error: 'Ikke tilgang fra dette domenet' });
      }
      tenant = subdomain;
    } else {
      // Localhost/dev: tillat body tenantId
      tenant = tenantId || req.tenantId;
    }
    
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
    
    // S4: Regenerer session-ID for å forhindre session fixation
    req.session.regenerate((err) => {
      if (err) {
        console.error('Session regenerate error:', err);
        return res.status(500).json({ error: 'Server error' });
      }

      req.session.technicianId = technician.id;
      req.session.tenantId = tenant;
      console.log('Session set for technician:', req.session.technicianId, 'Tenant:', req.session.tenantId);

      req.session.save((saveErr) => {
        if (saveErr) {
          console.error('Session save error:', saveErr);
          return res.status(500).json({ error: 'Server error' });
        }

        res.json({
          success: true,
          technician: {
            id: technician.id,
            name: technician.name,
            initials: technician.initials
          }
        });
      });
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
  console.log('req.session:', req.session);
  console.log('req.session.tenantId:', req.session.tenantId);

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
    console.error('Error in /me endpoint:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;