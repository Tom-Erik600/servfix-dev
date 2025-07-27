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

// Hent ALLE unike kunder fra orders (ikke filtrert på tekniker)
router.get('/', async (req, res) => {
  try {
    const pool = await db.getTenantConnection(req.session.tenantId);
    
    const result = await pool.query(
      `SELECT DISTINCT 
        customer_id as id,
        customer_name as name,
        customer_data
       FROM orders 
       WHERE customer_id IS NOT NULL
       ORDER BY customer_name`
    );
    
    const customers = result.rows.map(row => ({
      id: row.id,
      name: row.name || 'Ukjent kunde',
      ...(row.customer_data || {})
    }));
    
    res.json(customers);
    
  } catch (error) {
    console.error('Error fetching customers:', error);
    // Returner tom array i stedet for 500 for å holde appen kjørende
    res.json([]); 
  }
});

module.exports = router;