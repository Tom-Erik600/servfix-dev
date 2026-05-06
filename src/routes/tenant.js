// src/routes/tenant.js — Tenant-spesifikke data for innlogget bruker
// Montert som /api/tenant i app.js

const express = require('express');
const router = express.Router();
const { loadTenantSettings } = require('./images');

// Auth: krever innlogget admin eller tekniker med tenantId
router.use((req, res, next) => {
  if (!req.session?.technicianId && !req.session?.isAdmin) {
    return res.status(401).json({ error: 'Ikke autentisert' });
  }
  if (!req.session?.tenantId) {
    return res.status(401).json({ error: 'Ikke autentisert — mangler tenant' });
  }
  next();
});

// GET /api/tenant/flags — returner module_flags for innlogget tenant
// Frontend cacher i sessionStorage under 'tenant_flags'
router.get('/flags', async (req, res) => {
  try {
    // Bypass cache: flagg må være ferskeste mulige (admin endrer dem live)
    const settings = await loadTenantSettings(req.session.tenantId, { bypassCache: true });
    res.set('Cache-Control', 'no-store');
    res.json(settings.module_flags || {});
  } catch (err) {
    console.error('Error fetching tenant flags:', err);
    res.status(500).json({ error: 'Kunne ikke hente flagg' });
  }
});

module.exports = router;
