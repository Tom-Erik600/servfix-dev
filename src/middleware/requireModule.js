// src/middleware/requireModule.js
//
// Middleware-factory som blokkerer routes hvis en modul-flag er av for denne tenant.
//
// Bruk:
//   const requireModule = require('../middleware/requireModule');
//   router.use(requireModule('enable_deviations_management'));
//   router.get('/noe', requireModule('enable_incidents'), handler);
//
// Rekkefølge for tenant-ID (matcher mønsteret i reports.js og images.js):
//   1. req.adminTenantId  — satt av admin-tenant.js middleware for /api/admin/*
//   2. req.session.tenantId — satt ved innlogging for teknikere og admin
//   3. req.tenantId       — satt av pre-auth middleware (hostname-basert)

const { loadModuleFlags } = require('../services/moduleFlags');

function requireModule(flagName) {
  return async (req, res, next) => {
    const tenantId = req.adminTenantId
      || req.session?.tenantId
      || req.tenantId;

    if (!tenantId) {
      return res.status(401).json({ error: 'Ikke autentisert — mangler tenant' });
    }

    try {
      const flags = await loadModuleFlags(tenantId);

      if (!flags[flagName]) {
        console.log(`🔒 Modul '${flagName}' er av for tenant '${tenantId}'`);
        return res.status(403).json({
          error: `Modulen '${flagName}' er ikke aktivert for denne tenant`,
          module: flagName,
        });
      }

      next();
    } catch (err) {
      console.error(`❌ requireModule('${flagName}') feilet for tenant '${tenantId}':`, err.message);
      return res.status(500).json({ error: 'Server error — module check failed' });
    }
  };
}

module.exports = requireModule;
