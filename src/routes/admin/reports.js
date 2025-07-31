// src/routes/admin/reports.js - Fixed with PDF serving
const express = require('express');
const router = express.Router();
const db = require('../../config/database');
const path = require('path');
const fs = require('fs').promises;

// Middleware for admin autentisering og tenant-håndtering
router.use((req, res, next) => {
  if (!req.session.isAdmin) {
    return res.status(401).json({ error: 'Admin authentication required' });
  }
  
  req.adminTenantId = req.headers['x-tenant-id'] || 
                      req.query.tenantId || 
                      req.session.selectedTenantId || 
                      'airtech';
  
  next();
});

// GET /api/admin/reports - Hent alle servicerapporter
router.get('/', async (req, res) => {
  console.log('Admin reports API called');
  
  try {
    const pool = await db.getTenantConnection(req.adminTenantId);
    
    const query = `
      SELECT 
        sr.id,
        sr.order_id,
        sr.equipment_id,
        sr.pdf_path,
        sr.pdf_generated,
        sr.sent_til_fakturering,
        sr.pdf_sent_timestamp,
        sr.is_invoiced,
        sr.invoice_comment,
        sr.invoice_date,
        sr.created_at,
        o.customer_name,
        o.scheduled_date,
        e.name as equipment_name,
        e.type as equipment_type,
        t.name as technician_name
      FROM service_reports sr
      JOIN orders o ON sr.order_id = o.id
      JOIN equipment e ON sr.equipment_id = e.id
      LEFT JOIN technicians t ON o.technician_id = t.id
      ORDER BY sr.created_at DESC
    `;
    
    console.log('Executing query...');
    const result = await pool.query(query);
    console.log(`Found ${result.rows.length} reports`);
    
    const stats = {
      total: result.rows.length,
      sent: result.rows.filter(r => r.sent_til_fakturering).length,
      pending: result.rows.filter(r => !r.sent_til_fakturering).length,
      invoiced: result.rows.filter(r => r.is_invoiced).length
    };
    
    res.json({
      reports: result.rows,
      stats: stats
    });
    
  } catch (error) {
    console.error('Database error in admin reports:', error);
    res.status(500).json({ 
      error: 'Kunne ikke hente rapporter',
      details: error.message 
    });
  }
});

// GET /api/admin/reports/:reportId/pdf - Serve PDF file (MANGLENDE RUTE!)
router.get('/:reportId/pdf', async (req, res) => {
  const { reportId } = req.params;
  
  try {
    console.log(`Serving PDF for report: ${reportId}`);
    
    const pool = await db.getTenantConnection(req.adminTenantId);
    
    // Hent PDF-path fra database
    const result = await pool.query(
      'SELECT pdf_path, pdf_generated FROM service_reports WHERE id = $1',
      [reportId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Rapport ikke funnet' });
    }
    
    const report = result.rows[0];
    
    if (!report.pdf_generated || !report.pdf_path) {
      return res.status(404).json({ error: 'PDF ikke generert for denne rapporten' });
    }
    
    // Bygg full path til PDF-fil
    const fullPdfPath = path.join(__dirname, '../../servfix-files/tenants', req.adminTenantId, report.pdf_path);
    
    console.log(`Looking for PDF at: ${fullPdfPath}`);
    
    // Sjekk om filen eksisterer
    try {
      await fs.access(fullPdfPath);
    } catch (fileError) {
      console.error(`PDF file not found: ${fullPdfPath}`);
      return res.status(404).json({ error: 'PDF-fil ikke funnet på server' });
    }
    
    // Les og send PDF-fil
    const pdfBuffer = await fs.readFile(fullPdfPath);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="servicerapport_${reportId}.pdf"`);
    res.send(pdfBuffer);
    
    console.log(`✅ PDF served successfully for report ${reportId}`);
    
  } catch (error) {
    console.error('Error serving PDF:', error);
    res.status(500).json({ 
      error: 'Kunne ikke hente PDF',
      details: error.message 
    });
  }
});

// POST /api/admin/reports/:reportId/send - Send rapport til kunde
router.post('/:reportId/send', async (req, res) => {
  const { reportId } = req.params;
  
  try {
    const pool = await db.getTenantConnection(req.adminTenantId);
    
    await pool.query(
      'UPDATE service_reports SET sent_til_fakturering = true, pdf_sent_timestamp = CURRENT_TIMESTAMP WHERE id = $1',
      [reportId]
    );
    
    res.json({
      success: true,
      message: 'Rapport markert som sendt',
      sentTo: 'kunde@example.com'
    });
    
  } catch (error) {
    console.error('Feil ved sending av rapport:', error);
    res.status(500).json({ error: `Kunne ikke sende rapport: ${error.message}` });
  }
});

// PUT /api/admin/reports/:reportId/invoice - Marker rapport som fakturert  
router.put('/:reportId/invoice', async (req, res) => {
  const { reportId } = req.params;
  const { invoiced, comment } = req.body;
  
  try {
    const pool = await db.getTenantConnection(req.adminTenantId);
    
    if (invoiced) {
      await pool.query(
        'UPDATE service_reports SET is_invoiced = true, invoice_comment = $1, invoice_date = CURRENT_TIMESTAMP WHERE id = $2',
        [comment || null, reportId]
      );
    } else {
      await pool.query(
        'UPDATE service_reports SET is_invoiced = false, invoice_comment = null, invoice_date = null WHERE id = $1',
        [reportId]
      );
    }
    
    res.json({
      success: true,
      message: invoiced ? 'Rapport markert som fakturert' : 'Fakturering fjernet'
    });
    
  } catch (error) {
    console.error('Feil ved oppdatering av fakturering:', error);
    res.status(500).json({ error: 'Kunne ikke oppdatere fakturering' });
  }
});

module.exports = router;