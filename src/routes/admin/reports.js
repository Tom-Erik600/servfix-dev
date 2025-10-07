// src/routes/admin/reports.js - FIX: Legg til orderId filtering
const express = require('express');
const router = express.Router();
const db = require('../../config/database');

// Auth middleware
router.use((req, res, next) => {
  if (!req.session?.isAdmin) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.adminTenantId = req.session.tenantId || 'airtech';
  next();
});

// GET all reports - GRUPPERER PER ORDRE
router.get('/', async (req, res) => {
  const debugSteps = [];
  
  try {
    const { orderId } = req.query;
    
    debugSteps.push('Getting DB connection...');
    const pool = await db.getTenantConnection(req.adminTenantId);
    debugSteps.push('✅ DB connection OK');
    
    // Build query med conditional WHERE clause
    let whereClause = "WHERE sr.status = 'completed'";
    let queryParams = [];
    
    if (orderId) {
      whereClause += " AND sr.order_id = $1";
      queryParams.push(orderId);
      debugSteps.push(`🔍 Filtering by orderId: ${orderId}`);
    } else {
      debugSteps.push('📋 Getting all completed reports');
    }
    
    // NYE QUERY: Grupper per ordre og concatenate anlegg
    const query = `
      WITH order_equipment AS (
        SELECT 
          sr.order_id,
          o.customer_name,
          o.customer_id,
          o.scheduled_date,
          o.service_type,
          o.created_at as order_date,
          MIN(sr.created_at) as first_service_date,
          MAX(sr.created_at) as last_service_date,
          t.name as technician_name,
          -- Concatenate alle anlegg med komma
          STRING_AGG(DISTINCT e.systemnavn, ', ' ORDER BY e.systemnavn) as equipment_names,
          STRING_AGG(DISTINCT e.systemtype, ', ' ORDER BY e.systemtype) as equipment_types,
          -- Tell antall anlegg
          COUNT(DISTINCT sr.equipment_id) as equipment_count,
          -- Sjekk om noen er sendt
          BOOL_OR(sr.sent_til_fakturering) as any_sent,
          BOOL_AND(sr.sent_til_fakturering) as all_sent,
          -- Sjekk om noen er fakturert
          BOOL_OR(sr.is_invoiced) as any_invoiced,
          BOOL_AND(sr.is_invoiced) as all_invoiced,
          -- PDF status
          BOOL_AND(sr.pdf_generated) as all_pdfs_generated,
          -- Samle alle rapport-IDer for denne ordren
          ARRAY_AGG(sr.id ORDER BY sr.created_at) as report_ids
        FROM service_reports sr
        LEFT JOIN orders o ON sr.order_id = o.id
        LEFT JOIN equipment e ON sr.equipment_id::varchar = e.id::varchar
        LEFT JOIN technicians t ON o.technician_id = t.id
        ${whereClause}
        GROUP BY sr.order_id, o.customer_name, o.customer_id, o.scheduled_date, 
                 o.service_type, o.created_at, t.name
        ORDER BY MAX(sr.created_at) DESC
      )
      SELECT * FROM order_equipment
    `;
    
    debugSteps.push('Executing grouped query...');
    const result = await pool.query(query, queryParams);
    debugSteps.push(`✅ Query OK - ${result.rows.length} order groups`);
    
    // Hent servfixmail email for hver ordre
    const tripletexService = require('../../services/tripletexService');
    const ordersWithEmail = await Promise.all(result.rows.map(async (order) => {
      let customerEmail = null;
      
      if (order.customer_id) {
        try {
          const servfixContact = await tripletexService.getServfixmailContact(order.customer_id);
          customerEmail = servfixContact?.email || null;
        } catch (error) {
          console.warn(`Could not fetch servfixmail for customer ${order.customer_id}:`, error.message);
        }
      }
      
      return {
        ...order,
        customer_email: customerEmail,
        // Status basert på alle rapporter i ordren
        sent_til_fakturering: order.all_sent,
        is_invoiced: order.all_invoiced,
        pdf_generated: order.all_pdfs_generated
      };
    }));
    
    // Calculate stats
    const stats = {
      total: ordersWithEmail.length,
      sent: ordersWithEmail.filter(r => r.sent_til_fakturering).length,
      pending: ordersWithEmail.filter(r => !r.sent_til_fakturering).length,
      invoiced: ordersWithEmail.filter(r => r.is_invoiced).length
    };
    
    res.json({
      reports: ordersWithEmail,
      stats: stats,
      debug: {
        steps: debugSteps,
        success: true,
        filtered: !!orderId,
        groupedByOrder: true
      }
    });
    
  } catch (error) {
    console.error('❌ Error in GET /admin/reports:', error);
    debugSteps.push(`❌ Error: ${error.message}`);
    res.status(500).json({ 
      error: 'Failed to fetch reports',
      details: error.message,
      debug: { steps: debugSteps, success: false }
    });
  }
});

