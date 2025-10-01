// src/routes/equipment.js - KOMPLETT OPPDATERT VERSJON
const express = require('express');
const db = require('../config/database');

const router = express.Router();

// Middleware - sjekk auth
router.use((req, res, next) => {
  console.log('Equipment route - Session check:', {
    sessionId: req.sessionID,
    technicianId: req.session?.technicianId,
    tenantId: req.session?.tenantId
  });
  
  if (!req.session.technicianId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
});

// Nytt endpoint for å hente spesifikt equipment basert på equipment ID
router.get('/by-id/:equipmentId', async (req, res) => {
  console.log('=== EQUIPMENT BY-ID ENDPOINT CALLED ===');
  try {
    // Valider at ID er gyldig før SQL-query
    const equipmentId = parseInt(req.params.equipmentId);
    
    if (!equipmentId || isNaN(equipmentId) || req.params.equipmentId === 'undefined') {
      console.error('Invalid equipment ID received:', req.params.equipmentId);
      return res.status(400).json({ 
        error: 'Ugyldig anlegg-ID',
        detail: `Mottok: "${req.params.equipmentId}". Forventet: gyldig heltall.`,
        hint: 'Sjekk at URL inneholder riktig equipmentId parameter'
      });
    }
    const pool = await db.getTenantConnection(req.session.tenantId);
    
    // ✅ OPPDATERT QUERY: Bruk nye kolonnenavn
    const result = await pool.query(`
      SELECT id, customer_id, systemtype, systemnummer, systemnavn, 
             plassering, betjener, location, status, notater,
             created_at, updated_at
      FROM equipment 
      WHERE id = $1
    `, [equipmentId]);
    
    console.log('Query result rows:', result.rows.length);
    
    if (result.rows.length === 0) {
      console.log('No equipment found with ID:', equipmentId);
      return res.status(404).json({ error: 'Equipment not found' });
    }
    
    const equipment = result.rows[0];
    
    // ✅ OPPDATERT TRANSFORM: Bruk nye kolonnenavn
    const transformedEquipment = {
      id: equipment.id,
      customerId: equipment.customer_id,
      type: equipment.systemtype,           // Map systemtype -> type
      name: equipment.systemnavn,           // Map systemnavn -> name
      location: equipment.location,
      systemNumber: equipment.systemnummer,
      systemPlacement: equipment.plassering,
      betjener: equipment.betjener,
      status: equipment.status,
      internalNotes: equipment.notater,
      serviceStatus: 'not_started' // Default value
    };
    
    console.log('Returning equipment:', transformedEquipment.id);
    res.json(transformedEquipment);
  } catch (error) {
    console.error('Error in by-id endpoint:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ✅ OPPDATERT: GET equipment by customer ID
router.get('/:customerId', async (req, res) => {
  console.log('=== EQUIPMENT BY CUSTOMER ID ENDPOINT CALLED ===');
  try {
    const { customerId } = req.params;
    const includeInactive = req.query.includeInactive === 'true';
    
    const pool = await db.getTenantConnection(req.session.tenantId);
    
    // ✅ OPPDATERT QUERY: Bruk nye kolonnenavn
    const query = `
      SELECT id, customer_id, systemtype, systemnummer, systemnavn, 
             plassering, betjener, location, status, notater,
             created_at, updated_at
      FROM equipment 
      WHERE customer_id = $1 
      AND (status = 'active' OR $2 = true)
      ORDER BY systemnavn ASC
    `;
    const params = [parseInt(customerId), includeInactive];
    
    const result = await pool.query(query, params);
    console.log(`Found ${result.rows.length} equipment for customer ${customerId}`);

    // ✅ OPPDATERT TRANSFORM: Map nye kolonnenavn til frontend format
    const transformedRows = result.rows.map(equipment => {
        return {
          id: equipment.id,
          customerId: equipment.customer_id,
          type: equipment.systemtype,           // Map systemtype -> type
          name: equipment.systemnavn,           // Map systemnavn -> name
          location: equipment.location,
          systemNumber: equipment.systemnummer, // Ny: systemNumber
          systemPlacement: equipment.plassering, // Ny: systemPlacement
          betjener: equipment.betjener,         // Ny: betjener
          status: equipment.status,
          internalNotes: equipment.notater,     // Map notater -> internalNotes
          serviceStatus: 'not_started'          // Service status fra service_reports
        };
    });

    res.json(transformedRows);
  } catch (error) {
    console.error('Error fetching equipment:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ✅ OPPDATERT: POST new equipment
router.post('/', async (req, res) => {
  console.log('Equipment POST request:', {
    body: req.body,
    sessionTechnicianId: req.session.technicianId,
    sessionTenantId: req.session.tenantId
  });
  
  try {
    // ✅ OPPDATERT: Bruk nye feltnavn
    const { 
      customerId, systemtype, systemnummer, systemnavn, 
      plassering, betjener, location, status, notater 
    } = req.body;
    
    // Valider påkrevde felter
    if (!customerId || !systemtype || !systemnummer || !systemnavn || !plassering) {
        return res.status(400).json({
            error: 'Mangler påkrevde felter: customerId, systemtype, systemnummer, systemnavn, og plassering er påkrevd'
        });
    }
    
    const pool = await db.getTenantConnection(req.session.tenantId);

    // ✅ OPPDATERT INSERT: Bruk nye kolonnenavn
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
        status || 'active', 
        notater || null
      ]
    );
    
    const equipment = result.rows[0];
    
    console.log('Equipment created:', equipment);
    res.status(201).json(equipment);
  } catch (error) {
    console.error('Error adding equipment:', error);
    
    if (error.code === '23505') {
      res.status(409).json({ error: 'Utstyr med samme systemnummer eksisterer allerede for denne kunden' });
    } else if (error.code === '23503') {
      res.status(400).json({ error: 'Ugyldig kunde-ID' });
    } else {
      res.status(500).json({
        error: 'Database-feil ved lagring av utstyr',
        details: error.message 
      });
    }
  }
});

// ✅ OPPDATERT: PUT update equipment
router.put('/:equipmentId', async (req, res) => {
  console.log('Equipment PUT request:', {
    equipmentId: req.params.equipmentId,
    body: req.body,
    sessionTechnicianId: req.session.technicianId
  });
  
  try {
    const { equipmentId } = req.params;
    // ✅ OPPDATERT: Bruk nye feltnavn
    const { 
      systemtype, systemnummer, systemnavn, plassering, 
      betjener, location, status, notater 
    } = req.body;
    
    const pool = await db.getTenantConnection(req.session.tenantId);
    
    // ✅ OPPDATERT UPDATE: Bruk nye kolonnenavn
    const result = await pool.query(
      `UPDATE equipment 
       SET 
         systemtype = $1, systemnummer = $2, systemnavn = $3, plassering = $4, 
         betjener = $5, location = $6, status = $7, notater = $8,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $9
       RETURNING *;`,
      [
        systemtype, systemnummer, systemnavn, plassering, 
        betjener, location, status, notater, equipmentId
      ]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Equipment not found' });
    }
    
    const updatedEquipment = result.rows[0];
    
    console.log('Equipment updated:', updatedEquipment);
    res.json(updatedEquipment);
  } catch (error) {
    console.error('Error updating equipment:', error);
    
    if (error.code === '23505') {
      res.status(409).json({ error: 'Systemnummer er allerede i bruk for denne kunden' });
    } else {
      res.status(500).json({
        error: 'Database-feil ved oppdatering av utstyr',
        details: error.message 
      });
    }
  }
});

// ✅ DELETE equipment
router.delete('/:equipmentId', async (req, res) => {
  console.log('Equipment DELETE request:', {
    equipmentId: req.params.equipmentId,
    sessionTechnicianId: req.session.technicianId
  });
  
  try {
    const { equipmentId } = req.params;
    const pool = await db.getTenantConnection(req.session.tenantId);
    
    // Soft delete - sett status til inactive
    const result = await pool.query(
      `UPDATE equipment 
       SET status = 'inactive', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *;`,
      [equipmentId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Equipment not found' });
    }
    
    console.log('Equipment soft deleted (status -> inactive):', equipmentId);
    res.json({ message: 'Equipment deactivated', equipment: result.rows[0] });
  } catch (error) {
    console.error('Error deleting equipment:', error);
    res.status(500).json({
      error: 'Database-feil ved sletting av utstyr',
      details: error.message 
    });
  }
});

module.exports = router;