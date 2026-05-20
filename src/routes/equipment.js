// src/routes/equipment.js - KOMPLETT OPPDATERT VERSJON
const express = require('express');
const db = require('../config/database');
const { requireTenant } = require('../middleware/auth');
const resolveCustomer = require('../middleware/resolveCustomer');

const router = express.Router();

// Middleware - sjekk auth og tenant
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
router.use(requireTenant);

// POST batch assign/remove cluster on equipment
router.post('/assign-cluster', async (req, res) => {
  try {
    const { equipmentIds, clusterId } = req.body;

    if (!Array.isArray(equipmentIds) || equipmentIds.length === 0) {
      return res.status(400).json({ error: 'equipmentIds må være en ikke-tom array' });
    }

    const normalizedIds = equipmentIds
      .map(id => parseInt(id, 10))
      .filter(id => Number.isInteger(id));

    if (normalizedIds.length === 0) {
      return res.status(400).json({ error: 'Ingen gyldige anlegg-IDer oppgitt' });
    }

    const pool = await db.getTenantConnection(req.session.tenantId);
    const params = [normalizedIds, clusterId ? parseInt(clusterId, 10) : null];

    const result = await pool.query(
      `UPDATE equipment
       SET cluster_id = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ANY($1::int[])
       RETURNING id, cluster_id`,
      params
    );

    res.json({
      updatedCount: result.rows.length,
      clusterId: clusterId ? parseInt(clusterId, 10) : null,
      equipmentIds: result.rows.map(row => row.id)
    });
  } catch (error) {
    console.error('Error assigning cluster to equipment:', error);
    res.status(500).json({ error: 'Kunne ikke oppdatere cluster for anlegg', details: error.message });
  }
});

