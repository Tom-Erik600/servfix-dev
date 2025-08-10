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

module.exports = router;