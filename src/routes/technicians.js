const express = require('express');
const db = require('../config/database');

const router = express.Router();

// GET all technicians for the current tenant
router.get('/', async (req, res) => {
  try {
    // Use req.tenantId to get the correct tenant database connection
    // If req.tenantId is not set (e.g., for the login page), default to 'airtech'
    const pool = await db.getTenantConnection(req.tenantId || 'airtech');
    const result = await pool.query('SELECT id, name, initials FROM technicians WHERE is_active = true');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching technicians:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;