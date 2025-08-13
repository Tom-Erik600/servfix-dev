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

// Hent alle ordrer (for search-orders siden)
router.get('/all', async (req, res) => {
  try {
    const pool = await db.getTenantConnection(req.session.tenantId);
    console.log('Fetching ALL orders for technician search-orders feature');
    
    const result = await pool.query(
      `SELECT * FROM orders 
       ORDER BY scheduled_date DESC, scheduled_time DESC`
    );
    
    // Legg til orderNumber for frontend og normaliser feltnavn
    const ordersWithNumber = result.rows.map(order => ({
      ...order,
      orderNumber: `SO-${order.id.split('-')[1]}-${order.id.split('-')[2].slice(-6)}`,
      // Map database fields til frontend format
      technicianId: order.technician_id,
      customerId: order.customer_id,
      plannedDate: order.scheduled_date,
      type: order.service_type
    }));
    
    console.log(`Found ${ordersWithNumber.length} total orders`);
    
    res.json(ordersWithNumber);
    
  } catch (error) {
    console.error('Error fetching all orders:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET single order
// GET single order - KOMPLETT FUNKSJON for src/routes/orders.js
// GET single order - KOMPLETT FUNKSJON for src/routes/orders.js
// GET single order - KOMPLETT FUNKSJON for src/routes/orders.js
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
                ? `${customerDetails.physicalAddress.addressLine1 || ''} ${customerDetails.physicalAddress.addressLine2 || ''}`.trim()
                : '';
            customer.postalAddress = customerDetails.postalAddress 
                ? `${customerDetails.postalAddress.addressLine1 || ''} ${customerDetails.postalAddress.addressLine2 || ''}`.trim()
                : '';
        }
    } catch (tripletexError) {
        console.log('Could not fetch customer details from Tripletex:', tripletexError.message);
    }

    // VIKTIG FIX: Hent equipment basert på included_equipment_ids hvis spesifisert
    let equipmentResult;
    if (order.included_equipment_ids && order.included_equipment_ids.length > 0) {
      // Hent KUN inkluderte anlegg
      console.log('Fetching only included equipment:', order.included_equipment_ids);
      equipmentResult = await pool.query(
        `SELECT 
            e.*, 
            e.data as data,
            COALESCE(sr.status, 'not_started') as service_status,
            COALESCE(sr.status, 'not_started') as service_report_status
        FROM equipment e
        LEFT JOIN service_reports sr ON (sr.equipment_id = e.id AND sr.order_id = $1)
        WHERE e.id = ANY($2)`,
        [order.id, order.included_equipment_ids]  // KORREKT PARAMETER REKKEFØLGE
      );
    } else {
      // Bakoverkompatibel: hvis ingen spesifikke anlegg er valgt, hent alle aktive
      console.log('No specific equipment selected, fetching all active equipment');
      equipmentResult = await pool.query(
        `SELECT 
            e.*, 
            e.data as data,
            COALESCE(sr.status, 'not_started') as service_status,
            COALESCE(sr.status, 'not_started') as service_report_status
        FROM equipment e
        LEFT JOIN service_reports sr ON (sr.equipment_id = e.id AND sr.order_id = $1)
        WHERE e.customer_id = $2 
        AND (e.data->>'status' IS NULL OR e.data->>'status' = 'active')`,
        [order.id, customer.id]  // KORREKT PARAMETER REKKEFØLGE
      );
    }

    const equipment = equipmentResult.rows.map(eq => ({
        id: eq.id,
        type: eq.type,
        name: eq.name,
        location: eq.location,
        serviceStatus: eq.service_status || 'not_started',
        systemNumber: eq.system_number || '',
        systemType: eq.system_type || '',
        operator: eq.operator || '',
        data: eq.data,
        serviceReportStatus: eq.service_report_status || 'not_started',
        internalNotes: eq.data?.internalNotes || ''
    }));

    // Fetch technician data
    const technicianResult = await pool.query('SELECT * FROM technicians WHERE id = $1', [order.technician_id]);
    const technician = technicianResult.rows[0] || {};
    
    let quotes = [];
    try {
      const quotesResult = await pool.query(`
        SELECT 
          q.*,
          q.items::jsonb as items_data
        FROM quotes q 
        WHERE q.order_id = $1
        ORDER BY q.created_at DESC
      `, [req.params.id]);
      
      quotes = quotesResult.rows.map(quote => {
        const itemsData = typeof quote.items_data === 'string' ? JSON.parse(quote.items_data) : quote.items_data;
        
        return {
          ...quote,
          description: itemsData?.description || '',
          estimatedHours: itemsData?.estimatedHours || 0,
          estimatedPrice: quote.total_amount,
          products: itemsData?.products || [],
          items: itemsData?.products || []
        };
      });
    } catch (error) {
      console.log('Could not fetch quotes for order:', req.params.id);
      // quotes forblir tom array
    }

    res.json({
      order: {
          ...order,
          customer_data: customer,
          // VIKTIG: Send med included_equipment_ids til frontend
          included_equipment_ids: order.included_equipment_ids || null
      },
      customer: customer,
      equipment: equipment,
      technician: technician,
      quotes: quotes
    });
    
  } catch (error) {
    console.error('Error fetching order:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, technicianId } = req.body;
    
    console.log('PUT /api/orders/:id request:', {
      orderId: id,
      body: req.body,
      hasStatus: !!status,
      hasTechnicianId: !!technicianId,
      sessionTechnicianId: req.session.technicianId
    });
    
    const pool = await db.getTenantConnection(req.session.tenantId);
    
    // TEKNIKER-OVERTAGELSE: Hvis technicianId er sendt
    if (technicianId) {
      console.log(`🔄 Order ${id}: Tekniker ${req.session.technicianId} overtaking order`);
      
      // FIKSET: Oppdater KUN technician_id (uten updated_at som ikke eksisterer)
      const result = await pool.query(
        `UPDATE orders 
         SET technician_id = $1
         WHERE id = $2 
         RETURNING id, technician_id, scheduled_date, customer_name`,
        [technicianId, id]
      );
      
      if (result.rows.length === 0) {
        console.log(`❌ Order ${id} not found for takeover`);
        return res.status(404).json({ error: 'Ordre ikke funnet' });
      }
      
      const updatedOrder = result.rows[0];
      console.log(`✅ Order ${id} overtatt av tekniker ${technicianId}`);
      console.log(`   Scheduled date BEVART: ${updatedOrder.scheduled_date}`);
      
      res.json({ 
        message: 'Ordre overtatt successfully',
        order: updatedOrder,
        debug: {
          oldTechnician: req.session.technicianId,
          newTechnician: technicianId,
          preservedScheduledDate: updatedOrder.scheduled_date
        }
      });
      return;
    }
    
    // STATUS OPPDATERING: Hvis status er sendt (eksisterende funksjonalitet)
    if (status) {
      console.log(`🔄 Order ${id}: Status update to ${status}`);
      
      const result = await pool.query(
        `UPDATE orders 
         SET status = $1
         WHERE id = $2 AND technician_id = $3 
         RETURNING *`,
        [status, id, req.session.technicianId]
      );
      
      if (result.rows.length === 0) {
        console.log(`❌ Order ${id} not found or not owned by technician ${req.session.technicianId}`);
        return res.status(404).json({ 
          error: 'Ordre ikke funnet eller tilhører ikke denne teknikeren' 
        });
      }
      
      console.log(`✅ Order ${id} updated to status: ${status}`);
      res.json(result.rows[0]);
      return;
    }
    
    // Ingen valid parameter sendt
    console.log(`❌ Invalid PUT request - missing both status and technicianId`);
    return res.status(400).json({ 
      error: 'Enten status eller technicianId må sendes for å oppdatere ordre',
      receivedBody: req.body
    });
    
  } catch (error) {
    console.error('Error updating order:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Server error',
      details: error.message,
      orderId: req.params.id
    });
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
    
    // Hent ordre med included_equipment_ids
    const orderResult = await pool.query(
      'SELECT included_equipment_ids FROM orders WHERE id = $1',
      [orderId]
    );
    
    if (orderResult.rows.length === 0) {
      throw new Error('Ordre ikke funnet');
    }
    
    const includedEquipmentIds = orderResult.rows[0].included_equipment_ids;
    console.log('Inkluderte anlegg:', includedEquipmentIds);
    
    // Oppdater ordre status til completed
    await pool.query(
      'UPDATE orders SET status = $1 WHERE id = $2',
      ['completed', orderId]
    );
   
    // Hent service_reports - FILTRER på included_equipment_ids hvis spesifisert
    let query;
    let params;
    
    if (includedEquipmentIds && includedEquipmentIds.length > 0) {
      // Kun generer PDF for valgte anlegg
      query = `
        SELECT sr.*, e.type as equipment_type, e.name as equipment_name
        FROM service_reports sr
        JOIN equipment e ON sr.equipment_id = e.id
        WHERE sr.order_id = $1 
        AND sr.status = 'completed'
        AND sr.equipment_id = ANY($2)
      `;
      params = [orderId, includedEquipmentIds];
    } else {
      // Bakoverkompatibel: Generer for alle anlegg hvis ingen er spesifikt valgt
      query = `
        SELECT sr.*, e.type as equipment_type, e.name as equipment_name
        FROM service_reports sr
        JOIN equipment e ON sr.equipment_id = e.id
        WHERE sr.order_id = $1 
        AND sr.status = 'completed'
      `;
      params = [orderId];
    }
    
    serviceReportsResult = await pool.query(query, params);
    
    console.log(`📋 Fant ${serviceReportsResult.rows.length} rapporter å generere PDF-er for (av ${includedEquipmentIds?.length || 'alle'} valgte anlegg)`);
    
    // Generer PDF-er for filtrerte rapporter
    if (serviceReportsResult.rows.length > 0) {
      try {
        pdfGenerator = new UnifiedPDFGenerator();
        
        for (const report of serviceReportsResult.rows) {
          try {
            console.log(`📄 Genererer PDF for rapport ${report.id} (${report.equipment_type})...`);
            
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
          }
        }
        
      } catch (pdfInitError) {
        console.error('❌ Kunne ikke opprette PDF-generator:', pdfInitError.message);
      }
    }
    
    // Commit transaksjon
    await pool.query('COMMIT');
    
    console.log(`✅ Ordre ${orderId} ferdigstilt med ${generatedPDFs.length} PDF-er generert`);
    
    res.json({
      success: true,
      orderId: orderId,
      message: generatedPDFs.length > 0 
        ? `Ordre ferdigstilt med ${generatedPDFs.length} servicerapporter`
        : 'Ordre ferdigstilt',
      generatedPDFs: generatedPDFs,
      includedEquipmentCount: includedEquipmentIds?.length || 'alle'
    });
    
  } catch (error) {
    if (pool) {
      await pool.query('ROLLBACK');
    }
    console.error('❌ Feil ved ferdigstilling av ordre:', error);
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

// PATCH update selected equipment for order
  router.patch('/:orderId/equipment', async (req, res) => {
    try {
      const { orderId } = req.params;
      const { includedEquipmentIds } = req.body;
      
      console.log('Updating equipment selection for order:', orderId);
      console.log('New equipment IDs:', includedEquipmentIds);
      
      const pool = await db.getTenantConnection(req.session.tenantId);
      
      // Konverter til JSON string for JSONB
      const equipmentIdsJsonString = includedEquipmentIds && Array.isArray(includedEquipmentIds) && includedEquipmentIds.length > 0
        ? JSON.stringify(includedEquipmentIds)
        : null;
      
      // Oppdater included_equipment_ids som JSONB
      const result = await pool.query(
        'UPDATE orders SET included_equipment_ids = $1::jsonb WHERE id = $2 AND technician_id = $3 RETURNING *',
        [equipmentIdsJsonString, orderId, req.session.technicianId]
      );
      
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Ordre ikke funnet eller tilhører ikke denne teknikeren' });
      }
      
      res.json({
        success: true,
        orderId: orderId,
        includedEquipmentIds: result.rows[0].included_equipment_ids,
        message: 'Anleggsvalg oppdatert'
      });
      
    } catch (error) {
      console.error('Error updating equipment selection:', error);
      res.status(500).json({ error: 'Server error', details: error.message });
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

// POST create new order (for teknikere)
router.post('/', async (req, res) => {
  try {
    const { 
      customerId, 
      customerName, 
      customerData,
      description, 
      serviceType, 
      scheduledDate,
      includedEquipmentIds
    } = req.body;
    
    console.log('=== TECHNICIAN CREATE ORDER REQUEST ===');
    console.log('Body:', req.body);
    console.log('Technician ID:', req.session.technicianId);
    
    if (!customerId || !customerName) {
      return res.status(400).json({ error: 'Customer ID and name are required' });
    }
    
    const pool = await db.getTenantConnection(req.session.tenantId);
    const orderId = `PROJ-${new Date().getFullYear()}-${Date.now()}`;
    
    // Opprett customer_data objekt
    const customer_data = {
      id: String(customerId),
      name: String(customerName),
      snapshot_date: new Date().toISOString()
    };
    
    // Merge med eksisterende customerData hvis sendt
    if (customerData && typeof customerData === 'object') {
      Object.assign(customer_data, customerData);
    }
    
    console.log('Customer data objekt:', customer_data);
    
    // Build INSERT query
    const insertQuery = `
      INSERT INTO orders (
        id, 
        customer_id, 
        customer_name, 
        customer_data, 
        description, 
        service_type, 
        technician_id, 
        scheduled_date, 
        status, 
        included_equipment_ids
      ) VALUES (
        $1, 
        $2::integer, 
        $3, 
        $4::jsonb, 
        $5, 
        $6, 
        $7, 
        $8::date, 
        $9, 
        $10::jsonb
      ) RETURNING *
    `;
    
    // Håndter equipment IDs
    let equipmentIdsJsonString = null;
    if (includedEquipmentIds && Array.isArray(includedEquipmentIds) && includedEquipmentIds.length > 0) {
      equipmentIdsJsonString = JSON.stringify(includedEquipmentIds);
    }
    
    const params = [
      orderId,                                    // $1 - ordre ID
      parseInt(customerId),                       // $2 - kunde ID
      String(customerName),                       // $3 - kunde navn
      JSON.stringify(customer_data),              // $4 - kunde data
      description || null,                        // $5 - beskrivelse
      serviceType || 'Generell service',         // $6 - service type
      req.session.technicianId,                   // $7 - tekniker ID (fra session)
      scheduledDate || null,                      // $8 - planlagt dato
      'scheduled',                                // $9 - status (alltid scheduled for teknikere)
      equipmentIdsJsonString                      // $10 - utstyr IDs
    ];
    
    console.log('INSERT params:', params);
    
    // Kjør INSERT
    const result = await pool.query(insertQuery, params);
    
    // Legg til orderNumber for frontend
    result.rows[0].orderNumber = `SO-${orderId.split('-')[1]}-${orderId.split('-')[2].slice(-6)}`;
    
    console.log('✅ Order created successfully by technician:', {
      id: result.rows[0].id,
      technicianId: req.session.technicianId
    });
    
    res.status(201).json(result.rows[0]);
    
  } catch (error) {
    console.error('=== TECHNICIAN ORDER CREATE ERROR ===');
    console.error('Error:', error);
    res.status(500).json({ 
      error: error.message,
      detail: 'Se server logs for detaljer'
    });
  }
});

module.exports = router;