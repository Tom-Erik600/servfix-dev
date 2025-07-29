const express = require('express');
const db = require('../config/database');

const router = express.Router();

// Middleware - sjekk auth
router.use((req, res, next) => {
  if (!req.session.technicianId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
});

// Hent alle ordrer for pålogget tekniker
router.get('/', async (req, res) => {
  try {
    const pool = await db.getTenantConnection(req.session.tenantId);
    console.log('Fetching orders for technicianId:', req.session.technicianId);
    
    const result = await pool.query(
      `SELECT * FROM orders 
       WHERE technician_id = $1 
       ORDER BY scheduled_date DESC, scheduled_time DESC`,
      [req.session.technicianId]
    );
    
    // Legg til orderNumber for frontend
    const ordersWithNumber = result.rows.map(order => ({
      ...order,
      orderNumber: `SO-${order.id.split('-')[1]}-${order.id.split('-')[2].slice(-6)}`
    }));
    
    res.json(ordersWithNumber);
    
  } catch (error) {
    console.error('Error fetching all orders:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Hent dagens ordrer
router.get('/today', async (req, res) => {
  try {
    const pool = await db.getTenantConnection(req.session.tenantId);
    const today = new Date().toISOString().split('T')[0];
    
    const result = await pool.query(
      `SELECT * FROM orders 
       WHERE technician_id = $1 
       AND scheduled_date = $2
       ORDER BY scheduled_time`,
      [req.session.technicianId, today]
    );
    
    res.json(result.rows);
    
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET single order
router.get('/:id', async (req, res) => {
  try {
    const pool = await db.getTenantConnection(req.session.tenantId);
    const orderResult = await pool.query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
    
    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    const order = orderResult.rows[0];
    order.orderNumber = `SO-${order.id.split('-')[1]}-${order.id.split('-')[2].slice(-6)}`;

    // Fetch customer data
    const customer = {
      id: order.customer_id,
      name: order.customer_name,
      ...(order.customer_data || {})  // Spread eventuelle ekstra customer-data
    };

    // Fetch equipment data for the customer
    const equipmentResult = await pool.query(
        `SELECT 
            id, 
            customer_id, 
            type, 
            name, 
            location, 
            data,
            data->>'serviceStatus' as service_status,
            data->>'systemNumber' as system_number,
            data->>'systemType' as system_type,
            data->>'operator' as operator
        FROM equipment 
        WHERE customer_id = $1`,
        [order.customer_id || order.customerId]
    );

    // Transform equipment data
    const equipment = equipmentResult.rows.map(eq => ({
        id: eq.id,
        customerId: eq.customer_id,
        type: eq.type,
        name: eq.name,
        location: eq.location,
        serviceStatus: eq.service_status || 'not_started',
        systemNumber: eq.system_number || '',
        systemType: eq.system_type || '',
        operator: eq.operator || '',
        data: eq.data
    }));

    // Fetch technician data (assuming technicianId is available in order or session)
    const technicianResult = await pool.query('SELECT * FROM technicians WHERE id = $1', [order.technician_id]);
    const technician = technicianResult.rows[0] || {};
    
    res.json({
      order: order,
      customer: customer,
      equipment: equipment,
      technician: technician,
      quotes: [] // Assuming quotes are fetched separately or not yet implemented
    });
    
  } catch (error) {
    console.error('Error fetching order:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;