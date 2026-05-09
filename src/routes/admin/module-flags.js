// src/routes/admin/module-flags.js
//
// GET /api/admin/module-flags
// Returnerer module_flags for innlogget admin sin tenant (kun lesing).
// Beskyttet av admin-tenant.js-middleware som settes opp i server.js.

const express = require('express');
const { loadModuleFlags } = require('../../services/moduleFlags');

const router = express.Router();

// GET /api/admin/module-flags
router.get('/', async (req, res) => {
  // admin-tenant.js-middleware kjøres allerede av server.js for denne route,
  // men vi dobbelsjekker eksplisitt for ekstra sikkerhet.
  if (!req.session?.isAdmin) {
    return res.status(401).json({ error: 'Ikke autentisert' });
  }

  // req.adminTenantId settes av admin-tenant.js-middleware (fra session.selectedTenantId)
  const tenantId = req.adminTenantId || req.session?.tenantId;
  if (!tenantId) {
    return res.status(400).json({ error: 'Mangler tenantId — velg tenant først' });
  }

  try {
    const flags = await loadModuleFlags(tenantId);
    res.json({ flags, tenantId });
  } catch (err) {
    console.error('❌ Error loading module flags:', err);
    res.status(500).json({ error: 'Kunne ikke laste module flags' });
  }
});

module.exports = router;
