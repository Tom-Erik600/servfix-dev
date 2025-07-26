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

// Hent alle kunder for pålogget tekniker
router.get('/', async (req, res) => {
  try {
    const pool = await db.getTenantConnection(req.session.tenantId);
    
    // For now, return an empty array as there's no direct link between technicians and customers
    // In a real app, you might fetch customers associated with the technician's orders or tenant.
    res.json([]);
    
  } catch (error) {
    console.error('Error fetching customers:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;