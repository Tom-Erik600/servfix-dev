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

// GET all reports - MED orderId filtering
router.get('/', async (req, res) => {
  const debugSteps = [];
  
  try {
    // Hent orderId fra query parameters
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
    
    const query = `
      SELECT 
        sr.*,
        o.customer_name,
        o.customer_id,
        o.scheduled_date,
        o.service_type,
        e.systemnavn as equipment_name,
        e.systemtype as equipment_type,
        t.name as technician_name
      FROM service_reports sr
      LEFT JOIN orders o ON sr.order_id = o.id
      LEFT JOIN equipment e ON sr.equipment_id = CAST(e.id AS VARCHAR)
      LEFT JOIN technicians t ON o.technician_id = t.id
      ${whereClause}
      ORDER BY sr.created_at DESC
    `;
    
    debugSteps.push('Executing query...');
    const finalResult = await pool.query(query, queryParams);
    debugSteps.push(`✅ Query OK - ${finalResult.rows.length} rows`);
    
    // Calculate stats
    const stats = {
      total: finalResult.rows.length,
      sent: finalResult.rows.filter(r => r.sent_til_fakturering).length,
      pending: finalResult.rows.filter(r => !r.sent_til_fakturering).length,
      invoiced: finalResult.rows.filter(r => r.is_invoiced).length
    };
    
    res.json({
      reports: finalResult.rows,
      stats: stats,
      debug: {
        steps: debugSteps,
        success: true,
        filtered: !!orderId,
        orderId: orderId || null
      }
    });
    
  } catch (error) {
    console.error('Query failed at step:', debugSteps.length);
    console.error('Error:', error);
    
    res.status(500).json({ 
      error: 'Database error',
      message: error.message,
      failedAtStep: debugSteps.length,
      debug: debugSteps,
      detail: error.detail || null,
      hint: error.hint || null
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