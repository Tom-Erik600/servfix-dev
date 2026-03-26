const express = require('express');
const router = express.Router();
const db = require('../../config/database');
const adminTenant = require('../../middleware/admin-tenant');

// 🔒 Delt middleware: Admin auth + tenant-isolasjon med validering
router.use(adminTenant);

// GET equipment for a specific customer
router.get('/', async (req, res) => {
  try {
    const { customerId } = req.query;
    
    if (!customerId) {
      return res.status(400).json({ error: 'customerId is required' });
    }
    
    const pool = await db.getTenantConnection(req.adminTenantId);
    
    const query = `
      SELECT e.id, e.customer_id, e.systemtype, e.systemnummer, e.systemnavn,
             e.plassering, e.betjener, e.location, e.status, e.notater,
             e.cluster_id, ec.name AS cluster_name,
             e.created_at, e.updated_at
      FROM equipment e
      LEFT JOIN equipment_clusters ec ON ec.id = e.cluster_id
      WHERE e.customer_id = $1
      AND e.status = 'active'
      ORDER BY ec.name ASC NULLS LAST, e.systemnavn ASC
    `;

    const result = await pool.query(query, [parseInt(customerId)]);

    // Transform data til frontend format
    const equipment = result.rows.map(eq => ({
      id: eq.id,
      customerId: eq.customer_id,
      type: eq.systemtype,
      name: eq.systemnavn,
      location: eq.location,
      systemNumber: eq.systemnummer,
      systemPlacement: eq.plassering,
      betjener: eq.betjener,
      status: eq.status,
      internalNotes: eq.notater,
      clusterId: eq.cluster_id || null,
      clusterName: eq.cluster_name || null,
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
    const { customerId, systemtype, systemnummer, systemnavn, plassering, betjener, location, notater, clusterId } = req.body;

    // Valider påkrevde felter
    if (!customerId || !systemtype || !systemnummer || !systemnavn || !plassering) {
      return res.status(400).json({
        error: 'Mangler påkrevde felter: customerId, systemtype, systemnummer, systemnavn, og plassering er påkrevd'
      });
    }

    const pool = await db.getTenantConnection(req.adminTenantId);

    const result = await pool.query(
      `INSERT INTO equipment
        (customer_id, systemtype, systemnummer, systemnavn, plassering, betjener, location, status, notater, cluster_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
        notater || null,
        clusterId ? parseInt(clusterId) : null
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

    const pool = await db.getTenantConnection(req.adminTenantId);
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

// PUT update equipment (admin)
router.put('/:equipmentId', async (req, res) => {
  try {
    const { equipmentId } = req.params;
    const {
      systemtype, systemnummer, systemnavn, plassering,
      betjener, location, notater, clusterId
    } = req.body;

    const pool = await db.getTenantConnection(req.adminTenantId);

    const result = await pool.query(
      `UPDATE equipment
       SET
         systemtype = $1, systemnummer = $2, systemnavn = $3, plassering = $4,
         betjener = $5, location = $6, notater = $7,
         cluster_id = $8,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $9
       RETURNING *;`,
      [
        systemtype, systemnummer, systemnavn, plassering,
        betjener, location, notater,
        clusterId ? parseInt(clusterId) : null,
        equipmentId
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Anlegg ikke funnet' });
    }

    console.log('Equipment updated by admin:', result.rows[0].id);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating equipment:', error);

    if (error.code === '23505') {
      return res.status(409).json({ error: 'Systemnummer er allerede i bruk' });
    }

    res.status(500).json({
      error: 'Kunne ikke oppdatere anlegg',
      details: error.message
    });
  }
});

module.exports = router;
