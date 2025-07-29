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
  console.log('Equipment ID:', req.params.equipmentId);
  
  try {
    const { equipmentId } = req.params;
    const pool = await db.getTenantConnection(req.session.tenantId);
    const result = await pool.query('SELECT * FROM equipment WHERE id = $1;', [equipmentId]);
    
    console.log('Query result rows:', result.rows.length);
    
    if (result.rows.length === 0) {
      console.log('No equipment found with ID:', equipmentId);
      return res.status(404).json({ error: 'Equipment not found' });
    }
    
    const equipment = result.rows[0];
    // Transform data
    equipment.systemNumber = equipment.data?.systemNumber || '';
    equipment.systemType = equipment.data?.systemType || '';
    equipment.operator = equipment.data?.operator || '';
    equipment.status = equipment.data?.status || 'active';
    equipment.serviceStatus = equipment.data?.serviceStatus || 'not_started';
    
    console.log('Returning equipment:', equipment.id);
    res.json(equipment);
  } catch (error) {
    console.error('Error in by-id endpoint:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Generelle routes ETTER
router.get('/:customerId', async (req, res) => {
  console.log('=== EQUIPMENT BY CUSTOMER ID ENDPOINT CALLED ===');
  try {
    const { customerId } = req.params;
    const pool = await db.getTenantConnection(req.session.tenantId);
    const result = await pool.query('SELECT * FROM equipment WHERE customer_id = $1;', [customerId]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching equipment:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST new equipment
router.post('/', async (req, res) => {
  console.log('Equipment POST request:', {
    body: req.body,
    sessionTechnicianId: req.session.technicianId,
    sessionTenantId: req.session.tenantId
  });
  
  try {
    const { customerId, type, name, systemNumber, systemType, operator, status, serviceStatus } = req.body;
    
    // Valider påkrevde felter
    if (!customerId || !type || !name) {
      return res.status(400).json({
        error: 'Mangler påkrevde felter: customerId, type og name er påkrevd'
      });
    }
    
    // GENERER ID - samme format som orders
    const equipmentId = `EQUIP-${new Date().getFullYear()}-${Date.now()}`;
    
    const pool = await db.getTenantConnection(req.session.tenantId);

    // Lagre ekstra data i JSONB-feltet
    const extraData = {
      systemNumber: systemNumber || '',
      systemType: systemType || '',
      operator: operator || '',
      status: status || 'active',
      serviceStatus: serviceStatus || 'not_started'
    };

    const result = await pool.query(
      'INSERT INTO equipment (id, customer_id, type, name, location, data) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;',
      [equipmentId, customerId, type, name, name, extraData]
    );
    
    // Returner data i forventet format
    const equipment = result.rows[0];
    equipment.systemNumber = equipment.data?.systemNumber;
    equipment.systemType = equipment.data?.systemType;
    equipment.operator = equipment.data?.operator;
    equipment.status = equipment.data?.status;
    equipment.serviceStatus = equipment.data?.serviceStatus;
    
    console.log('Equipment created:', equipment);
    res.status(201).json(equipment);
  } catch (error) {
    console.error('Error adding equipment:', error);
    
    if (error.code === '23505') {
      res.status(409).json({ error: 'Utstyr eksisterer allerede' });
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

// PUT update equipment
router.put('/:equipmentId', async (req, res) => {
  console.log('Equipment PUT request:', {
    equipmentId: req.params.equipmentId,
    body: req.body,
    sessionTechnicianId: req.session.technicianId
  });
  
  try {
    const { equipmentId } = req.params;
    const updateData = req.body;
    
    const pool = await db.getTenantConnection(req.session.tenantId);
    
    // Hent eksisterende equipment først
    const existingResult = await pool.query(
      'SELECT * FROM equipment WHERE id = $1',
      [equipmentId]
    );
    
    if (existingResult.rows.length === 0) {
      return res.status(404).json({ error: 'Equipment not found' });
    }
    
    const existing = existingResult.rows[0];
    
    // Merge eksisterende data med nye verdier
    const updatedData = {
      ...existing.data,
      ...(updateData.serviceStatus && { serviceStatus: updateData.serviceStatus }),
      ...(updateData.status && { status: updateData.status }),
      ...(updateData.systemNumber && { systemNumber: updateData.systemNumber }),
      ...(updateData.systemType && { systemType: updateData.systemType }),
      ...(updateData.operator && { operator: updateData.operator })
    };
    
    // Oppdater i databasen
    const updateResult = await pool.query(
      'UPDATE equipment SET data = $1 WHERE id = $2 RETURNING *',
      [updatedData, equipmentId]
    );
    
    const equipment = updateResult.rows[0];
    
    // Returner i forventet format
    equipment.systemNumber = equipment.data?.systemNumber || '';
    equipment.systemType = equipment.data?.systemType || '';
    equipment.operator = equipment.data?.operator || '';
    equipment.status = equipment.data?.status || 'active';
    equipment.serviceStatus = equipment.data?.serviceStatus || 'not_started';
    
    console.log('Equipment updated:', equipment.id);
    res.json(equipment);
    
  } catch (error) {
    console.error('Error updating equipment:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;