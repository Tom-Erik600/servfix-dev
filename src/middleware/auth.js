/**
 * Felles auth-hjelpere for tekniker-routes.
 *
 * requireTenant — sjekker at req.session.tenantId er satt.
 * Brukes som middleware etter innloggingssjekk, slik at manglende
 * tenant gir en tydelig 401 i stedet for en ukontrollert 500.
 *
 * Bruk:
 *   const { requireTenant } = require('../middleware/auth');
 *   router.use(requireTenant);
 */

module.exports.requireTenant = (req, res, next) => {
  const tenantId = req.session?.tenantId;
  if (!tenantId) {
    console.error(`[requireTenant] Mangler tenantId i session — path: ${req.path}`);
    return res.status(401).json({ error: 'Ikke autentisert — mangler tenant' });
  }
  next();
};
