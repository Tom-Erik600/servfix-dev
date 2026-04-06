const express = require('express');
const db = require('../config/database');
const path = require('path');
const fs = require('fs').promises;

const customerService = require('../services/customerService');
const { requireTenant } = require('../middleware/auth');

const router = express.Router();

// In-memory progress store: orderId → { pct, label, done, error }
const pdfProgressStore = new Map();

function setPdfProgress(orderId, pct, label, { done = false, error = null } = {}) {
  pdfProgressStore.set(String(orderId), { pct, label, done, error, updatedAt: Date.now() });
}

// Clean up entries older than 10 minutes to avoid memory leaks
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [key, val] of pdfProgressStore.entries()) {
    if (val.updatedAt < cutoff) pdfProgressStore.delete(key);
  }
}, 60 * 1000);

// Middleware - sjekk auth og tenant
router.use((req, res, next) => {
  if (!req.session.technicianId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
});
router.use(requireTenant);

/**
 * Berik ordrer med kontaktperson fra lokal customer_contacts-tabell.
 * Prøver først customer_id som lokal ID, deretter som external_id (Tripletex).
 */
async function enrichOrdersWithContacts(orders, tenantId) {
  const pool = await db.getTenantConnection(tenantId);

  // Samle unike customer_ids
  const customerIds = [...new Set(orders.map(o => o.customer_id).filter(Boolean))];
  if (customerIds.length === 0) return orders;

  // Hent alle relevante kunder og kontakter i bulk
  const contactMap = new Map(); // customer_id (fra ordre) -> kontaktinfo

  for (const custId of customerIds) {
    try {
      // Prøv direkte lokal ID først
      let localCustomer = await customerService.getCustomer(tenantId, custId);

      // Hvis ikke funnet, prøv som Tripletex external_id
      if (!localCustomer) {
        localCustomer = await customerService.getCustomerByExternalId(tenantId, String(custId));
      }

      if (localCustomer) {
        // Hent primær kontaktperson (ikke rapport-mottaker)
        const contacts = await customerService.getContacts(tenantId, localCustomer.id);
        const primaryContact = contacts.find(c => !c.is_report_recipient) || contacts[0];

        contactMap.set(String(custId), {
          contact: primaryContact?.name || null,
          contactPhone: primaryContact?.phone || null,
          contactEmail: primaryContact?.email || null,
          localPhone: localCustomer.phone || null,
          localEmail: localCustomer.email || null
        });
      }
    } catch (err) {
      // Ignorer feil per kunde, bruk fallback
    }
  }

  // Berik ordrene
  return orders.map(order => {
    const enrichment = contactMap.get(String(order.customer_id));
    if (!enrichment) return order;

    // Parse customer_data hvis nødvendig
    let customerData = order.customer_data;
    if (typeof customerData === 'string') {
      try { customerData = JSON.parse(customerData); } catch (e) { customerData = {}; }
    }
    customerData = customerData || {};

    // Berik med lokale kontaktdata (lokalt overstyrer snapshot)
    if (enrichment.contact) customerData.contact = enrichment.contact;
    if (enrichment.contactPhone) customerData.contactPhone = enrichment.contactPhone;
    if (enrichment.contactEmail) customerData.contactEmail = enrichment.contactEmail;
    // Fyll inn telefon/epost fra lokal kunde hvis mangler
    if (!customerData.phone && enrichment.localPhone) customerData.phone = enrichment.localPhone;
    if (!customerData.email && enrichment.localEmail) customerData.email = enrichment.localEmail;

    return { ...order, customer_data: customerData };
  });
}

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
                    e.customer_id, 
                    e.systemtype, 
                    e.systemnummer, 
                    e.systemnavn, 
                    e.plassering, 
                    e.betjener, 
                    e.location, 
                    e.status,
                    e.notater,
                    COALESCE(sr.status, 'not_started') as service_status,
                    COALESCE(sr.status, 'not_started') as service_report_status
                FROM equipment e
                LEFT JOIN service_reports sr ON (sr.equipment_id = e.id AND sr.order_id = $2)
                WHERE e.customer_id = $1 AND e.status = 'active'`,
                [parseInt(order.customer_id), order.id]
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

    // Berik med kontaktpersoner fra lokal DB
    const enrichedOrders = await enrichOrdersWithContacts(ordersWithEquipment, req.session.tenantId);
    res.json(enrichedOrders);
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
                [parseInt(order.customer_id), order.id]
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

    // Berik med kontaktpersoner fra lokal DB
    const enrichedOrders = await enrichOrdersWithContacts(ordersWithEquipment, req.session.tenantId);
    res.json(enrichedOrders);

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
    
    // Parse customer_data for alle ordrer
    const ordersWithNumber = result.rows.map(order => {
        // Parse customer_data hvis det er string
        if (order.customer_data && typeof order.customer_data === 'string') {
            try {
                order.customer_data = JSON.parse(order.customer_data);
            } catch (e) {
                console.error('Failed to parse customer_data for order:', order.id);
                order.customer_data = {};
            }
        }
        
        return {
            ...order,
            orderNumber: `SO-${order.id.split('-')[1]}-${order.id.split('-')[2].slice(-6)}`,
            technicianId: order.technician_id,
            customerId: order.customer_id,
            plannedDate: order.scheduled_date,
            type: order.service_type
        };
    });
    
    console.log(`Found ${ordersWithNumber.length} total orders`);

    // Berik med kontaktpersoner fra lokal DB
    const enrichedOrders = await enrichOrdersWithContacts(ordersWithNumber, req.session.tenantId);
    res.json(enrichedOrders);

  } catch (error) {
    console.error('Error fetching all orders:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const pool = await db.getTenantConnection(req.session.tenantId);
    
    console.log('📋 Fetching order:', id);

    // 1. Hent ordre med tekniker-info
    const orderResult = await pool.query(
      `SELECT o.*, t.name as technician_name, t.id as tech_id
       FROM orders o
       LEFT JOIN technicians t ON o.technician_id = t.id
       WHERE o.id = $1`,
      [id]
    );
    
    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Ordre ikke funnet' });
    }

    const order = orderResult.rows[0];
    
    // KRITISK FIX: Parse customer_data hvis det er en string
    if (order.customer_data && typeof order.customer_data === 'string') {
        try {
            order.customer_data = JSON.parse(order.customer_data);
            console.log('✅ Parsed customer_data:', order.customer_data);
        } catch (e) {
            console.error('❌ Failed to parse customer_data:', e);
            order.customer_data = {};
        }
    }
    
    console.log('✅ Order found:', order.id);
    console.log('📦 Customer name:', order.customer_data?.name);
    console.log('📍 Physical address:', order.customer_data?.physicalAddress);

    // 2. Hent equipment for denne kunden med service status
    const equipmentResult = await pool.query(
        `SELECT 
            e.id, 
            e.systemtype, 
            e.systemnummer, 
            e.systemnavn, 
            e.plassering, 
            e.betjener, 
            e.location, 
            e.status as equipment_status,
            e.notater,
            COALESCE(sr.status, 'not_started') as service_status,
            COALESCE(sr.status, 'not_started') as service_report_status
        FROM equipment e
        LEFT JOIN service_reports sr ON (sr.equipment_id = e.id AND sr.order_id = $2)
        WHERE e.customer_id = $1 AND e.status = 'active'`,
        [parseInt(order.customer_id), order.id]
    );

    // 3. Map equipment med status
    const equipment = equipmentResult.rows.map(eq => ({
        ...eq,
        serviceStatus: eq.service_status === 'draft' ? 'in_progress' : eq.service_status,
        serviceReportStatus: eq.service_report_status === 'draft' ? 'in_progress' : eq.service_report_status
    }));

    // 4. Parse included_equipment_ids hvis det er string
    if (order.included_equipment_ids && typeof order.included_equipment_ids === 'string') {
        try {
            order.included_equipment_ids = JSON.parse(order.included_equipment_ids);
        } catch (e) {
            console.error('Failed to parse included_equipment_ids:', e);
            order.included_equipment_ids = [];
        }
    }

    // 5. Send final response MED PARSED customer_data og tekniker
    res.json({
        ...order,
        orderNumber: `SO-${order.id.split('-')[1]}-${order.id.split('-')[2].slice(-6)}`,
        equipment: equipment,
        // CRITICAL: Sørg for at customer_data er inkludert og parsed
        customer_data: order.customer_data || {},
        technician: order.technician_id ? { id: order.tech_id, name: order.technician_name } : null
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
      if (technicianId !== req.session.technicianId) {
        return res.status(403).json({
          error: 'Tekniker kan kun overta ordre til seg selv'
        });
      }

      console.log(`🔄 Order ${id}: Tekniker ${req.session.technicianId} overtaking order`);
      
      // Tillat takeover kun for ikke-fullførte ordre, og kun til innlogget tekniker
      const result = await pool.query(
        `UPDATE orders 
         SET technician_id = $1
         WHERE id = $2
           AND status != 'completed'
         RETURNING id, technician_id, scheduled_date, customer_name, status`,
        [technicianId, id]
      );
      
      if (result.rows.length === 0) {
        const existingOrder = await pool.query(
          'SELECT id, status FROM orders WHERE id = $1',
          [id]
        );

        if (existingOrder.rows.length === 0) {
          console.log(`❌ Order ${id} not found for takeover`);
          return res.status(404).json({ error: 'Ordre ikke funnet' });
        }

        if (existingOrder.rows[0].status === 'completed') {
          return res.status(409).json({ error: 'Fullførte ordre kan ikke overtas' });
        }

        return res.status(400).json({ error: 'Ordre kunne ikke overtas' });
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
  const { includedEquipmentIds } = req.body;
  const tenantId = req.tenantId || req.session.tenantId;
  
  if (!req.session.technicianId) {
    return res.status(401).json({ error: 'Ikke autentisert' });
  }

  let pool;

  try {
    pool = await db.getTenantConnection(tenantId);
    
    // Start transaksjon
    await pool.query('BEGIN');
    
    console.log(`🚀 Ferdigstiller ordre ${orderId}...`);
    
    // Sjekk at ordren finnes
    const orderResult = await pool.query(
      'SELECT id FROM orders WHERE id = $1',
      [orderId]
    );
    
    if (orderResult.rows.length === 0) {
      throw new Error('Ordre ikke funnet');
    }
    
    // Oppdater ordre status til completed
    console.log(`📝 Attempting to UPDATE order ${orderId} to completed...`);
    const statusUpdate = await pool.query(
      'UPDATE orders SET status = $1 WHERE id = $2 RETURNING id, status',
      ['completed', orderId]
    );

    if (statusUpdate.rows.length === 0) {
      console.error(`❌ UPDATE returned 0 rows! Order ${orderId} not found?`);
      throw new Error('Order not found for status update');
    }

    console.log(`✅ Order status UPDATED in transaction:`, statusUpdate.rows[0]);

    // Filtrer service_reports til kun inkluderte anlegg hvis spesifisert
    if (includedEquipmentIds && Array.isArray(includedEquipmentIds) && includedEquipmentIds.length > 0) {
      // Sett rapporter for ikke-inkluderte anlegg tilbake til draft så de ikke havner i PDF
      await pool.query(
        `UPDATE service_reports SET status = 'excluded'
         WHERE order_id = $1
           AND equipment_id NOT IN (SELECT unnest($2::int[]))
           AND status = 'completed'`,
        [orderId, includedEquipmentIds]
      );
      console.log(`📋 Ekskluderte anlegg satt til 'excluded' (ikke med i PDF)`);
    }

    // Verify status before commit
    const verifyQuery = await pool.query(
      'SELECT id, status FROM orders WHERE id = $1',
      [orderId]
    );
    console.log(`🔍 Status BEFORE COMMIT:`, verifyQuery.rows[0]);

    // Commit transaksjon
    await pool.query('COMMIT');
    console.log(`✅ COMMIT successful!`);

    // Svar klienten umiddelbart etter commit — PDF-generering skjer asynkront
    res.json({
      success: true,
      orderId: orderId,
      message: 'Ordre ferdigstilt — servicerapport genereres',
      pdfGenerated: false,
      includedEquipmentCount: includedEquipmentIds?.length || 'alle'
    });

    // Generer PDF asynkront etter at svar er sendt (blokkerer ikke klienten)
    const pdfGenerator = new UnifiedPDFGenerator();
    console.log(`📄 Genererer ordre-PDF for ${orderId} (asynkront)...`);
    setPdfProgress(orderId, 0, 'Starter...');
    pdfGenerator.generateOrderReport(orderId, tenantId, (pct, label) => {
      setPdfProgress(orderId, pct, label);
    })
      .then(() => {
        setPdfProgress(orderId, 100, 'Ferdig!', { done: true });
        console.log(`✅ Ordre ${orderId}: PDF generert`);
      })
      .catch(err => {
        setPdfProgress(orderId, 0, 'Feil ved generering', { done: true, error: err.message });
        console.error(`❌ PDF-generering feilet for ordre ${orderId}:`, err.message);
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

// Hent PDF-status for en ordre (brukes av frontend til polling etter ferdigstilling)
router.get('/:orderId/pdf-status', async (req, res) => {
  const { orderId } = req.params;
  const tenantId = req.tenantId || req.session.tenantId;

  if (!req.session.technicianId) {
    return res.status(401).json({ error: 'Ikke autentisert' });
  }

  try {
    const pool = await db.getTenantConnection(tenantId);
    const result = await pool.query(
      'SELECT pdf_generated, pdf_path FROM orders WHERE id = $1',
      [orderId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Ordre ikke funnet' });
    }

    const { pdf_generated, pdf_path } = result.rows[0];
    res.json({ pdfGenerated: pdf_generated || false, pdfPath: pdf_path || null });
  } catch (error) {
    console.error('❌ Feil ved henting av PDF-status:', error.message);
    res.status(500).json({ error: 'Kunne ikke hente PDF-status' });
  }
});

// SSE: stream PDF-genereringsfremgang til klienten
router.get('/:orderId/pdf-progress', (req, res) => {
  const { orderId } = req.params;

  if (!req.session.technicianId) {
    return res.status(401).end();
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Send current state immediately so client isn't stuck waiting
  const current = pdfProgressStore.get(String(orderId));
  if (current) sendEvent(current);

  const POLL_MS = 500;
  const interval = setInterval(() => {
    const state = pdfProgressStore.get(String(orderId));
    if (!state) return;

    sendEvent(state);

    if (state.done) {
      clearInterval(interval);
      res.end();
    }
  }, POLL_MS);

  req.on('close', () => clearInterval(interval));
});

// Hent alle rapporter for en ordre med PDF-status
router.get('/:id/reports', async (req, res) => {  try {
    const { id: orderId } = req.params;
    const tenantId = req.session.tenantId;
    
    const pool = await db.getTenantConnection(tenantId);
    
    const result = await pool.query(
      `SELECT 
        sr.*,
        e.systemnavn as equipment_name,
        e.systemtype as equipment_type
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
    const pdfBuffer = await pdfGenerator.generatePDF(html, companySettings);
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
    
    // Hent adresser fra lokal DB hvis ikke allerede i customerData
    if (!customer_data.physicalAddress || !customer_data.postalAddress) {
      try {
        const customerService = require('../services/customerService');
        const tenantId = req.session.tenantId;
        const localCustomer = await customerService.getCustomer(tenantId, customerId);
        if (localCustomer) {
          if (!customer_data.physicalAddress) {
            customer_data.physicalAddress = localCustomer.physical_address || '';
          }
          if (!customer_data.postalAddress) {
            customer_data.postalAddress = localCustomer.postal_address || '';
          }
          console.log('✅ Fetched addresses from local DB for new order');
        }
      } catch (error) {
        console.error('⚠️ Could not fetch addresses from local DB:', error.message);
      }
    }
    
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

// POST regenerate reports for completed order
router.post('/:id/regenerate-reports', async (req, res) => {
  try {
    const { id: orderId } = req.params;
    const tenantId = req.session.tenantId;
    
    console.log(`🔄 Regenerating report for order ${orderId}`);
    
    const pool = await db.getTenantConnection(tenantId);
    
    // Sjekk at ordren eksisterer og er ferdigstilt
    const orderCheck = await pool.query(
      'SELECT id, status, customer_name FROM orders WHERE id = $1',
      [orderId]
    );
    
    if (orderCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Ordre ikke funnet' });
    }
    
    const order = orderCheck.rows[0];
    if (order.status !== 'completed') {
      return res.status(400).json({ error: 'Kan kun regenerere rapporter for ferdigstilte ordre' });
    }
    
    // Generer én ny samlet PDF for ordren
    const UnifiedPDFGenerator = require('../services/unifiedPdfGenerator');
    const pdfGenerator = new UnifiedPDFGenerator();
    
    let pdfPath;
    try {
      pdfPath = await pdfGenerator.generateOrderReport(orderId, tenantId);
    } catch (pdfError) {
      console.error(`❌ Failed to regenerate PDF for order ${orderId}:`, pdfError);
      return res.status(500).json({
        error: 'Kunne ikke regenerere rapport',
        details: pdfError.message
      });
    }
    
    console.log(`✅ PDF regenerated for order ${orderId}: ${pdfPath}`);
    
    res.json({
      success: true,
      message: 'Servicerapport regenerert',
      pdfPath,
      stats: { total: 1, successful: 1, failed: 0 }
    });
    
  } catch (error) {
    console.error('❌ Feil ved regenerering av rapport:', error);
    res.status(500).json({ 
      error: 'Kunne ikke regenerere rapport',
      details: error.message 
    });
  }
});

module.exports = router;
