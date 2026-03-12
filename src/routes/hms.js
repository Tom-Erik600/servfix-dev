// src/routes/hms.js
const express = require('express');
const router = express.Router();
const db = require('../config/database');
const SjaPdfGenerator = require('../services/sjaPdfGenerator');

// Auth middleware — tekniker eller admin
router.use((req, res, next) => {
  if (!req.session?.technicianId && !req.session?.isAdmin) {
    return res.status(401).json({ error: 'Ikke autentisert' });
  }
  next();
});

// ─── SJA ────────────────────────────────────────────────────

// POST /api/hms/sja — Opprett SJA
router.post('/sja', async (req, res) => {
  try {
    const tenantId = req.adminTenantId || req.session.tenantId;
    const pool = await db.getTenantConnection(tenantId);
    const {
      order_id,
      job_description,
      location,
      identified_risks,
      safety_measures,
      approved_by,
      signature_data,
      status
    } = req.body;

    const technicianId = req.session.technicianId || null;

    // orders.id er VARCHAR — send order_id som string, ikke parseInt()
    const result = await pool.query(
      `INSERT INTO hms_sja
        (order_id, technician_id, job_description, location, identified_risks,
         safety_measures, approved_by, signature_data, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [order_id || null, technicianId, job_description, location,
       identified_risks, safety_measures, approved_by, signature_data,
       status || 'draft']
    );

    res.json({ success: true, sja: result.rows[0] });
  } catch (error) {
    console.error('Feil ved lagring av SJA:', error);
    res.status(500).json({ error: 'Kunne ikke lagre SJA', details: error.message });
  }
});

// GET /api/hms/sja — Hent alle SJA (admin/oversikt)
router.get('/sja', async (req, res) => {
  try {
    const tenantId = req.adminTenantId || req.session.tenantId;
    const pool = await db.getTenantConnection(tenantId);
    const result = await pool.query(
      `SELECT s.*,
              COALESCE(o.tripletex_order_id::varchar, o.id) AS order_number,
              o.description AS order_description
       FROM hms_sja s
       LEFT JOIN orders o ON s.order_id = o.id
       ORDER BY s.created_at DESC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Feil ved henting av SJA:', error);
    res.status(500).json({ error: 'Kunne ikke hente SJA' });
  }
});

// GET /api/hms/sja/order/:orderId — Hent SJA for en spesifikk ordre
router.get('/sja/order/:orderId', async (req, res) => {
  try {
    const tenantId = req.adminTenantId || req.session.tenantId;
    const pool = await db.getTenantConnection(tenantId);
    // orders.id er VARCHAR — ikke parseInt()
    const result = await pool.query(
      `SELECT * FROM hms_sja WHERE order_id = $1 ORDER BY created_at DESC`,
      [req.params.orderId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Feil ved henting av SJA for ordre:', error);
    res.status(500).json({ error: 'Kunne ikke hente SJA' });
  }
});

// GET /api/hms/sja/:id — Hent enkelt SJA
router.get('/sja/:id', async (req, res) => {
  try {
    const tenantId = req.adminTenantId || req.session.tenantId;
    const pool = await db.getTenantConnection(tenantId);
    const result = await pool.query(
      `SELECT * FROM hms_sja WHERE id = $1`,
      [parseInt(req.params.id)]  // hms_sja.id er SERIAL (integer)
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'SJA ikke funnet' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Feil ved henting av SJA:', error);
    res.status(500).json({ error: 'Kunne ikke hente SJA' });
  }
});

// DELETE /api/hms/sja/:id — Slett SJA
router.delete('/sja/:id', async (req, res) => {
  try {
    const tenantId = req.adminTenantId || req.session.tenantId;
    const pool = await db.getTenantConnection(tenantId);
    const result = await pool.query(
      `DELETE FROM hms_sja WHERE id = $1 RETURNING id`,
      [parseInt(req.params.id)]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'SJA ikke funnet' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Feil ved sletting av SJA:', error);
    res.status(500).json({ error: 'Kunne ikke slette SJA' });
  }
});

// GET /api/hms/sja/:id/pdf — Generer og hent PDF for en SJA
// Generering skjer kun i GCP — returnerer feil lokalt (Puppeteer not available on Windows)
router.get('/sja/:id/pdf', async (req, res) => {
  try {
    const tenantId = req.adminTenantId || req.session.tenantId;
    const sjaId = parseInt(req.params.id);

    // Sjekk om PDF allerede er generert
    const pool = await db.getTenantConnection(tenantId);
    const existing = await pool.query(
      `SELECT pdf_url FROM hms_sja WHERE id = $1`,
      [sjaId]
    );
    if (!existing.rows.length) {
      return res.status(404).json({ error: 'SJA ikke funnet' });
    }

    // Hvis PDF allerede finnes — returner URL direkte
    if (existing.rows[0].pdf_url) {
      return res.json({ success: true, pdfUrl: existing.rows[0].pdf_url });
    }

    // Generer ny PDF
    console.log(`📄 Generating SJA PDF for #${sjaId}...`);
    const generator = new SjaPdfGenerator();
    const { pdfUrl } = await generator.generate(sjaId, tenantId);

    res.json({ success: true, pdfUrl });
  } catch (error) {
    console.error('Feil ved generering av SJA PDF:', error);
    res.status(500).json({
      error: 'Kunne ikke generere PDF',
      details: error.message
    });
  }
});

// GET /api/hms/sja/:id/pdf/regenerate — Tving regenerering av PDF
router.get('/sja/:id/pdf/regenerate', async (req, res) => {
  try {
    const tenantId = req.adminTenantId || req.session.tenantId;
    const sjaId = parseInt(req.params.id);

    // Nullstill eksisterende PDF-URL først
    const pool = await db.getTenantConnection(tenantId);
    await pool.query(`UPDATE hms_sja SET pdf_url = NULL WHERE id = $1`, [sjaId]);

    // Generer på nytt
    console.log(`📄 Regenerating SJA PDF for #${sjaId}...`);
    const generator = new SjaPdfGenerator();
    const { pdfUrl } = await generator.generate(sjaId, tenantId);

    res.json({ success: true, pdfUrl });
  } catch (error) {
    console.error('Feil ved regenerering av SJA PDF:', error);
    res.status(500).json({
      error: 'Kunne ikke regenerere PDF',
      details: error.message
    });
  }
});

// ─── ROS ────────────────────────────────────────────────────

// POST /api/hms/ros — Opprett ROS
router.post('/ros', async (req, res) => {
  try {
    const tenantId = req.adminTenantId || req.session.tenantId;
    const pool = await db.getTenantConnection(tenantId);
    const { title, project_type, form_data, status } = req.body;
    const createdBy = req.session.adminId || req.session.technicianId || 'ukjent';

    const result = await pool.query(
      `INSERT INTO hms_ros (created_by, title, project_type, form_data, status)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [createdBy, title, project_type, JSON.stringify(form_data || {}), status || 'draft']
    );
    res.json({ success: true, ros: result.rows[0] });
  } catch (error) {
    console.error('Feil ved lagring av ROS:', error);
    res.status(500).json({ error: 'Kunne ikke lagre ROS', details: error.message });
  }
});

// GET /api/hms/ros — Hent alle ROS
router.get('/ros', async (req, res) => {
  try {
    const tenantId = req.adminTenantId || req.session.tenantId;
    const pool = await db.getTenantConnection(tenantId);
    const result = await pool.query(
      `SELECT * FROM hms_ros ORDER BY updated_at DESC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Feil ved henting av ROS:', error);
    res.status(500).json({ error: 'Kunne ikke hente ROS' });
  }
});

// GET /api/hms/ros/:id — Hent enkelt ROS
router.get('/ros/:id', async (req, res) => {
  try {
    const tenantId = req.adminTenantId || req.session.tenantId;
    const pool = await db.getTenantConnection(tenantId);
    const result = await pool.query(
      `SELECT * FROM hms_ros WHERE id = $1`,
      [parseInt(req.params.id)]  // hms_ros.id er SERIAL (integer)
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'ROS ikke funnet' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Feil ved henting av ROS:', error);
    res.status(500).json({ error: 'Kunne ikke hente ROS' });
  }
});

// PUT /api/hms/ros/:id — Oppdater ROS
router.put('/ros/:id', async (req, res) => {
  try {
    const tenantId = req.adminTenantId || req.session.tenantId;
    const pool = await db.getTenantConnection(tenantId);
    const { title, project_type, form_data, status } = req.body;

    const result = await pool.query(
      `UPDATE hms_ros
       SET title = $1, project_type = $2, form_data = $3, status = $4,
           updated_at = NOW(), version = version + 1
       WHERE id = $5
       RETURNING *`,
      [title, project_type, JSON.stringify(form_data || {}), status || 'draft', parseInt(req.params.id)]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'ROS ikke funnet' });
    }
    res.json({ success: true, ros: result.rows[0] });
  } catch (error) {
    console.error('Feil ved oppdatering av ROS:', error);
    res.status(500).json({ error: 'Kunne ikke oppdatere ROS', details: error.message });
  }
});

// DELETE /api/hms/ros/:id — Slett ROS
router.delete('/ros/:id', async (req, res) => {
  try {
    const tenantId = req.adminTenantId || req.session.tenantId;
    const pool = await db.getTenantConnection(tenantId);
    const result = await pool.query(
      `DELETE FROM hms_ros WHERE id = $1 RETURNING id`,
      [parseInt(req.params.id)]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'ROS ikke funnet' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Feil ved sletting av ROS:', error);
    res.status(500).json({ error: 'Kunne ikke slette ROS' });
  }
});

module.exports = router;
