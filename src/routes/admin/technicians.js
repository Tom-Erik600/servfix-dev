const express = require('express');
const router = express.Router();
const db = require('../../config/database');
const bcrypt = require('bcryptjs'); // Import bcryptjs

// Middleware for å sette adminTenantId - DEBUG VERSION
router.use((req, res, next) => {
  console.log('🚀 MIDDLEWARE: Technicians route accessed', {
    method: req.method,
    path: req.path,
    url: req.url,
    sessionExists: !!req.session,
    isAdmin: req.session?.isAdmin
  });

  if (!req.session.isAdmin) {
    console.log('❌ MIDDLEWARE: Admin authentication failed', {
      session: req.session,
      isAdmin: req.session?.isAdmin
    });
    return res.status(401).json({ error: 'Admin authentication required' });
  }
  
  req.adminTenantId = req.headers['x-tenant-id'] || 
                      req.query.tenantId || 
                      req.session.selectedTenantId || 
                      'airtech'; // default
  
  console.log('✅ MIDDLEWARE: Admin auth passed', {
    adminTenantId: req.adminTenantId,
    headers: req.headers['x-tenant-id'],
    query: req.query.tenantId,
    selected: req.session.selectedTenantId
  });
  
  if (req.headers['x-tenant-id'] || req.query.tenantId) {
    req.session.selectedTenantId = req.adminTenantId;
  }
  
  next();
});

// GET all technicians for the selected tenant
router.get('/', async (req, res) => {
  try {
    const pool = await db.getTenantConnection(req.adminTenantId);
    const result = await pool.query('SELECT id, name, initials, stilling, is_active FROM technicians WHERE is_active = true');
    res.json(result.rows);
  } catch (error) {
    console.error(`[${req.adminTenantId}] Error fetching technicians:`, error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST new technician
router.post('/', async (req, res) => {
  try {
    const { name, initials, password, stilling } = req.body;

    if (!name || !initials || !password) {
      return res.status(400).json({ error: 'Navn, initialer og passord er påkrevd.' });
    }

    const pool = await db.getTenantConnection(req.adminTenantId);
    const hashedPassword = await bcrypt.hash(password, 10);

    // Generate a simple ID (e.g., TECH-initials or a UUID if available)
    // For simplicity, let's use initials for now, but a proper ID generation strategy is recommended.
    const technicianId = `TECH-${initials.toUpperCase()}`;

    const result = await pool.query(
      `INSERT INTO technicians (id, name, initials, stilling, password_hash, is_active)
     VALUES ($1, $2, $3, $4, $5, TRUE)
     ON CONFLICT (id) DO UPDATE SET name = $2, stilling = $4, password_hash = $5, is_active = TRUE
     RETURNING id, name, initials, stilling, is_active`,
      [technicianId, name, initials.toUpperCase(), stilling, hashedPassword]
    );

    res.status(201).json(result.rows[0]);

  } catch (error) {
    console.error(`[${req.adminTenantId}] Error creating technician:`, error);
    if (error.code === '23505') { // Unique violation (e.g., initials already exists)
      return res.status(409).json({ error: 'Tekniker med disse initialene eksisterer allerede.' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE technician
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const pool = await db.getTenantConnection(req.adminTenantId);
    
    // Sjekk om teknikeren er i bruk (kun orders)
    const usageCheck = await pool.query(
      'SELECT COUNT(*) as order_count FROM orders WHERE technician_id = $1', 
      [id]
    );
    
    const orderCount = parseInt(usageCheck.rows[0].order_count);
    
    if (orderCount > 0) {
      // Deaktiver i stedet for å slette
      const result = await pool.query(
        'UPDATE technicians SET is_active = FALSE WHERE id = $1 RETURNING id', 
        [id]
      );
      
      return res.json({ 
        message: `Tekniker deaktivert (${orderCount} ordre).`, 
        action: 'deactivated'
      });
    }
    
    // Hvis ikke i bruk, slett tekniker
    const result = await pool.query('DELETE FROM technicians WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tekniker ikke funnet.' });
    }

    res.json({ 
      message: 'Tekniker slettet.', 
      action: 'deleted'
    });

  } catch (error) {
    console.error('Error deleting technician:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT update technician
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, initials, stilling, password } = req.body;

    if (!name || !initials) {
      return res.status(400).json({ error: 'Navn og initialer er påkrevd.' });
    }

    const pool = await db.getTenantConnection(req.adminTenantId);
    
    let query, params;
    
    if (password && password.trim() !== '') {
      // Oppdater med nytt passord
      const hashedPassword = await bcrypt.hash(password, 10);
      query = `UPDATE technicians 
               SET name = $2, initials = $3, stilling = $4, password_hash = $5 
               WHERE id = $1 
               RETURNING id, name, initials, stilling, is_active`;
      params = [id, name, initials.toUpperCase(), stilling, hashedPassword];
    } else {
      // Oppdater uten å endre passord
      query = `UPDATE technicians 
               SET name = $2, initials = $3, stilling = $4 
               WHERE id = $1 
               RETURNING id, name, initials, stilling, is_active`;
      params = [id, name, initials.toUpperCase(), stilling];
    }

    const result = await pool.query(query, params);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tekniker ikke funnet.' });
    }

    res.json(result.rows[0]);

  } catch (error) {
    console.error(`[${req.adminTenantId}] Error updating technician:`, error);
    res.status(500).json({ error: 'Intern serverfeil' });
  }
});

module.exports = router;