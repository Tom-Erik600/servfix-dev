const express = require('express');
const router = express.Router();
const db = require('../../config/database');

// Middleware for admin auth
router.use((req, res, next) => {
  if (!req.session.isAdmin) {
    return res.status(401).json({ error: 'Admin authentication required' });
  }
  
  req.adminTenantId = req.headers['x-tenant-id'] || 
                      req.query.tenantId || 
                      req.session.selectedTenantId || 
                      'airtech';
  
  next();
});

// GET equipment for a specific customer
router.get('/', async (req, res) => {
  try {
    const { customerId } = req.query;
    
    if (!customerId) {
      return res.status(400).json({ error: 'customerId is required' });
    }
    
    const pool = await db.getTenantConnection(req.adminTenantId);
    
    // ✅ OPPDATERT: Bruk nye kolonnenavn
    const query = `
      SELECT id, customer_id, systemtype, systemnummer, systemnavn, 
             plassering, betjener, location, status, notater,
             created_at, updated_at
      FROM equipment 
      WHERE customer_id = $1 
      AND status = 'active'
      ORDER BY systemnavn ASC
    `;
    
    const result = await pool.query(query, [parseInt(customerId)]);
    
    // ✅ Transform data til frontend format
    const equipment = result.rows.map(eq => ({
      id: eq.id,
      customerId: eq.customer_id,
      type: eq.systemtype,
      name: eq.systemnavn,              // ← DETTE er viktig!
      location: eq.location,
      systemNumber: eq.systemnummer,
      systemPlacement: eq.plassering,
      betjener: eq.betjener,
      status: eq.status,
      internalNotes: eq.notater,
      serviceStatus: 'not_started'
    }));
    
    res.json(equipment);
    
  } catch (error) {
    console.error('Error fetching equipment:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST new equipment
router.post('/', async (req, res) => {
  try {
    const { customerId, systemtype, systemnummer, systemnavn, plassering, betjener, location, notater } = req.body;
    
    // Valider påkrevde felter
    if (!customerId || !systemtype || !systemnummer || !systemnavn || !plassering) {
      return res.status(400).json({
        error: 'Mangler påkrevde felter: customerId, systemtype, systemnummer, systemnavn, og plassering er påkrevd'
      });
    }
    
    const pool = await db.getTenantConnection(req.adminTenantId);

    // Bruk nye kolonnenavn og la databasen generere ID
    const result = await pool.query(
      `INSERT INTO equipment 
        (customer_id, systemtype, systemnummer, systemnavn, plassering, betjener, location, status, notater) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
       RETURNING *;`,
      [
        parseInt(customerId), 
        systemtype, 
        systemnummer, 
        systemnavn, 
        plassering, 
        betjener || null, 
        location || null, 
        'active', 
        notater || null
      ]
    );
    
    const equipment = result.rows[0];
    
    console.log('Equipment created by admin:', equipment);
    res.status(201).json(equipment);
    
  } catch (error) {
    console.error('Error creating equipment:', error);
    
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Anlegg med samme systemnummer eksisterer allerede' });
    }
    
    res.status(500).json({ error: 'Kunne ikke opprette anlegg', details: error.message });
  }
});

module.exports = router;