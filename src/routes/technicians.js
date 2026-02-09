const express = require('express');
const db = require('../config/database');

const router = express.Router();

// GET all technicians for the current tenant
router.get('/', async (req, res) => {
  try {
    // Use req.tenantId from middleware (set in app.js)
    const tenantId = req.tenantId;
    if (!tenantId) {
      console.error('❌ Missing tenantId from middleware');
      return res.status(500).json({ error: 'Server configuration error' });
    }
    const pool = await db.getTenantConnection(tenantId);
    const result = await pool.query('SELECT id, name, initials, stilling FROM technicians WHERE is_active = true');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching technicians:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;