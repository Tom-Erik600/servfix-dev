const express = require('express');
const db = require('../config/database');

const router = express.Router();

// GET all checklist templates
router.get('/', async (req, res) => {
  try {
    // Assuming checklist templates are stored in the tenant database (airtech_db)
    const pool = await db.getTenantConnection(req.tenantId || 'airtech');
    const result = await pool.query('SELECT * FROM checklist_templates');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching checklist templates:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;