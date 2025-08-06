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
    // Transform data (forenklet)
    equipment.status = equipment.data?.status || 'active';
    equipment.serviceStatus = equipment.data?.serviceStatus || 'not_started';
    equipment.internalNotes = equipment.data?.internalNotes || '';
    
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
    // Parameter for å inkludere deaktiverte anlegg (for historiske ordre)
    const includeInactive = req.query.includeInactive === 'true';
    
    const pool = await db.getTenantConnection(req.session.tenantId);
    
    let query, params;
    if (includeInactive) {
      // For historiske ordre - vis alle anlegg
      console.log('Including inactive equipment for customer:', customerId);
      query = 'SELECT * FROM equipment WHERE customer_id = $1';
      params = [customerId];
    } else {
      // For nye ordre - vis kun aktive anlegg (default)
      console.log('Filtering to active equipment only for customer:', customerId);
      query = `SELECT * FROM equipment WHERE customer_id = $1 AND (data->>'status' IS NULL OR data->>'status' = 'active')`;
      params = [customerId];
    }
    
    const result = await pool.query(query, params);
    console.log(`Found ${result.rows.length} equipment for customer ${customerId}`);

    // Transform data to include properties from the JSON 'data' field
    const transformedRows = result.rows.map(equipment => {
        return {
            ...equipment,
            status: equipment.data?.status || 'active',
            serviceStatus: equipment.data?.serviceStatus || 'not_started',
            internalNotes: equipment.data?.internalNotes || ''
        };
    });

    res.json(transformedRows);
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
    const { customerId, type, name, internalNotes, status, serviceStatus } = req.body;
    
    // Valider påkrevde felter
    if (!customerId || !type || !name) {
        return res.status(400).json({
            error: 'Mangler påkrevde felter: customerId, type og name er påkrevd'
        });
    }
    
    // GENERER ID - samme format som orders
    const equipmentId = `EQUIP-${new Date().getFullYear()}-${Date.now()}`;
    
    const pool = await db.getTenantConnection(req.session.tenantId);

    // Lagre ekstra data i JSONB-feltet (forenklet)
    const extraData = {
      status: status || 'active',
      serviceStatus: serviceStatus || 'not_started',
      internalNotes: internalNotes || ''
    };

    const result = await pool.query(
      'INSERT INTO equipment (id, customer_id, type, name, location, data) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;',
      [equipmentId, customerId, type, name, name, extraData]
    );
    
    // Returner data i forventet format
    const equipment = result.rows[0];
    equipment.status = equipment.data?.status;
    equipment.serviceStatus = equipment.data?.serviceStatus;
    equipment.internalNotes = equipment.data?.internalNotes;
    
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
      ...(updateData.internalNotes && { internalNotes: updateData.internalNotes })
    };
    
    // Oppdater i databasen
    const updateResult = await pool.query(
      `UPDATE service_reports 
       SET checklist_data = $1, 
           products_used = $2, 
           additional_work = $3,
           photos = $4
           ${reportData.status ? ', status = $6' : ''}
       WHERE id = $5 
       RETURNING *`,
      reportData.status ? 
        [
          JSON.stringify(dbData.checklist_data),
          JSON.stringify(dbData.products_used),
          JSON.stringify(dbData.additional_work),
          dbData.photos,
          reportId,
          reportData.status
        ] :
        [
          JSON.stringify(dbData.checklist_data),
          JSON.stringify(dbData.products_used),
          JSON.stringify(dbData.additional_work),
          dbData.photos,
          reportId
        ]
    );
    
    const equipment = updateResult.rows[0];
    
    // Returner i forventet format
    equipment.status = equipment.data?.status || 'active';
    equipment.serviceStatus = equipment.data?.serviceStatus || 'not_started';
    equipment.internalNotes = equipment.data?.internalNotes || '';
    
    console.log('Equipment updated:', equipment.id);
    res.json(equipment);
    
  } catch (error) {
    console.error('Error updating equipment:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE equipment (deactivate, not delete)
router.delete('/:equipmentId', async (req, res) => {
  console.log('Equipment DELETE request (deactivate):', {
    equipmentId: req.params.equipmentId,
    body: req.body,
    sessionTechnicianId: req.session.technicianId
  });
  
  try {
    const { equipmentId } = req.params;
    const { deactivationReason } = req.body;
    
    const pool = await db.getTenantConnection(req.session.tenantId);
    
    // Hent eksisterende equipment
    const existing = await pool.query('SELECT * FROM equipment WHERE id = $1', [equipmentId]);
    
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Equipment not found' });
    }
    
    const currentData = existing.rows[0].data || {};
    
    // Oppdater data med inactive status og deaktiveringsinformasjon
    const updatedData = {
      ...currentData,
      status: 'inactive',
      deactivatedAt: new Date().toISOString(),
      deactivationReason: deactivationReason || 'Ikke oppgitt',
      deactivatedBy: req.session.technicianId
    };
    
    // Oppdater equipment med ny status
    const result = await pool.query(
      'UPDATE equipment SET data = $1 WHERE id = $2 RETURNING *',
      [updatedData, equipmentId]
    );
    
    const updatedEquipment = result.rows[0];
    
    // Transform data for frontend (beholder eksisterende format)
    updatedEquipment.status = updatedEquipment.data?.status;
    updatedEquipment.internalNotes = updatedEquipment.data?.internalNotes;
    updatedEquipment.serviceStatus = updatedEquipment.data?.serviceStatus;
    
    console.log('Equipment deactivated:', equipmentId);
    res.json({ 
      message: 'Equipment deactivated successfully', 
      equipment: updatedEquipment 
    });
    
  } catch (error) {
    console.error('Error deactivating equipment:', error);
    res.status(500).json({ error: 'Server error during deactivation' });
  }
});

// PUT update equipment service status
router.put('/:equipmentId/status', async (req, res) => {
  console.log('Equipment status update request:', {
    equipmentId: req.params.equipmentId,
    body: req.body,
    sessionTechnicianId: req.session.technicianId
  });
  
  try {
    const { equipmentId } = req.params;
    const { serviceStatus, orderId } = req.body;
    
    // Krev orderId
    if (!orderId) {
      return res.status(400).json({ 
        error: 'orderId er påkrevd for å oppdatere status' 
      });
    }
    
    // Valider serviceStatus
    const validStatuses = ['not_started', 'in_progress', 'completed'];
    if (!serviceStatus || !validStatuses.includes(serviceStatus)) {
      return res.status(400).json({ 
        error: 'Ugyldig serviceStatus. Må være: not_started, in_progress, eller completed' 
      });
    }
    
    const pool = await db.getTenantConnection(req.session.tenantId);
    
    // Oppdater service_reports status, IKKE equipment
    await pool.query(
      `UPDATE service_reports 
       SET status = $1 
       WHERE equipment_id = $2 AND order_id = $3`,
      [serviceStatus, equipmentId, orderId]
    );
    
    console.log(`✅ Service report status for equipment ${equipmentId} updated to: ${serviceStatus}`);
    res.json({ 
      message: `Status oppdatert til ${serviceStatus}`,
      serviceStatus: serviceStatus
    });
    
  } catch (error) {
    console.error('Error updating service report status:', error);
    res.status(500).json({ 
      error: 'Server feil ved oppdatering av status',
      details: error.message 
    });
  }
});

// Complete equipment service
router.post('/:equipmentId/complete', async (req, res) => {
  console.log('Equipment complete request:', {
    equipmentId: req.params.equipmentId,
    body: req.body
  });
  
  try {
    const { equipmentId } = req.params;
    const { orderId, reportId } = req.body;
    
    if (!orderId) {
      return res.status(400).json({ 
        error: 'orderId er påkrevd' 
      });
    }
    
    const pool = await db.getTenantConnection(req.session.tenantId);
    
    // Start en transaksjon for å sikre at begge tabeller oppdateres
    await pool.query('BEGIN');
    
    try {
      // 1. Oppdater service_reports status til completed
      const reportResult = await pool.query(
        `UPDATE service_reports 
         SET status = 'completed' 
         WHERE equipment_id = $1 AND order_id = $2
         RETURNING *`,
        [equipmentId, orderId]
      );
      
      if (reportResult.rows.length === 0) {
        throw new Error('Service report ikke funnet');
      }
      
      // 2. Oppdater equipment data med serviceStatus
      const equipmentResult = await pool.query(
        `UPDATE equipment 
         SET data = jsonb_set(
           COALESCE(data, '{}')::jsonb, 
           '{serviceStatus}', 
           '"completed"'
         )
         WHERE id = $1
         RETURNING *`,
        [equipmentId]
      );
      
      if (equipmentResult.rows.length === 0) {
        throw new Error('Equipment ikke funnet');
      }
      
      // Commit transaksjonen
      await pool.query('COMMIT');
      
      console.log(`✅ Equipment ${equipmentId} service completed - both tables updated`);
      
      res.json({ 
        message: 'Anlegg ferdigstilt',
        serviceStatus: 'completed',
        report: reportResult.rows[0],
        equipment: equipmentResult.rows[0]
      });
      
    } catch (error) {
      // Rollback ved feil
      await pool.query('ROLLBACK');
      throw error;
    }
    
  } catch (error) {
    console.error('Error completing equipment service:', error);
    
    if (error.message === 'Service report ikke funnet') {
      return res.status(404).json({ error: error.message });
    } else if (error.message === 'Equipment ikke funnet') {
      return res.status(404).json({ error: error.message });
    }
    
    res.status(500).json({ 
      error: 'Kunne ikke ferdigstille anlegg',
      details: error.message 
    });
  }
});

module.exports = router;