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

// GET all reports - BUILD UP GRADUALLY
router.get('/', async (req, res) => {
  const debugSteps = [];
  
  try {
    // Step 1: Get connection
    debugSteps.push('Getting DB connection...');
    const pool = await db.getTenantConnection(req.adminTenantId);
    debugSteps.push('✅ DB connection OK');
    
    // Step 2: Basic query
    debugSteps.push('Testing basic query...');
    const basicResult = await pool.query('SELECT id FROM service_reports LIMIT 1');
    debugSteps.push(`✅ Basic query OK - found ${basicResult.rows.length} rows`);
    
    // Step 3: Query with orders join
    debugSteps.push('Adding orders join...');
    let query = `
      SELECT 
        sr.*,
        o.customer_name,
        o.customer_id,
        o.scheduled_date
      FROM service_reports sr
      LEFT JOIN orders o ON sr.order_id = o.id
      WHERE sr.status = 'completed'
      LIMIT 5
    `;
    
    const withOrdersResult = await pool.query(query);
    debugSteps.push(`✅ Orders join OK - ${withOrdersResult.rows.length} rows`);
    
    // Step 4: Add equipment join
    debugSteps.push('Adding equipment join...');
    query = `
      SELECT 
        sr.*,
        o.customer_name,
        o.customer_id,
        o.scheduled_date,
        e.name as equipment_name,
        e.type as equipment_type
      FROM service_reports sr
      LEFT JOIN orders o ON sr.order_id = o.id
      LEFT JOIN equipment e ON sr.equipment_id = e.id
      WHERE sr.status = 'completed'
      LIMIT 5
    `;
    
    const withEquipmentResult = await pool.query(query);
    debugSteps.push(`✅ Equipment join OK - ${withEquipmentResult.rows.length} rows`);
    
    // Step 5: Add technicians join (THIS IS PROBABLY WHERE IT FAILS)
    debugSteps.push('Adding technicians join...');
    query = `
      SELECT 
        sr.*,
        o.customer_name,
        o.customer_id,
        o.scheduled_date,
        e.name as equipment_name,
        e.type as equipment_type,
        t.name as technician_name
      FROM service_reports sr
      LEFT JOIN orders o ON sr.order_id = o.id
      LEFT JOIN equipment e ON sr.equipment_id = e.id
      LEFT JOIN technicians t ON o.technician_id = t.id
      WHERE sr.status = 'completed'
      ORDER BY sr.created_at DESC
    `;
    
    const finalResult = await pool.query(query);
    debugSteps.push(`✅ Full query OK - ${finalResult.rows.length} rows`);
    
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
        success: true
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

// PDF endpoint
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
    
    const bucketName = process.env.GCS_BUCKET_NAME || 'servfix-files';
    const publicUrl = `https://storage.googleapis.com/${bucketName}/tenants/${req.adminTenantId}/${report.pdf_path}`;
    res.redirect(publicUrl);
    
  } catch (error) {
    console.error('PDF error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Mark as invoiced
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