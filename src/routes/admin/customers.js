const express = require('express');
const router = express.Router();
const db = require('../../config/database');
const tripletexService = require('../../services/tripletexService');

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

// GET all customers from Tripletex
router.get('/', async (req, res) => {
  try {
    const customers = await tripletexService.getCustomers();
    res.json(customers);
  } catch (error) {
    console.error(`[${req.adminTenantId}] Error fetching customers from Tripletex:`, error);
    res.status(500).json({ error: 'Internal server error when fetching customers from Tripletex' });
  }
});

module.exports = router;