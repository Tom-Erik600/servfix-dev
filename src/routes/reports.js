const express = require('express');
const router = express.Router();
const db = require('../config/database');

// Hent alle servicerapporter for en gitt ordre
router.get('/:orderId', async (req, res) => {
  const { orderId } = req.params;
  const tenantId = req.tenantId;
  
  try {
    const pool = await db.getPool(tenantId);
    const result = await pool.query('SELECT * FROM service_reports WHERE order_id = $1', [orderId]);
    res.json(result.rows);
  } catch (error) {
    console.error(`[${tenantId}] Error fetching reports for order ${orderId}:`, error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;