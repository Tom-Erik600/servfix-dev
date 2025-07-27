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
    const result = await pool.query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    // Legg til orderNumber
    const order = result.rows[0];
    order.orderNumber = `SO-${order.id.split('-')[1]}-${order.id.split('-')[2].slice(-6)}`;
    
    res.json({
      order: order,
      customer: {}, // Hent kunde-data hvis nødvendig
      equipment: [], // Hent utstyr hvis nødvendig
      technician: {} // Hent tekniker-data hvis nødvendig
    });
    
  } catch (error) {
    console.error('Error fetching order:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;