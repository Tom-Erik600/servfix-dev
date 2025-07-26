const express = require('express');
const router = express.Router();
const db = require('../../config/database');
const bcrypt = require('bcryptjs'); // Import bcryptjs

// Middleware for å sette adminTenantId (beholdes fra tidligere)
router.use((req, res, next) => {
  if (!req.session.isAdmin) {
    return res.status(401).json({ error: 'Admin authentication required' });
  }
  
  req.adminTenantId = req.headers['x-tenant-id'] || 
                      req.query.tenantId || 
                      req.session.selectedTenantId || 
                      'airtech'; // default
  
  if (req.headers['x-tenant-id'] || req.query.tenantId) {
    req.session.selectedTenantId = req.adminTenantId;
  }
  
  next();
});

// GET all technicians for the selected tenant
router.get('/', async (req, res) => {
  try {
    const pool = await db.getTenantConnection(req.adminTenantId);
    const result = await pool.query('SELECT id, name, initials, is_active FROM technicians');
    res.json(result.rows);
  } catch (error) {
    console.error(`[${req.adminTenantId}] Error fetching technicians:`, error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST new technician
router.post('/', async (req, res) => {
  try {
    const { name, initials, password } = req.body;

    if (!name || !initials || !password) {
      return res.status(400).json({ error: 'Navn, initialer og passord er påkrevd.' });
    }

    const pool = await db.getTenantConnection(req.adminTenantId);
    const hashedPassword = await bcrypt.hash(password, 10);

    // Generate a simple ID (e.g., TECH-initials or a UUID if available)
    // For simplicity, let's use initials for now, but a proper ID generation strategy is recommended.
    const technicianId = `TECH-${initials.toUpperCase()}`;

    const result = await pool.query(
      `INSERT INTO technicians (id, name, initials, password_hash, is_active)
       VALUES ($1, $2, $3, $4, TRUE)
       ON CONFLICT (id) DO UPDATE SET name = $2, password_hash = $4, is_active = TRUE
       RETURNING id, name, initials, is_active`,
      [technicianId, name, initials.toUpperCase(), hashedPassword]
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
    const result = await pool.query('DELETE FROM technicians WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tekniker ikke funnet.' });
    }

    res.status(200).json({ message: 'Tekniker slettet.', id: result.rows[0].id });

  } catch (error) {
    console.error(`[${req.adminTenantId}] Error deleting technician:`, error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;