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
// GET all orders
router.get('/', async (req, res) => {
  try {
    const pool = await db.getTenantConnection(req.adminTenantId);
    const result = await pool.query('SELECT * FROM orders');
    
    // Legg til orderNumber for frontend
    const ordersWithNumber = result.rows.map(order => ({
      ...order,
      orderNumber: `SO-${order.id.split('-')[1]}-${order.id.split('-')[2].slice(-6)}`
    }));
    
    res.json(ordersWithNumber);
  } catch (error) {
    console.error(`Error fetching orders:`, error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { customerId, customerName, description, serviceType, technicianId, scheduledDate, customerData } = req.body;
    
    // Bruk RIKTIG ID-format
    const orderId = `PROJ-${new Date().getFullYear()}-${Date.now()}`;
    
    // Valider påkrevde felter
    if (!customerId || !customerName) {
      return res.status(400).json({ error: 'customerId og customerName er påkrevd' });
    }

    const pool = await db.getTenantConnection(req.adminTenantId);
    
    // Opprett customer_data objekt hvis det ikke er sendt
    const customer_data = customerData || {
      id: customerId,
      name: customerName,
      snapshot_date: new Date().toISOString()
    };
    
    // Oppdatert INSERT med customer_data kolonne
    const result = await pool.query(
      `INSERT INTO orders (
        id, customer_id, customer_name, customer_data, description, 
        service_type, technician_id, scheduled_date, status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [orderId, customerId, customerName, JSON.stringify(customer_data), description, 
       serviceType || 'Generell service', technicianId, 
       scheduledDate, technicianId ? 'scheduled' : 'pending']
    );
    
    // Legg til orderNumber for frontend
    result.rows[0].orderNumber = `SO-${orderId.split('-')[1]}-${orderId.split('-')[2].slice(-6)}`;
    
    res.status(201).json(result.rows[0]);
    
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;