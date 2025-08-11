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
    
    // Only fetch active equipment for new orders
    const query = `
      SELECT * FROM equipment 
      WHERE customer_id = $1 
      AND (data->>'status' IS NULL OR data->>'status' = 'active')
      ORDER BY name ASC
    `;
    
    const result = await pool.query(query, [customerId]);
    
    // Transform data
    const equipment = result.rows.map(eq => ({
      ...eq,
      status: eq.data?.status || 'active',
      serviceStatus: eq.data?.serviceStatus || 'not_started',
      internalNotes: eq.data?.internalNotes || ''
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
    const { customerId, type, name, location, data } = req.body;
    
    // Valider påkrevde felter
    if (!customerId || !type || !name) {
      return res.status(400).json({
        error: 'Mangler påkrevde felter: customerId, type og name er påkrevd'
      });
    }
    
    // Generer ID - samme format som i technician equipment route
    const equipmentId = `EQUIP-${new Date().getFullYear()}-${Date.now()}`;
    
    const pool = await db.getTenantConnection(req.adminTenantId);

    // Merge data med standard verdier
    const equipmentData = {
      status: 'active',
      serviceStatus: 'not_started',
      ...data
    };

    const result = await pool.query(
      'INSERT INTO equipment (id, customer_id, type, name, location, data) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;',
      [equipmentId, customerId, type, name, location || name, equipmentData]
    );
    
    // Returner data i forventet format
    const equipment = result.rows[0];
    equipment.status = equipment.data?.status;
    equipment.serviceStatus = equipment.data?.serviceStatus;
    equipment.internalNotes = equipment.data?.internalNotes;
    
    console.log('Equipment created by admin:', equipment);
    res.status(201).json(equipment);
    
  } catch (error) {
    console.error('Error creating equipment:', error);
    
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Anlegg med denne ID finnes allerede' });
    }
    
    res.status(500).json({ error: 'Kunne ikke opprette anlegg' });
  }
});

module.exports = router;