// DENNE MÅ KOMME FØRST:
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  console.log(`=== GETTING EQUIPMENT BY ID: ${id} ===`);
  
  try {
    const pool = await db.getTenantConnection(req.session.tenantId);
    
    const result = await pool.query(
      `SELECT id, customer_id, systemtype, systemnummer, systemnavn, 
              plassering, betjener, location, status, notater,
              has_filters, filter_supply, filter_exhaust, filter_drive_supply, filter_drive_exhaust,
              filter_supply_text, filter_exhaust_text, filter_drive_supply_text, filter_drive_exhaust_text
       FROM equipment 
       WHERE id = $1`,
      [parseInt(id)]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Equipment not found' });
    }
    
    res.json(result.rows[0]);
    
  } catch (error) {
    console.error('Error fetching equipment by ID:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ✅ OPPDATERT: GET equipment by customer ID
router.get('/', resolveCustomer, async (req, res) => {
  console.log('=== EQUIPMENT BY CUSTOMER ID ENDPOINT CALLED ===');
  try {
    const { customerId } = req.query;
    const includeInactive = req.query.includeInactive === 'true';
    
    const pool = await db.getTenantConnection(req.session.tenantId);
    
    // ✅ OPPDATERT QUERY: Bruk nye kolonnenavn
    const query = `
      SELECT id, customer_id, systemtype, systemnummer, systemnavn, 
             plassering, betjener, location, status, notater,
             has_filters, filter_supply, filter_exhaust, filter_drive_supply, filter_drive_exhaust,
             filter_supply_text, filter_exhaust_text, filter_drive_supply_text, filter_drive_exhaust_text,
             created_at, updated_at
      FROM equipment 
      WHERE customer_id = $1 
      AND (status = 'active' OR $2 = true)
      ORDER BY systemnavn ASC
    `;
    const params = [req.resolvedCustomerId, includeInactive];
    
    const result = await pool.query(query, params);
    console.log(`Found ${result.rows.length} equipment for customer ${customerId}`);

    // ✅ OPPDATERT TRANSFORM: Map nye kolonnenavn til frontend format
    const transformedRows = result.rows.map(equipment => {
        return {
          id: equipment.id,
          customerId: equipment.customer_id,
          type: equipment.systemtype,
          name: equipment.systemnavn,
          location: equipment.location,
          systemNumber: equipment.systemnummer,
          systemPlacement: equipment.plassering,
          betjener: equipment.betjener,
          status: equipment.status,
          internalNotes: equipment.notater,
          hasFilters: equipment.has_filters,
          filterSupply: equipment.filter_supply,
          filterExhaust: equipment.filter_exhaust,
          filterDriveSupply: equipment.filter_drive_supply,
          filterDriveExhaust: equipment.filter_drive_exhaust,
          filterSupplyText: equipment.filter_supply_text,
          filterExhaustText: equipment.filter_exhaust_text,
          filterDriveSupplyText: equipment.filter_drive_supply_text,
          filterDriveExhaustText: equipment.filter_drive_exhaust_text,
          serviceStatus: 'not_started'
        };
    });

    res.json(transformedRows);
  } catch (error) {
    console.error('Error fetching equipment:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ✅ OPPDATERT: POST new equipment
router.post('/', resolveCustomer, async (req, res) => {
  console.log('Equipment POST request:', {
    body: req.body,
    sessionTechnicianId: req.session.technicianId,
    sessionTenantId: req.session.tenantId
  });
  
  try {
    // ✅ OPPDATERT: Bruk nye feltnavn
    const { 
      customerId, systemtype, systemnummer, systemnavn, 
      plassering, betjener, location, status, notater,
      hasFilters, filterSupply, filterExhaust, filterDriveSupply, filterDriveExhaust,
      filterSupplyText, filterExhaustText, filterDriveSupplyText, filterDriveExhaustText
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
        (customer_id, systemtype, systemnummer, systemnavn, plassering, betjener, location, status, notater,
         has_filters, filter_supply, filter_exhaust, filter_drive_supply, filter_drive_exhaust,
         filter_supply_text, filter_exhaust_text, filter_drive_supply_text, filter_drive_exhaust_text) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) 
       RETURNING *;`,
      [
        req.resolvedCustomerId, 
        systemtype, 
        systemnummer, 
        systemnavn, 
        plassering, 
        betjener || null, 
        location || null, 
        status || 'active', 
        notater || null,
        hasFilters || false,
        filterSupply || false,
        filterExhaust || false,
        filterDriveSupply || false,
        filterDriveExhaust || false,
        filterSupplyText || null,
        filterExhaustText || null,
        filterDriveSupplyText || null,
        filterDriveExhaustText || null
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
      betjener, location, status, notater,
      hasFilters, filterSupply, filterExhaust, filterDriveSupply, filterDriveExhaust,
      filterSupplyText, filterExhaustText, filterDriveSupplyText, filterDriveExhaustText
    } = req.body;
    
    const pool = await db.getTenantConnection(req.session.tenantId);
    
    // ✅ OPPDATERT UPDATE: Bruk nye kolonnenavn
    const result = await pool.query(
      `UPDATE equipment 
       SET 
         systemtype = $1, systemnummer = $2, systemnavn = $3, plassering = $4, 
         betjener = $5, location = $6, status = $7, notater = $8,
         has_filters = $9, filter_supply = $10, filter_exhaust = $11,
         filter_drive_supply = $12, filter_drive_exhaust = $13,
         filter_supply_text = $14, filter_exhaust_text = $15,
         filter_drive_supply_text = $16, filter_drive_exhaust_text = $17,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $18
       RETURNING *;`,
      [
        systemtype, systemnummer, systemnavn, plassering, 
        betjener, location, status, notater,
        hasFilters || false,
        filterSupply || false,
        filterExhaust || false,
        filterDriveSupply || false,
        filterDriveExhaust || false,
        filterSupplyText || null,
        filterExhaustText || null,
        filterDriveSupplyText || null,
        filterDriveExhaustText || null,
        equipmentId
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
