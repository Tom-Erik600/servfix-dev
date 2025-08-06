// src/routes/admin/reports.js - Fixed with PDF serving
const express = require('express');
const router = express.Router();
const db = require('../../config/database');
const path = require('path');
const fs = require('fs').promises;
const tripletexService = require('../../services/tripletexService');
const emailService = require('../../services/emailService');

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
        o.customer_id,
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

    // Hent customer email fra Tripletex for hver rapport
    const reportsWithEmail = await Promise.all(result.rows.map(async (report) => {
      try {
        if (report.customer_id) {
          const customerDetails = await tripletexService.getCustomer(report.customer_id);
          report.customer_email = customerDetails?.email || customerDetails?.invoiceEmail || null;
        }
      } catch (error) {
        console.warn(`Could not fetch email for customer ${report.customer_id}:`, error.message);
        report.customer_email = null;
      }
      return report;
    }));

    const stats = {
      total: reportsWithEmail.length,
      sent: reportsWithEmail.filter(r => r.sent_til_fakturering).length,
      pending: reportsWithEmail.filter(r => !r.sent_til_fakturering).length,
      invoiced: reportsWithEmail.filter(r => r.is_invoiced).length
    };

    res.json({
      reports: reportsWithEmail, // Bruk reportsWithEmail i stedet for result.rows
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
    console.log(`Redirecting to PDF for report: ${reportId}`);
    
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
    
    // Bygg public URL for GCS
    const bucketName = process.env.GCS_BUCKET_NAME || 'servfix-files';
    const gcsPath = `tenants/${req.adminTenantId}/${report.pdf_path}`;
    const publicUrl = `https://storage.googleapis.com/${bucketName}/${gcsPath}`;
    
    console.log(`✅ Redirecting to GCS URL: ${publicUrl}`);
    
    // Redirect til public URL
    res.redirect(publicUrl);
    
  } catch (error) {
    console.error('Error redirecting to PDF:', error);
    res.status(500).json({ 
      error: 'Kunne ikke hente PDF',
      details: error.message 
    });
  }
});

// POST /api/admin/reports/:reportId/send - Send rapport til kunde
router.post('/:reportId/send', async (req, res) => {
  const { reportId } = req.params;
  const { confirmed } = req.body;
  
  try {
    const pool = await db.getTenantConnection(req.adminTenantId);
    
    // Hent rapport og customer_id
    const reportQuery = `
      SELECT sr.*, o.customer_id, o.customer_name
      FROM service_reports sr
      JOIN orders o ON sr.order_id = o.id
      WHERE sr.id = $1
    `;
    
    const reportResult = await pool.query(reportQuery, [reportId]);
    if (reportResult.rows.length === 0) {
      return res.status(404).json({ error: 'Rapport ikke funnet' });
    }
    
    const report = reportResult.rows[0];
    
    // Hent kundens e-post fra Tripletex
    let customerEmail = null;
    try {
      if (report.customer_id) {
        const customerDetails = await tripletexService.getCustomer(report.customer_id);
        customerEmail = customerDetails?.email || customerDetails?.invoiceEmail;
      }
    } catch (error) {
      console.warn('Kunne ikke hente kunde e-post:', error.message);
    }
    
    if (!customerEmail) {
      return res.status(400).json({ error: 'Ingen gyldig e-postadresse funnet for kunde' });
    }
    
    // Hvis ikke bekreftet, returner e-postadresse for bekreftelse
    if (!confirmed) {
      return res.json({
        requiresConfirmation: true,
        customerEmail: customerEmail,
        customerName: report.customer_name
      });
    }
    
    // VIKTIG: Send faktisk e-post FØRST
    console.log(`📧 Sending email to: ${customerEmail}`);
    
    try {
      // Initialiser email service
      if (!emailService.transporter) {
        console.log('🔧 Initializing email service...');
        await emailService.init();
      }
      
      // Send faktisk e-post
      const emailResult = await emailService.sendServiceReport(reportId, req.adminTenantId);
      console.log('✅ Email sent successfully:', emailResult.messageId);
      
      // KUN marker som sendt hvis e-post er faktisk sendt
      await pool.query(
        'UPDATE service_reports SET sent_til_fakturering = true, pdf_sent_timestamp = CURRENT_TIMESTAMP WHERE id = $1',
        [reportId]
      );
      
      res.json({
        success: true,
        message: 'Rapport sendt via e-post',
        sentTo: emailResult.sentTo,
        messageId: emailResult.messageId
      });
      
    } catch (emailError) {
      console.error('❌ E-post sending feilet:', emailError);
      // IKKE marker som sendt hvis e-post feiler
      throw new Error(`E-post kunne ikke sendes: ${emailError.message}`);
    }
    
  } catch (error) {
    console.error('Feil ved sending av rapport:', error);
    res.status(500).json({ error: error.message });
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
