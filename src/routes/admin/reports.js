// src/routes/admin/reports.js - FIX: Legg til orderId filtering
const express = require('express');
const router = express.Router();
const db = require('../../config/database');
const gcs = require('../../config/gcs');
const adminTenant = require('../../middleware/admin-tenant');

// 🔒 Delt middleware: Admin auth + tenant-isolasjon med validering
router.use(adminTenant);

// GET all reports - GRUPPERER PER ORDRE
router.get('/', async (req, res) => {
  const debugSteps = [];
  
  try {
    const { orderId } = req.query;
    
    debugSteps.push('Getting DB connection...');
    const pool = await db.getTenantConnection(req.adminTenantId);
    debugSteps.push('✅ DB connection OK');
    
    // Build query med conditional WHERE clause
    // Viktig: Ved eksplisitt orderId-søk (brukes i kundemodal) skal vi kunne
    // finne historiske ordre selv om statusfelt ikke er perfekt synkronisert.
    // Standardliste (uten orderId) holder fortsatt kun completed-ordre.
    let whereClause;
    let queryParams = [];

    if (orderId) {
      whereClause = 'WHERE sr.order_id = $1';
      queryParams.push(orderId);
      debugSteps.push(`🔍 Filtering by orderId (status-agnostic): ${orderId}`);
    } else {
      whereClause = "WHERE sr.status = 'completed' AND o.status = 'completed'";
      debugSteps.push('📋 Getting all completed reports');
    }
    
    // NYE QUERY: Grupper per ordre og les PDF/faktura-state direkte fra orders-tabellen
    const query = `
      WITH order_equipment AS (
        SELECT 
          sr.order_id,
          o.description as order_description,
          o.customer_name,
          o.customer_id,
          o.customer_data->>'physicalAddress' as delivery_address,
          pc.name AS contact_name,
          pc.phone AS contact_phone,
          o.scheduled_date,
          o.service_type,
          o.created_at as order_date,
          -- PDF- og faktura-state leses nå direkte fra orders (korrekt datalagnivå)
          o.pdf_path,
          o.pdf_generated,
          o.sent_til_fakturering,
          o.pdf_sent_timestamp,
          o.is_invoiced,
          o.invoice_number,
          o.invoice_date,
          o.invoice_comment,
          MIN(sr.created_at) as first_service_date,
          o.scheduled_date as last_service_date,
          t.name as technician_name,
          -- Tell avvik på tvers av alle rapporter for denne ordren (regex-basert, trygg mot ugyldige JSON-strukturer)
          (
            SELECT COUNT(*)::int
            FROM service_reports sr2
            WHERE sr2.order_id = sr.order_id
              AND sr2.checklist_data IS NOT NULL
              AND sr2.checklist_data::text ~ '"status"\s*:\s*"[Aa]vvik"'
          ) as avvik_count,
          -- Tell rapporter uten avvik (alle sjekkpunkter ok)
          (
            SELECT COUNT(*)::int
            FROM service_reports sr2
            WHERE sr2.order_id = sr.order_id
              AND sr2.checklist_data IS NOT NULL
              AND sr2.checklist_data::text !~ '"status"\s*:\s*"[Aa]vvik"'
              AND sr2.checklist_data::text ~ '"status"\s*:\s*"[Oo][Kk]"'
          ) as ok_count,
          -- Concatenate alle anlegg med komma
          STRING_AGG(DISTINCT e.systemnavn, ', ' ORDER BY e.systemnavn) as equipment_names,
          STRING_AGG(DISTINCT e.systemtype, ', ' ORDER BY e.systemtype) as equipment_types,
          -- Bevar kobling mellom systemnavn og systemtype (unngå mismatch ved separat string_agg)
          JSONB_AGG(
            DISTINCT jsonb_build_object(
              'name', e.systemnavn,
              'type', e.systemtype
            )
          ) FILTER (WHERE e.systemnavn IS NOT NULL) as equipment_items,
          -- Tell antall anlegg
          COUNT(DISTINCT sr.equipment_id) as equipment_count,
          -- Samle alle rapport-IDer for denne ordren
          ARRAY_AGG(sr.id ORDER BY sr.created_at) as report_ids
        FROM service_reports sr
        LEFT JOIN orders o ON sr.order_id = o.id
        LEFT JOIN equipment e ON sr.equipment_id::varchar = e.id::varchar
        LEFT JOIN technicians t ON o.technician_id = t.id
        LEFT JOIN LATERAL (
          SELECT cc.name, cc.phone
          FROM customer_contacts cc
          WHERE cc.customer_id = CASE
            WHEN o.customer_id::text ~ '^[0-9]+$' THEN o.customer_id::integer
            ELSE NULL
          END
          ORDER BY cc.is_report_recipient DESC, cc.id ASC
          LIMIT 1
        ) pc ON true
        ${whereClause}
        GROUP BY sr.order_id, o.description, o.customer_name, o.customer_id,
                 o.customer_data->>'physicalAddress', pc.name, pc.phone,
                 o.scheduled_date, o.service_type, o.created_at, t.name,
                 o.pdf_path, o.pdf_generated, o.sent_til_fakturering, o.pdf_sent_timestamp,
                 o.is_invoiced, o.invoice_number, o.invoice_date, o.invoice_comment
        ORDER BY o.scheduled_date DESC NULLS LAST, MAX(sr.created_at) DESC
      )
      SELECT * FROM order_equipment
    `;
    
    debugSteps.push('Executing grouped query...');
    const result = await pool.query(query, queryParams);
    debugSteps.push(`✅ Query OK - ${result.rows.length} order groups`);
    
    // Hent rapport-mottaker e-post fra lokal customer_contacts
    const customerService = require('../../services/customerService');
    const ordersWithEmail = await Promise.all(result.rows.map(async (order) => {
      let customerEmail = null;

      if (order.customer_id) {
        try {
          const recipient = await customerService.getReportRecipientByExternalId(req.adminTenantId, order.customer_id);
          customerEmail = recipient?.email || null;
        } catch (error) {
          console.warn(`Could not fetch report recipient for customer ${order.customer_id}:`, error.message);
        }
      }

      return {
        ...order,
        customer_email: customerEmail,
        // PDF- og faktura-state kommer nå direkte fra orders — ingen aliasering nødvendig
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
    // Les primært fra orders via service_reports.
    // Fallback: les fra legacy service_reports-kolonner hvis ordredata mangler.
    const result = await pool.query(
      `SELECT o.pdf_path, o.pdf_generated,
              sr.pdf_path AS legacy_pdf_path,
              sr.pdf_generated AS legacy_pdf_generated
       FROM service_reports sr
       JOIN orders o ON o.id = sr.order_id
       WHERE sr.id = $1
       LIMIT 1`,
      [req.params.reportId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Rapport ikke funnet' });
    }
    
    const report = result.rows[0];

    const effectivePdfGenerated = Boolean(report.pdf_generated || report.legacy_pdf_generated);
    const effectivePdfPath = report.pdf_path || report.legacy_pdf_path;

    if (!effectivePdfGenerated || !effectivePdfPath) {
      return res.status(404).json({ error: 'PDF ikke generert' });
    }
    
    // MILJØ-SPESIFIKK HÅNDTERING  
    const isCloudRun = !!process.env.K_SERVICE;  // Google Cloud Run setter denne automatisk
    const useCloudStorage = isCloudRun || process.env.USE_CLOUD_STORAGE === 'true';
    
    console.log(`📄 Serving PDF: ${effectivePdfPath}`);
    console.log(`🔧 Environment: ${isCloudRun ? 'GOOGLE CLOUD RUN' : 'LOCAL DEVELOPMENT'}`);
    console.log(`☁️ Cloud Storage: ${useCloudStorage ? 'ENABLED' : 'DISABLED'}`);
    console.log(`🔧 K_SERVICE: ${process.env.K_SERVICE || 'not set'}`);
    
    if (useCloudStorage) {
      // PRODUKSJON: Redirect til Google Cloud Storage (F2: sentralisert bucket)
      const publicUrl = `https://storage.googleapis.com/${gcs.bucketName}/tenants/${req.adminTenantId}/${effectivePdfPath}`;
      console.log(`🌐 Redirecting to GCS: ${publicUrl}`);
      res.redirect(publicUrl);
    } else {
      // DEVELOPMENT: Serve fra lokal fil
      const path = require('path');
      const localPath = path.join(__dirname, `../../servfix-files/tenants/${req.adminTenantId}/${effectivePdfPath}`);
      
      console.log(`💾 Serving local file: ${localPath}`);
      
      // Sjekk om fil eksisterer
      const fs = require('fs');
      if (!fs.existsSync(localPath)) {
        console.error(`❌ Local PDF file not found: ${localPath}`);
        return res.status(404).json({ 
          error: 'PDF-fil ikke funnet lokalt',
          path: effectivePdfPath,
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

    if (!order.pdf_generated || !order.pdf_path) {
      return res.status(400).json({ error: 'Ingen PDF generert for denne ordren' });
    }
    
    // Hent alle rapport-mottakere fra lokal customer_contacts
    const customerService = require('../../services/customerService');
    const recipients = await customerService.getReportRecipientsByExternalId(req.adminTenantId, order.customer_id);

    if (!recipients || recipients.length === 0) {
      return res.status(400).json({
        error: `Ingen rapport-mottaker funnet for kunde: ${order.customer_name}`,
        customer_id: order.customer_id
      });
    }

    const recipientEmails = recipients.map(r => r.email).filter(Boolean);
    if (recipientEmails.length === 0) {
      return res.status(400).json({
        error: `Rapport-mottakere mangler e-postadresse for kunde: ${order.customer_name}`,
        customer_id: order.customer_id
      });
    }
    
    // Hent alle rapporter for ordren (for anleggsliste i e-post)
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
    
    // Send e-post med ordre-PDF som vedlegg til alle mottakere
    const EmailService = require('../../services/emailService');
    await EmailService.init();
    
    const emailResult = await EmailService.sendOrderReportsToCustomer(
      orderId,
      req.adminTenantId,
      reportsResult.rows,
      recipientEmails,
      order
    );
    
    // Oppdater ordre (ikke service_reports) som sendt
    await pool.query(
      `UPDATE orders 
       SET sent_til_fakturering = true, pdf_sent_timestamp = NOW() 
       WHERE id = $1`,
      [orderId]
    );

    const sentToDisplay = recipientEmails.join(', ');
    res.json({
      success: true,
      message: `Servicerapport sendt til ${sentToDisplay}`,
      sentTo: recipientEmails,
      reportCount: reportsResult.rows.length
    });
    
  } catch (error) {
    console.error('Error sending order reports:', error.message, error.stack);
    res.status(500).json({
      error: 'Kunne ikke sende rapporter',
      details: error.message
    });
  }
});

// Mark as invoiced — oppdaterer orders-tabellen via rapport-ID
router.post('/:reportId/mark-invoiced', async (req, res) => {
  try {
    const pool = await db.getTenantConnection(req.adminTenantId);
    // Finn ordre-ID fra rapport og oppdater orders-tabellen
    await pool.query(
      `UPDATE orders o
       SET is_invoiced = $1
       FROM service_reports sr
       WHERE sr.id = $2 AND o.id = sr.order_id`,
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

// POST /order/:orderId/mark-done — sett ordre som ferdig behandlet (fjerner fra rapportlisten)
router.post('/order/:orderId/mark-done', async (req, res) => {
  try {
    const pool = await db.getTenantConnection(req.adminTenantId);
    const { orderId } = req.params;

    await pool.query(
      `UPDATE orders
       SET pdf_generated = true,
           pdf_sent_timestamp = COALESCE(pdf_sent_timestamp, NOW()),
           sent_til_fakturering = true,
           is_invoiced = true
       WHERE id = $1`,
      [orderId]
    );

    console.log(`✅ [REPORTS] Ordre ${orderId} satt som ferdig behandlet`);
    res.json({ success: true, message: `Ordre ${orderId} er satt som ferdig` });
  } catch (error) {
    console.error('Error marking order as done:', error);
    res.status(500).json({ error: error.message });
  }
});

// ✅ NYTT ENDPOINT: Fakturer hele ordren
router.put('/order/:orderId/invoice', async (req, res) => {
  const { orderId } = req.params;
  const { invoiced, invoiceNumber, comment } = req.body;
  
  console.log('📄 Invoice endpoint called:', { orderId, invoiced, invoiceNumber });
  
  try {
    const pool = await db.getTenantConnection(req.adminTenantId);
    
    if (invoiced && !invoiceNumber?.trim()) {
      return res.status(400).json({ 
        error: 'Fakturanummer er påkrevd' 
      });
    }
    
    const query = `
      UPDATE orders 
      SET 
        is_invoiced = $1,
        invoice_number = $2,
        invoice_date = $3,
        invoice_comment = $4
      WHERE id = $5
      RETURNING id, invoice_number
    `;
    
    const result = await pool.query(query, [
      invoiced,
      invoiced ? invoiceNumber.trim() : null,
      invoiced ? new Date() : null,
      comment?.trim() || null,
      orderId
    ]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Ordre ikke funnet' 
      });
    }
    
    console.log(`✅ Updated order ${orderId} invoice status`);
    
    res.json({ 
      success: true,
      message: invoiced 
        ? `Faktura ${invoiceNumber} registrert for ${result.rows.length} anlegg`
        : `Fakturastatus fjernet`,
      updatedCount: result.rows.length,
      invoiceNumber: invoiceNumber
    });
    
  } catch (error) {
    console.error('❌ Error updating invoice:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// GET /:reportId/edit-data - Hent rapport-data for redigering
// ========================================
router.get('/:reportId/edit-data', async (req, res) => {
  const { reportId } = req.params;

  console.log(`📝 Fetching edit data for report: ${reportId}`);

  try {
    const pool = await db.getTenantConnection(req.adminTenantId);

    // Hent rapport med alle nødvendige data
    const query = `
      SELECT
        sr.id,
        sr.order_id,
        sr.equipment_id,
        sr.checklist_data,
        sr.products_used,
        sr.additional_work,
        sr.status,
        sr.created_at,
        sr.completed_at,
        o.customer_name,
        o.description AS order_description,
        o.customer_data,
        o.scheduled_date,
        o.service_type,
        o.service_address_street,
        o.service_address_postal_code,
        o.service_address_city,
        e.systemnavn as equipment_name,
        e.systemtype as equipment_type,
        e.location as equipment_location,
        t.name as technician_name
      FROM service_reports sr
      LEFT JOIN orders o ON sr.order_id = o.id
      LEFT JOIN equipment e ON sr.equipment_id::varchar = e.id::varchar
      LEFT JOIN technicians t ON o.technician_id = t.id
      WHERE sr.id = $1
    `;

    const result = await pool.query(query, [reportId]);

    if (result.rows.length === 0) {
      console.log(`❌ Report not found: ${reportId}`);
      return res.status(404).json({ error: 'Rapport ikke funnet' });
    }

    const report = result.rows[0];

    // Parse JSON-felter safely
    const safeJsonParse = (input, fallback) => {
      try {
        if (!input) return fallback;
        if (typeof input === 'object') return input;
        return JSON.parse(input);
      } catch { return fallback; }
    };

    // Parse checklist_data
    const checklistData = safeJsonParse(report.checklist_data, {});

    // Hent checklist template for å få display names
    let templateItems = {};
    try {
      const templateQuery = `
        SELECT template_data
        FROM checklist_templates
        WHERE equipment_type = $1
        LIMIT 1
      `;
      const templateResult = await pool.query(templateQuery, [report.equipment_type]);

      if (templateResult.rows.length > 0) {
        const templateData = safeJsonParse(templateResult.rows[0].template_data, {});
        // Bygg lookup map fra template items
        if (templateData.checklistItems && Array.isArray(templateData.checklistItems)) {
          templateData.checklistItems.forEach(item => {
            if (item.id) {
              templateItems[item.id] = item.name || item.label || item.id;
            }
          });
        }
        // Også sjekk for sections struktur
        if (templateData.sections && Array.isArray(templateData.sections)) {
          templateData.sections.forEach(section => {
            if (section.items && Array.isArray(section.items)) {
              section.items.forEach(item => {
                if (item.id) {
                  templateItems[item.id] = item.name || item.label || item.id;
                }
              });
            }
          });
        }
        console.log(`   - Template items loaded: ${Object.keys(templateItems).length}`);
      }
    } catch (templateError) {
      console.warn('⚠️ Could not load template:', templateError.message);
    }

    // ✅ VIKTIG: Filtrer kun items som tekniker faktisk krysset av (har status OK/Avvik/Byttet)
    // Ikke vis items med N/A eller manglende status
    const actualChecklistData = checklistData.checklist || checklistData;
    const validStatuses = ['ok', 'avvik', 'byttet'];

    const filteredChecklistEntries = Object.entries(actualChecklistData).filter(([itemId, itemData]) => {
      const status = (itemData.status || '').toLowerCase();
      return validStatuses.includes(status);
    });

    console.log(`   - Total items in checklist_data: ${Object.keys(actualChecklistData).length}`);
    console.log(`   - Filtered items (only checked): ${filteredChecklistEntries.length}`);

    // Berik checklist_data med display names (label) - kun filtrerte items
    const enrichedChecklistData = {};
    for (const [itemId, itemData] of filteredChecklistEntries) {
      enrichedChecklistData[itemId] = {
        ...itemData,
        label: templateItems[itemId] || itemData.label || itemId.replace(/_/g, ' ')
      };
    }

    // Bygg checklist_items array for enklere frontend rendering - kun filtrerte items
    const checklistItems = filteredChecklistEntries.map(([itemId, itemData]) => {
      // ✅ FIX: Hent kommentar fra riktig sted basert på status
      // Tekniker-appen lagrer som avvikComment/byttetComment (flate felt)
      let comment = '';
      const statusLower = (itemData.status || '').toLowerCase();

      if (statusLower === 'avvik') {
        // Prøv flere mulige plasseringer for avvik-kommentar
        comment = itemData.avvikComment ||      // ← HOVEDKILDE (flatt felt fra tekniker-app)
                 itemData.avvik?.comment ||     // Nestet objekt (fallback)
                 itemData.comment || '';
      } else if (statusLower === 'byttet') {
        // Prøv flere mulige plasseringer for byttet-kommentar
        comment = itemData.byttetComment ||     // ← HOVEDKILDE (flatt felt fra tekniker-app)
                 itemData.byttet?.comment ||    // Nestet objekt (fallback)
                 itemData.comment || '';
      } else {
        comment = itemData.comment || '';
      }

      // ✅ FIX: hasCommentField - vis kun hvis item faktisk har kommentar ELLER er avvik/byttet
      const hasCommentField = Boolean(
        comment ||                    // Har faktisk kommentar
        itemData.avvik ||            // Har avvik-objekt
        itemData.byttet ||           // Har byttet-objekt
        itemData.avvikComment ||     // ← NYTT: Har avvikComment felt
        itemData.byttetComment ||    // ← NYTT: Har byttetComment felt
        statusLower === 'avvik' ||   // Status er avvik (selv uten comment)
        statusLower === 'byttet'     // Status er byttet (selv uten comment)
      );

      return {
        id: itemId,
        displayName: templateItems[itemId] || itemData.label || itemId.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        status: itemData.status || 'N/A',
        comment: comment,  // ✅ Bruker kommentar fra riktig sted
        images: itemData.images || [],
        hasCommentField: hasCommentField  // ✅ Kun vis textarea hvis nødvendig
      };
    });

    const customerData = safeJsonParse(report.customer_data, {});

    const toDateOnlyIso = (value) => {
      if (!value) return '';
      if (typeof value === 'string') {
        const dateOnlyMatch = value.match(/^(\d{4}-\d{2}-\d{2})/);
        if (dateOnlyMatch) return dateOnlyMatch[1];
      }

      const date = value instanceof Date ? value : new Date(value);
      return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
    };

    const serviceDateSource = customerData.service_date || report.scheduled_date;

    // ✅ Hent overall_comment fra checklistData (kan være i root eller i checklist objekt)
    const parsedChecklistData = safeJsonParse(report.checklist_data, {});
    const overallComment = parsedChecklistData.overallComment ||
                          parsedChecklistData.checklist?.overallComment ||
                          '';

    const responseData = {
      reportId: report.id,
      orderId: report.order_id,
      equipmentId: report.equipment_id,
      equipmentName: report.equipment_name,
      equipmentType: report.equipment_type,
      equipmentLocation: report.equipment_location,
      customerName: report.customer_name,
      orderDescription: report.order_description || '',
      technicianName: report.technician_name,
      scheduledDate: report.scheduled_date,
      serviceDate: toDateOnlyIso(serviceDateSource),
      serviceType: report.service_type,
      serviceAddress: {
        street: report.service_address_street || '',
        postalCode: report.service_address_postal_code || '',
        city: report.service_address_city || ''
      },
      status: report.status,
      createdAt: report.created_at,
      completedAt: report.completed_at,
      checklist_data: enrichedChecklistData,
      checklist_items: checklistItems,  // Array for enklere frontend rendering (kun kryssede av)
      products_used: safeJsonParse(report.products_used, []),
      additional_work: safeJsonParse(report.additional_work, []),
      overall_comment: overallComment,  // ✅ NYTT: Overall comment/oppsummering
      customer_data: {
        agreement_number: customerData.agreement_number || '',
        visit_number: customerData.visit_number || '',
        contact_person: customerData.contact_person || report.technician_name || '',
        ...customerData
      }
    };

    console.log(`✅ Edit data fetched for report: ${reportId}`);
    console.log(`   - Checklist items: ${Object.keys(responseData.checklist_data).length}`);
    console.log(`   - Products: ${responseData.products_used.length}`);
    console.log(`   - Additional work: ${responseData.additional_work.length}`);

    res.json(responseData);

  } catch (error) {
    console.error('❌ Error fetching edit data:', error);
    res.status(500).json({
      error: 'Kunne ikke hente rapport-data',
      details: error.message
    });
  }
});

// ========================================
// PUT /:reportId/update-content - Oppdater rapport med redigert innhold
// ========================================
router.put('/:reportId/update-content', async (req, res) => {
  const { reportId } = req.params;
  const { checklistComments, products_used, additional_work, metadata, overall_comment, serviceAddress, orderDescription, reportRecipient } = req.body;

  console.log(`📝 Updating content for report: ${reportId}`);
  console.log(`   - checklistComments: ${checklistComments ? Object.keys(checklistComments).length : 0} items`);
  console.log(`   - products_used: ${products_used?.length || 0} items`);
  console.log(`   - additional_work: ${additional_work?.length || 0} items`);
  console.log(`   - metadata: ${metadata ? 'provided' : 'not provided'}`);
  console.log(`   - overall_comment: ${overall_comment ? 'provided' : 'not provided'}`);

  try {
    const pool = await db.getTenantConnection(req.adminTenantId);

    // Valider at rapporten eksisterer
    const existingReport = await pool.query(
      'SELECT id, order_id, checklist_data FROM service_reports WHERE id = $1',
      [reportId]
    );

    if (existingReport.rows.length === 0) {
      console.log(`❌ Report not found: ${reportId}`);
      return res.status(404).json({ error: 'Rapport ikke funnet' });
    }

    const report = existingReport.rows[0];
    const orderId = report.order_id;

    // Parse eksisterende checklist_data
    let existingChecklistData = {};
    try {
      if (report.checklist_data) {
        existingChecklistData = typeof report.checklist_data === 'object'
          ? report.checklist_data
          : JSON.parse(report.checklist_data);
      }
    } catch (e) {
      console.warn('⚠️ Could not parse existing checklist_data:', e.message);
      existingChecklistData = {};
    }

    // ✅ FIX: Handle nested structure {checklist: {...}} or flat {...}
    const actualChecklist = existingChecklistData.checklist || existingChecklistData;
    const isNested = Boolean(existingChecklistData.checklist);

    // ✅ FIX: Oppdater kun COMMENTS i checklist_data (behold status/images)
    // Lagre i riktig felt basert på status (avvikComment/byttetComment/comment)
    if (checklistComments && typeof checklistComments === 'object') {
      for (const [itemId, comment] of Object.entries(checklistComments)) {
        if (actualChecklist[itemId]) {
          const statusLower = (actualChecklist[itemId].status || '').toLowerCase();

          console.log(`   - Processing item ${itemId} with status: ${statusLower}`);

          if (statusLower === 'avvik') {
            // ✅ Lagre i avvikComment (flatt felt som tekniker-app bruker)
            actualChecklist[itemId].avvikComment = comment;
            console.log(`   - Updated avvikComment for item ${itemId}: ${comment.substring(0, 50)}...`);
          } else if (statusLower === 'byttet') {
            // ✅ Lagre i byttetComment (flatt felt som tekniker-app bruker)
            actualChecklist[itemId].byttetComment = comment;
            console.log(`   - Updated byttetComment for item ${itemId}: ${comment.substring(0, 50)}...`);
          } else {
            // ✅ For OK-status, lagre i vanlig comment felt
            actualChecklist[itemId].comment = comment;
            console.log(`   - Updated comment for item ${itemId}: ${comment.substring(0, 50)}...`);
          }
        } else {
          console.warn(`   - ⚠️ Item ${itemId} not found in existing checklist`);
        }
      }
    }

    // ✅ Oppdater overall_comment i checklist_data (root level)
    if (overall_comment !== undefined) {
      if (isNested) {
        existingChecklistData.overallComment = overall_comment;
      } else {
        actualChecklist.overallComment = overall_comment;
      }
      console.log(`   - Updated overall_comment`);
    }

    // ✅ Reassemble the structure if it was nested
    const finalChecklistData = isNested
      ? { ...existingChecklistData, checklist: actualChecklist }
      : actualChecklist;

    // Oppdater service_reports tabellen
    const updateReportQuery = `
      UPDATE service_reports
      SET
        checklist_data = $1,
        products_used = $2,
        additional_work = $3,
        updated_at = NOW()
      WHERE id = $4
      RETURNING id
    `;

    await pool.query(updateReportQuery, [
      JSON.stringify(finalChecklistData),
      JSON.stringify(products_used || []),
      JSON.stringify(additional_work || []),
      reportId
    ]);

    console.log(`✅ Report ${reportId} updated in database`);

    // Oppdater customer_data i orders-tabellen med metadata og mottaker-overskrivning
    if (orderId && (metadata || reportRecipient !== undefined)) {
      // Hent eksisterende customer_data
      const orderResult = await pool.query(
        'SELECT customer_data FROM orders WHERE id = $1',
        [orderId]
      );

      if (orderResult.rows.length > 0) {
        let customerData = {};
        try {
          if (orderResult.rows[0].customer_data) {
            customerData = typeof orderResult.rows[0].customer_data === 'object'
              ? orderResult.rows[0].customer_data
              : JSON.parse(orderResult.rows[0].customer_data);
          }
        } catch (e) {
          console.warn('⚠️ Could not parse existing customer_data:', e.message);
          customerData = {};
        }

        // Merge metadata inn i customer_data, inkl. overstyrt servicedato
        const updatedCustomerData = {
          ...customerData,
          ...(metadata && typeof metadata === 'object' ? metadata : {}),
          ...(reportRecipient !== undefined ? { report_recipient: reportRecipient } : {})
        };

        await pool.query(
          'UPDATE orders SET customer_data = $1 WHERE id = $2',
          [JSON.stringify(updatedCustomerData), orderId]
        );

        console.log(`✅ Order ${orderId} customer_data updated with metadata`);
      }
    }

    // Oppdater serviceadresse-kolonner direkte (ikke via customer_data JSONB)
    if (serviceAddress && orderId) {
      await pool.query(
        `UPDATE orders
         SET service_address_street = $1,
             service_address_postal_code = $2,
             service_address_city = $3
         WHERE id = $4`,
        [
          serviceAddress.street || null,
          serviceAddress.postalCode || null,
          serviceAddress.city || null,
          orderId
        ]
      );
      console.log(`✅ Order ${orderId} service address updated`);
    }

    // Oppdater ordrebeskrivelse (prosjektnavn) hvis endret
    if (orderId && orderDescription !== undefined) {
      await pool.query('UPDATE orders SET description = $1 WHERE id = $2', [orderDescription, orderId]);
      console.log(`✅ Order ${orderId} description updated`);
    }

    // Regenerer PDF for hele ordren
    let pdfRegenerated = false;
    try {
      const UnifiedPDFGenerator = require('../../services/unifiedPdfGenerator');
      const pdfGenerator = new UnifiedPDFGenerator();

      console.log(`🔄 Regenerating PDF for order: ${orderId}`);
      const pdfPath = await pdfGenerator.generateOrderReport(orderId, req.adminTenantId);
      pdfRegenerated = true;
      console.log(`✅ PDF regenerated: ${pdfPath}`);

    } catch (pdfError) {
      console.error('❌ PDF regeneration failed:', pdfError.message);
      // Fortsett selv om PDF-generering feiler
    }

    res.json({
      success: true,
      reportId: reportId,
      pdfRegenerated: pdfRegenerated,
      message: pdfRegenerated
        ? 'Rapport oppdatert og PDF regenerert'
        : 'Rapport oppdatert, men PDF-generering feilet'
    });

  } catch (error) {
    console.error('❌ Error updating report content:', error);
    res.status(500).json({
      error: 'Kunne ikke oppdatere rapport',
      details: error.message
    });
  }
});

module.exports = router;
