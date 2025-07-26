const express = require('express');
const router = express.Router();
const db = require('../../config/database');

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

// GET all orders for the selected tenant
router.get('/', async (req, res) => {
  try {
    const pool = await db.getTenantConnection(req.adminTenantId);
    const result = await pool.query('SELECT * FROM orders');
    res.json(result.rows);
  } catch (error) {
    console.error(`[${req.adminTenantId}] Error fetching orders:`, error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST new order
router.post('/', async (req, res) => {
  try {
    const { customerId, description, serviceType, technicianId, scheduledDate, status } = req.body;
    const pool = await db.getTenantConnection(req.adminTenantId);
    
    const result = await pool.query(
      `INSERT INTO orders (
        customerid, description, service_type, technician_id, scheduled_date, status
       ) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [customerId, description, serviceType, technicianId, scheduledDate, status]
    );
    
    res.status(201).json(result.rows[0]);
    
  } catch (error) {
    console.error(`[${req.adminTenantId}] Error creating order:`, error);
    res.status(500).json({ error: 'Internal server error when creating order' });
  }
});

module.exports = router;