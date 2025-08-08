const express = require('express');
const db = require('../config/database');
const path = require('path');
const fs = require('fs').promises;

const router = express.Router();

// Middleware - sjekk auth
router.use((req, res, next) => {
  if (!req.session.technicianId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
});

// Hent alle ordrer for pålogget tekniker
router.get('/', async (req, res) => {
  try {
    const pool = await db.getTenantConnection(req.session.tenantId);
    console.log('Fetching orders for technicianId:', req.session.technicianId);
    
    const result = await pool.query(
      `SELECT * FROM orders 
       WHERE technician_id = $1 
       ORDER BY scheduled_date DESC, scheduled_time DESC`,
      [req.session.technicianId]
    );
    
    // Legg til orderNumber for frontend
    const ordersWithNumber = result.rows.map(order => ({
      ...order,
      orderNumber: `SO-${order.id.split('-')[1]}-${order.id.split('-')[2].slice(-6)}`
    }));
    
    // Berik ordre med equipment status
    const ordersWithEquipment = await Promise.all(ordersWithNumber.map(async (order) => {
        let equipment = []; // Initialize equipment here
        try {
            // Hent equipment for denne ordren
            const equipmentResult = await pool.query(
                `SELECT 
                    e.id, 
                    -- e.data->>'serviceStatus' as service_status, FJERNET
                    COALESCE(sr.status, 'not_started') as service_status,
                    COALESCE(sr.status, 'not_started') as service_report_status
                FROM equipment e
                LEFT JOIN service_reports sr ON (sr.equipment_id = e.id AND sr.order_id = $2)
                WHERE e.customer_id = $1`,
                [order.customer_id, order.id]
            );

            equipment = equipmentResult.rows.map(eq => ({
                id: eq.id,
                serviceStatus: eq.service_status || 'not_started',
                serviceReportStatus: eq.service_report_status || 'not_started'
            }));
            
        } catch (error) {
            console.log('Could not fetch equipment for order:', order.id);
            // equipment remains empty array
        }
        
        return { // Return the modified order object
            ...order,
            equipment: equipment // Assign the fetched or empty equipment
        };
    }));

    res.json(ordersWithEquipment);
  } catch (error) {
    console.error('Error fetching all orders:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Hent dagens ordrer
router.get('/today', async (req, res) => {
  try {
    const pool = await db.getTenantConnection(req.session.tenantId);
    const today = new Date().toISOString().split('T')[0];
    
    const result = await pool.query(
      `SELECT * FROM orders 
       WHERE technician_id = $1 
       AND scheduled_date = $2
       ORDER BY scheduled_time`,
      [req.session.technicianId, today]
    );
    
    // Legg til orderNumber for frontend
    const ordersWithNumber = result.rows.map(order => ({
      ...order,
      orderNumber: `SO-${order.id.split('-')[1]}-${order.id.split('-')[2].slice(-6)}`
    }));
    
    // Berik ordre med equipment status
    const ordersWithEquipment = await Promise.all(ordersWithNumber.map(async (order) => {
        try {
            // Hent equipment for denne ordren
            const equipmentResult = await pool.query(
                `SELECT 
                    e.id, 
                    -- e.data->>'serviceStatus' as service_status, FJERNET
                    COALESCE(sr.status, 'not_started') as service_status,
                    COALESCE(sr.status, 'not_started') as service_report_status
                FROM equipment e
                LEFT JOIN service_reports sr ON (sr.equipment_id = e.id AND sr.order_id = $2)
                WHERE e.customer_id = $1`,
                [order.customer_id, order.id]
            );

            equipment = equipmentResult.rows.map(eq => ({
                id: eq.id,
                serviceStatus: eq.service_status || 'not_started',
                serviceReportStatus: eq.service_report_status || 'not_started'
            }));
            
        } catch (error) {
            console.log('Could not fetch equipment for order:', order.id);
            order.equipment = [];
        }
        
        return order;
    }));

    res.json(ordersWithEquipment);
    
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET single order
router.get('/:id', async (req, res) => {
  try {
    const pool = await db.getTenantConnection(req.session.tenantId);
    const orderResult = await pool.query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
    
    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    const order = orderResult.rows[0];
    order.orderNumber = `SO-${order.id.split('-')[1]}-${order.id.split('-')[2].slice(-6)}`;

    // Fetch customer data - sjekk om det finnes customer_data i ordre
    let customer = {
        id: order.customer_id,
        name: order.customer_name
    };

    // Hvis ordre har customer_data, bruk det
    if (order.customer_data && typeof order.customer_data === 'object') {
        customer = {
            ...customer,
            ...order.customer_data
        };
    }

// Prøv å hente fullstendig kundeinformasjon fra Tripletex
try {
    const tripletexService = require('../services/tripletexService');
    const customerDetails = await tripletexService.getCustomer(order.customer_id);
    
    if (customerDetails) {
        customer.contact = customerDetails.customerContact 
            ? `${customerDetails.customerContact.firstName || ''} ${customerDetails.customerContact.lastName || ''}`.trim()
            : '';
        customer.email = customerDetails.email || customerDetails.invoiceEmail || '';
        customer.phone = customerDetails.phoneNumber || customerDetails.phoneNumberMobile || '';
        customer.physicalAddress = customerDetails.physicalAddress 
            ? `${customerDetails.physicalAddress.addressLine1 || ''}, ${customerDetails.physicalAddress.postalCode || ''} ${customerDetails.physicalAddress.city || ''}`.trim()
            : '';
    }
} catch (error) {
    console.log('Could not fetch customer details from Tripletex:', error.message);
    // Fortsett med grunnleggende kundeinfo
}

    // Hvis ikke, prøv å hente fra customers tabell hvis den finnes
    // (Dette krever at du har en customers tabell, ellers skip denne delen)

    // Fetch equipment data for the customer
   const equipmentResult = await pool.query(
        `SELECT 
            e.id, 
            e.customer_id, 
            e.type, 
            e.name, 
            e.location, 
            e.data,
            -- Fjernet: data->>'serviceStatus' as service_status,
            COALESCE(sr.status, 'not_started') as service_status,
            e.data->>'systemNumber' as system_number,
            e.data->>'systemType' as system_type,
            e.data->>'operator' as operator
        FROM equipment e
        LEFT JOIN service_reports sr ON (sr.equipment_id = e.id AND sr.order_id = $2)
        WHERE e.customer_id = $1`,
        [order.customer_id || order.customerId, order.id]
    );

    // Transform equipment data
    const equipment = equipmentResult.rows.map(eq => ({
        id: eq.id,
        customerId: eq.customer_id,
        type: eq.type,
        name: eq.name,
        location: eq.location,
        serviceStatus: eq.service_status || 'not_started',
        systemNumber: eq.system_number || '',
        systemType: eq.system_type || '',
        operator: eq.operator || '',
        data: eq.data
    }));

    // Fetch technician data (assuming technicianId is available in order or session)
    const technicianResult = await pool.query('SELECT * FROM technicians WHERE id = $1', [order.technician_id]);
    const technician = technicianResult.rows[0] || {};
    
    res.json({
      order: {
          ...order,
          customer_data: customer // Legg til customer data på ordre objektet
      },
      customer: customer,
      equipment: equipment,
      technician: technician,
      quotes: []
    });
    
  } catch (error) {
    console.error('Error fetching order:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT update order status
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    if (!status) {
      return res.status(400).json({ error: 'Status er påkrevd' });
    }
    
    const pool = await db.getTenantConnection(req.session.tenantId);
    
    const result = await pool.query(
      'UPDATE orders SET status = $1 WHERE id = $2 AND technician_id = $3 RETURNING *',
      [status, id, req.session.technicianId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Ordre ikke funnet eller tilhører ikke denne teknikeren' });
    }
    
    console.log(`Order ${id} updated to status: ${status}`);
    res.json(result.rows[0]);
    
  } catch (error) {
    console.error('Error updating order status:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Load the new unified PDF generator
const UnifiedPDFGenerator = require('../services/unifiedPdfGenerator');


// Ferdigstill ordre med ny PDF-generering
router.post('/:orderId/complete', async (req, res) => {
  const { orderId } = req.params;
  const tenantId = req.tenantId || req.session.tenantId;
  
  if (!req.session.technicianId) {
    return res.status(401).json({ error: 'Ikke autentisert' });
  }

  let pool;
  let serviceReportsResult;
  const generatedPDFs = [];
  let pdfGenerator = null;

  try {
    pool = await db.getTenantConnection(tenantId);
    
    // Start transaksjon
    await pool.query('BEGIN');
    
    console.log(`🚀 Ferdigstiller ordre ${orderId}...`);
    
    // Oppdater ordre status til completed
    await pool.query(
      'UPDATE orders SET status = $1 WHERE id = $2',
      ['completed', orderId]
    );
   
    // Hent alle service_reports for denne ordren
    serviceReportsResult = await pool.query(
      `SELECT sr.*, e.type as equipment_type, e.name as equipment_name
       FROM service_reports sr
       JOIN equipment e ON sr.equipment_id = e.id
       WHERE sr.order_id = $1 AND sr.status = 'completed'`,
      [orderId]
    );
    
    console.log(`📋 Fant ${serviceReportsResult.rows.length} rapporter å generere PDF-er for`);
    
    // Sjekk om det finnes rapporter å generere
    if (serviceReportsResult.rows.length > 0) {
      try {
        // Opprett PDF generator (IKKE kall init() her!)
        pdfGenerator = new UnifiedPDFGenerator();
        
        // Generer PDF-er for alle rapporter
        for (const report of serviceReportsResult.rows) {
          try {
            console.log(`📄 Genererer PDF for rapport ${report.id} (${report.equipment_type})...`);
            
            // generateReport() kaller init() internt, så vi trenger ikke gjøre det her
            const pdfPath = await pdfGenerator.generateReport(report.id, tenantId);
            
            generatedPDFs.push({
              reportId: report.id,
              equipmentType: report.equipment_type,
              equipmentName: report.equipment_name,
              pdfPath: pdfPath
            });
            
            console.log(`✅ PDF generert: ${pdfPath}`);
            
          } catch (pdfError) {
            console.error(`❌ PDF-generering feilet for rapport ${report.id}:`, pdfError.message);
            // Fortsett med andre rapporter selv om én feiler
          }
        }
        
      } catch (pdfInitError) {
        console.error('❌ Kunne ikke opprette PDF-generator:', pdfInitError.message);
        // Fortsett uten PDF-generering - ordre skal fortsatt ferdigstilles
      }
    }
    
    // Commit transaksjon
    await pool.query('COMMIT');
    
    console.log(`✅ Ordre ${orderId} ferdigstilt med ${generatedPDFs.length} PDF-er generert`);
    
    // Send alltid response tilbake
    res.json({
      success: true,
      orderId: orderId,
      message: generatedPDFs.length > 0 
        ? `Ordre ferdigstilt med ${generatedPDFs.length} servicerapporter`
        : 'Ordre ferdigstilt (PDF-generering feilet eller ingen rapporter)',
      generatedPDFs: generatedPDFs,
      warning: generatedPDFs.length === 0 && serviceReportsResult.rows.length > 0
        ? 'PDF-generering feilet, men ordre er ferdigstilt'
        : null
    });
    
  } catch (error) {
    console.error('❌ Feil ved ferdigstilling av ordre:', error);
    
    // Rollback hvis mulig
    if (pool) {
      try {
        await pool.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Feil ved rollback:', rollbackError);
      }
    }
    
    // Send alltid feilresponse
    res.status(500).json({ 
      error: 'Kunne ikke ferdigstille ordre',
      details: error.message 
    });
  }
});

// Hent alle rapporter for en ordre med PDF-status
router.get('/:id/reports', async (req, res) => {
  try {
    const { id: orderId } = req.params;
    const tenantId = req.session.tenantId;
    
    const pool = await db.getTenantConnection(tenantId);
    
    const result = await pool.query(
      `SELECT 
        sr.*,
        e.name as equipment_name,
        e.type as equipment_type,
        CASE 
          WHEN sr.pdf_generated = true THEN 'generated'
          ELSE 'pending'
        END as pdf_status
       FROM service_reports sr
       JOIN equipment e ON sr.equipment_id = e.id
       WHERE sr.order_id = $1
       ORDER BY sr.created_at ASC`,
      [orderId]
    );
    
    res.json({
      orderId: orderId,
      reports: result.rows,
      totalReports: result.rows.length,
      generatedPDFs: result.rows.filter(r => r.pdf_generated).length
    });
    
  } catch (error) {
    console.error('Feil ved henting av ordre-rapporter:', error);
    res.status(500).json({ error: 'Kunne ikke hente rapporter' });
  }
});

// Oppdatert preview endpoint
router.get('/service-report/:reportId/preview', async (req, res) => {
  const { reportId } = req.params;
  const tenantId = req.tenantId || req.session.tenantId;
  
  if (!req.session.technicianId) {
    return res.status(401).json({ error: 'Ikke autentisert' });
  }
  
  try {
    console.log(`📄 Genererer PDF-forhåndsvisning for rapport ${reportId}...`);
    
    const pdfGenerator = new UnifiedPDFGenerator();
    
    // Generate PDF in memory (don't save to disk)
    await pdfGenerator.init();
    const reportData = await pdfGenerator.fetchReportData(reportId, tenantId);
    const companySettings = await pdfGenerator.loadCompanySettings(tenantId);
    const html = await pdfGenerator.generateHTML(reportData, companySettings);
    const pdfBuffer = await pdfGenerator.generatePDF(html);
    await pdfGenerator.close();
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="preview_${reportId}.pdf"`);
    res.send(pdfBuffer);
    
    console.log(`✅ PDF forhåndsvisning generert for rapport ${reportId}`);
    
  } catch (error) {
    console.error('Feil ved generering av PDF-forhåndsvisning:', error);
    res.status(500).json({ 
      error: 'Kunne ikke generere PDF-forhåndsvisning',
      details: error.message 
    });
  }
});

module.exports = router;