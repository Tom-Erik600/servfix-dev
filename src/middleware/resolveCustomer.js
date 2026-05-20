const db = require('../config/database');

module.exports = async (req, res, next) => {
  const tenantId = req.adminTenantId || req.session?.tenantId;

  if (!tenantId) {
    return res.status(401).json({ error: 'Tenant mangler' });
  }

  const customerId = req.query?.customerId ?? req.body?.customerId;
  if (customerId === undefined || customerId === null || customerId === '') {
    return res.status(400).json({ error: 'customerId mangler' });
  }

  try {
    const pool = await db.getTenantConnection(tenantId);
    const { rows } = await pool.query(
      `SELECT id
       FROM customers
       WHERE id::text = $1::text OR (external_source = 'tripletex' AND external_id = $1::text)
       ORDER BY CASE WHEN id::text = $1::text THEN 0 ELSE 1 END
       LIMIT 1`,
      [String(customerId)]
    );

    if (!rows[0]) {
      return res.status(404).json({ error: 'Kunde ikke funnet' });
    }

    req.resolvedCustomerId = rows[0].id;
    next();
  } catch (error) {
    next(error);
  }
};
