const express = require('express');
const router = express.Router();
const db = require('../../config/database');
const adminTenant = require('../../middleware/admin-tenant');

// 🔒 Admin auth + tenant-isolasjon
router.use(adminTenant);

// GET alle cluster for en kunde (inkl. antall anlegg per cluster)
router.get('/', async (req, res) => {
  const { customerId } = req.query;

  if (!customerId) {
    return res.status(400).json({ error: 'customerId er påkrevd' });
  }

  console.log(`📦 [CLUSTERS] GET clusters for customer ${customerId}`);

  try {
    const pool = await db.getTenantConnection(req.adminTenantId);

    const result = await pool.query(
      `SELECT
         ec.id,
         ec.customer_id,
         ec.name,
         ec.notes,
         ec.tripletex_project_id,
         ec.tripletex_project_name,
         ec.created_at,
         COUNT(e.id) AS equipment_count
       FROM equipment_clusters ec
       LEFT JOIN equipment e ON e.cluster_id = ec.id AND e.status = 'active'
       WHERE ec.customer_id = $1
       GROUP BY ec.id
       ORDER BY ec.name ASC`,
      [parseInt(customerId)]
    );

    const clusters = result.rows.map(row => ({
      id: row.id,
      customerId: row.customer_id,
      name: row.name,
      notes: row.notes || null,
      tripletexProjectId: row.tripletex_project_id || null,
      tripletexProjectName: row.tripletex_project_name || null,
      equipmentCount: parseInt(row.equipment_count),
      createdAt: row.created_at
    }));

    res.json(clusters);
  } catch (error) {
    console.error('❌ [CLUSTERS] Error fetching clusters:', error.message);
    res.status(500).json({ error: 'Kunne ikke hente cluster', details: error.message });
  }
});

// POST opprett nytt cluster
router.post('/', async (req, res) => {
  const { customerId, name, notes, tripletexProjectId, tripletexProjectName } = req.body;

  if (!customerId || !name || !name.trim()) {
    return res.status(400).json({ error: 'customerId og name er påkrevd' });
  }

  console.log(`📦 [CLUSTERS] POST ny cluster "${name}" for customer ${customerId}`);

  try {
    const pool = await db.getTenantConnection(req.adminTenantId);

    const result = await pool.query(
      `INSERT INTO equipment_clusters
         (customer_id, name, notes, tripletex_project_id, tripletex_project_name)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        parseInt(customerId),
        name.trim(),
        notes || null,
        tripletexProjectId || null,
        tripletexProjectName || null
      ]
    );

    const cluster = result.rows[0];
    console.log(`✅ [CLUSTERS] Cluster opprettet: id=${cluster.id} name="${cluster.name}"`);

    res.status(201).json({
      id: cluster.id,
      customerId: cluster.customer_id,
      name: cluster.name,
      notes: cluster.notes,
      tripletexProjectId: cluster.tripletex_project_id,
      tripletexProjectName: cluster.tripletex_project_name,
      equipmentCount: 0,
      createdAt: cluster.created_at
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: `Et cluster med navnet "${name.trim()}" finnes allerede for denne kunden` });
    }
    console.error('❌ [CLUSTERS] Error creating cluster:', error.message);
    res.status(500).json({ error: 'Kunne ikke opprette cluster', details: error.message });
  }
});

// PUT oppdater cluster (navn, noter, prosjektreferanse)
router.put('/:clusterId', async (req, res) => {
  const { clusterId } = req.params;
  const { name, notes, tripletexProjectId, tripletexProjectName } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'name er påkrevd' });
  }

  console.log(`📦 [CLUSTERS] PUT cluster ${clusterId} -> "${name}"`);

  try {
    const pool = await db.getTenantConnection(req.adminTenantId);

    const result = await pool.query(
      `UPDATE equipment_clusters
       SET
         name = $1,
         notes = $2,
         tripletex_project_id = $3,
         tripletex_project_name = $4,
         updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [
        name.trim(),
        notes || null,
        tripletexProjectId || null,
        tripletexProjectName || null,
        parseInt(clusterId)
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Cluster ikke funnet' });
    }

    const cluster = result.rows[0];
    console.log(`✅ [CLUSTERS] Cluster oppdatert: id=${cluster.id}`);

    res.json({
      id: cluster.id,
      customerId: cluster.customer_id,
      name: cluster.name,
      notes: cluster.notes,
      tripletexProjectId: cluster.tripletex_project_id,
      tripletexProjectName: cluster.tripletex_project_name,
      updatedAt: cluster.updated_at
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: `Et cluster med navnet "${name.trim()}" finnes allerede for denne kunden` });
    }
    console.error('❌ [CLUSTERS] Error updating cluster:', error.message);
    res.status(500).json({ error: 'Kunne ikke oppdatere cluster', details: error.message });
  }
});

// DELETE slett cluster (anlegg mister cluster_id via ON DELETE SET NULL)
router.delete('/:clusterId', async (req, res) => {
  const { clusterId } = req.params;

  console.log(`📦 [CLUSTERS] DELETE cluster ${clusterId}`);

  try {
    const pool = await db.getTenantConnection(req.adminTenantId);

    // Tell antall anlegg som vil miste cluster-kobling
    const countResult = await pool.query(
      `SELECT COUNT(*) AS count FROM equipment WHERE cluster_id = $1`,
      [parseInt(clusterId)]
    );
    const affectedCount = parseInt(countResult.rows[0].count);

    const result = await pool.query(
      `DELETE FROM equipment_clusters WHERE id = $1 RETURNING id, name`,
      [parseInt(clusterId)]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Cluster ikke funnet' });
    }

    console.log(`✅ [CLUSTERS] Cluster "${result.rows[0].name}" slettet. ${affectedCount} anlegg fikk cluster_id = NULL`);

    res.json({
      message: `Cluster slettet. ${affectedCount} anlegg er nå uten cluster.`,
      deletedId: result.rows[0].id,
      affectedEquipmentCount: affectedCount
    });
  } catch (error) {
    console.error('❌ [CLUSTERS] Error deleting cluster:', error.message);
    res.status(500).json({ error: 'Kunne ikke slette cluster', details: error.message });
  }
});

module.exports = router;
