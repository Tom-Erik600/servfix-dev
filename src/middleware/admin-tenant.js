/**
 * 🔒 Admin tenant middleware — autentisering + tenant-isolasjon
 *
 * Logikk:
 *  - Admin med tenant_id i DB (req.session.tenantId) er bundet til den tenanten.
 *    x-tenant-id header som ikke matcher avvises med 403.
 *  - Admin UTEN tenant_id (super-admin) kan fritt bytte tenant via x-tenant-id.
 *  - query param ?tenantId ignoreres alltid (for lett å manipulere).
 *  - Hardkodet fallback til 'airtech' er fjernet — tenant MÅ finnes i session.
 */
module.exports = (req, res, next) => {
  // 1. Krev admin-session
  if (!req.session?.isAdmin) {
    return res.status(401).json({ error: 'Admin authentication required' });
  }

  const headerTenant = req.headers['x-tenant-id'];
  const loginTenant = req.session.tenantId; // Satt ved login fra admin_users.tenant_id

  // 2. Valider tenant-bytte mot adminens tildelte tenant
  if (headerTenant) {
    if (loginTenant && headerTenant !== loginTenant) {
      // Admin er bundet til én tenant — avvis forsøk på å bytte
      console.warn(`[ADMIN] Tenant access DENIED: admin ${req.session.adminId} tried '${headerTenant}', bound to '${loginTenant}'`);
      return res.status(403).json({ error: 'Ikke tilgang til denne tenanten' });
    }
    // Gyldig bytte (super-admin eller match)
    console.log(`[ADMIN] Tenant switch: ${req.session.selectedTenantId} → ${headerTenant}`);
    req.session.selectedTenantId = headerTenant;
  }

  // 3. Krev at tenant er valgt
  if (!req.session.selectedTenantId) {
    return res.status(400).json({ error: 'Ingen tenant valgt. Velg tenant først.' });
  }

  req.adminTenantId = req.session.selectedTenantId;
  next();
};