// PDF endpoint - miljø-aware versjon
router.get('/:reportId/pdf', async (req, res) => {
  try {
    const pool = await db.getTenantConnection(req.adminTenantId);
    const result = await pool.query(
      'SELECT pdf_path, pdf_generated FROM service_reports WHERE id = $1',
      [req.params.reportId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Rapport ikke funnet' });
    }
    
    const report = result.rows[0];
    if (!report.pdf_generated || !report.pdf_path) {
      return res.status(404).json({ error: 'PDF ikke generert' });
    }
    
    // MILJØ-SPESIFIKK HÅNDTERING  
    const isCloudRun = !!process.env.K_SERVICE;  // Google Cloud Run setter denne automatisk
    const useCloudStorage = isCloudRun || process.env.USE_CLOUD_STORAGE === 'true';
    
    console.log(`📄 Serving PDF: ${report.pdf_path}`);
    console.log(`🔧 Environment: ${isCloudRun ? 'GOOGLE CLOUD RUN' : 'LOCAL DEVELOPMENT'}`);
    console.log(`☁️ Cloud Storage: ${useCloudStorage ? 'ENABLED' : 'DISABLED'}`);
    console.log(`🔧 K_SERVICE: ${process.env.K_SERVICE || 'not set'}`);
    
    if (useCloudStorage) {
      // PRODUKSJON: Redirect til Google Cloud Storage
      const bucketName = process.env.GCS_BUCKET_NAME || 'servfix-files';
      const publicUrl = `https://storage.googleapis.com/${bucketName}/tenants/${req.adminTenantId}/${report.pdf_path}`;
      console.log(`🌐 Redirecting to GCS: ${publicUrl}`);
      res.redirect(publicUrl);
    } else {
      // DEVELOPMENT: Serve fra lokal fil
      const path = require('path');
      const localPath = path.join(__dirname, `../../servfix-files/tenants/${req.adminTenantId}/${report.pdf_path}`);
      
      console.log(`💾 Serving local file: ${localPath}`);
      
      // Sjekk om fil eksisterer
      const fs = require('fs');
      if (!fs.existsSync(localPath)) {
        console.error(`❌ Local PDF file not found: ${localPath}`);
        return res.status(404).json({ 
          error: 'PDF-fil ikke funnet lokalt',
          path: report.pdf_path,
          localPath: localPath
        });
      }
      
      // Serve lokal fil
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${path.basename(localPath)}"`);
      res.sendFile(path.resolve(localPath));
    }
    
  } catch (error) {
    console.error('❌ PDF endpoint error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Send alle rapporter for en ordre til kunde
router.post('/order/:orderId/send', async (req, res) => {
  const { orderId } = req.params;
  
  try {
    const pool = await db.getTenantConnection(req.adminTenantId);
    
    // Hent ordre og kunde info
    const orderResult = await pool.query(
      'SELECT * FROM orders WHERE id = $1',
      [orderId]
    );
    
    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Ordre ikke funnet' });
    }
    
    const order = orderResult.rows[0];
    
    // Hent servfixmail email
    const tripletexService = require('../../services/tripletexService');
    const servfixContact = await tripletexService.getServfixmailContact(order.customer_id);
    
    if (!servfixContact || !servfixContact.email) {
      return res.status(400).json({ 
        error: `Ingen servfixmail-kontakt funnet for kunde: ${order.customer_name}`,
        customer_id: order.customer_id
      });
    }
    
    // Hent alle rapporter for ordren
    const reportsResult = await pool.query(
      `SELECT sr.*, e.systemnavn, e.systemtype 
       FROM service_reports sr
       LEFT JOIN equipment e ON sr.equipment_id::varchar = e.id::varchar
       WHERE sr.order_id = $1 AND sr.status = 'completed'`,
      [orderId]
    );
    
    if (reportsResult.rows.length === 0) {
      return res.status(400).json({ error: 'Ingen fullførte rapporter funnet for denne ordren' });
    }
    
    // Send e-post med alle PDFer som vedlegg
    const EmailService = require('../../services/emailService');
    await EmailService.init();
    
    const emailResult = await EmailService.sendOrderReportsToCustomer(
      orderId,
      req.adminTenantId,
      reportsResult.rows,
      servfixContact.email,
      order
    );
    
    // Oppdater alle rapporter som sendt
    await pool.query(
      `UPDATE service_reports 
       SET sent_til_fakturering = true, pdf_sent_timestamp = NOW() 
       WHERE order_id = $1`,
      [orderId]
    );
    
    res.json({
      success: true,
      message: `${reportsResult.rows.length} rapport(er) sendt til ${servfixContact.email}`,
      sentTo: servfixContact.email,
      reportCount: reportsResult.rows.length
    });
    
  } catch (error) {
    console.error('Error sending order reports:', error);
    res.status(500).json({ 
      error: 'Kunne ikke sende rapporter',
      details: error.message 
    });
  }
});

// Mark as invoiced (unchanged)
router.post('/:reportId/mark-invoiced', async (req, res) => {
  try {
    const pool = await db.getTenantConnection(req.adminTenantId);
    await pool.query(
      'UPDATE service_reports SET is_invoiced = $1 WHERE id = $2',
      [req.body.isInvoiced, req.params.reportId]
    );
    res.json({ 
      success: true,
      message: req.body.isInvoiced ? 'Merket som fakturert' : 'Fjernet fakturert-markering'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;