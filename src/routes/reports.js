const express = require('express');
const router = express.Router();

// ✅ KRITISK FIX: Legg til authentication middleware
router.use((req, res, next) => {
  console.log('Reports route - Session check:', {
    sessionId: req.sessionID,
    technicianId: req.session?.technicianId,
    tenantId: req.session?.tenantId
  });
  
  if (!req.session.technicianId) {
    return res.status(401).json({ error: 'Ikke autentisert' });
  }
  next();
});
const db = require('../config/database');

/**
 * Service Reports Router
 * Håndterer servicerapporter med korrekt database-struktur
 * 
 * Database kolonner:
 * - checklist_data: Inneholder sjekkliste-komponenter
 * - products_used: Array med brukte produkter
 * - additional_work: Array med tilleggsarbeid
 * - photos: TEXT array med bilde-URLer
 * - sent_til_fakturering: Boolean for faktureringsstatus
 */

// Helper funksjon for å splitte frontend reportData til database kolonner
function splitReportDataForDB(reportData) {
  // Håndter tilfelle hvor reportData er null eller undefined
  if (!reportData) {
    console.warn('splitReportDataForDB: reportData er null eller undefined');
    return {
      checklist_data: {},
      products_used: [],
      additional_work: [],
      photos: []
    };
  }

  // NY STRUKTUR: Direkte felter, ikke components array
  const dbData = {
    checklist_data: {
      checklist: reportData.checklist || {},
      systemFields: reportData.systemFields || {},  // ← FIX: Match frontend naming
      overallComment: reportData.overallComment || '',
      metadata: {
        version: '2.0',
        saved_at: new Date().toISOString()
      }
    },
    products_used: reportData.products || [],
    additional_work: reportData.additionalWork || [],
    photos: reportData.photos || []
  };

  console.log('splitReportDataForDB result (new structure):', {
    hasChecklist: !!reportData.checklist,
    products: dbData.products_used.length,
    work: dbData.additional_work.length,
    hasPhotos: dbData.photos !== undefined
  });

  return dbData;
}

function transformDbRowToFrontend(row) {
  if (!row) return null;
  
  let checklistData = row.checklist_data;
  if (typeof checklistData === 'string') {
    checklistData = JSON.parse(checklistData);
  }
  
  // Map database status to frontend status
  let frontendStatus = row.status;
  if (row.status === 'draft' && (!checklistData?.checklist || Object.keys(checklistData.checklist).length === 0)) {
    frontendStatus = 'not_started';
  } else if (row.status === 'draft') {
    frontendStatus = 'in_progress';
  }
  
  const reportData = {
    checklist: checklistData?.checklist || {},
    systemFields: checklistData?.systemFields || {},
    overallComment: checklistData?.overallComment || '',
    metadata: checklistData?.metadata || {},
    systemData: checklistData?.systemData || {},
    products: row.products_used || [],
    additionalWork: row.additional_work || []
  };
  
  console.log('📦 transformDbRowToFrontend OUTPUT:', {
    dbStatus: row.status,
    frontendStatus: frontendStatus,
    hasProducts: !!reportData.products?.length,
    hasAdditionalWork: !!reportData.additionalWork?.length
  });
  
  return {
    id: row.id,
    reportId: row.id,
    orderId: row.order_id,
    equipmentId: row.equipment_id,
    reportData: reportData,
    photos: row.photos || [],
    status: frontendStatus,  // ← Bruk mapped status
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sentToCustomer: row.sent_til_fakturering || false
  };
}

// Hent alle servicerapporter for en gitt ordre
router.get('/:orderId', async (req, res) => {
  const { orderId } = req.params;
  const tenantId = req.tenantId;
  
  try {
    const pool = await db.getTenantConnection(tenantId);
    const result = await pool.query('SELECT * FROM service_reports WHERE order_id = $1', [orderId]);
    res.json(result.rows.map(transformDbRowToFrontend));
  } catch (error) {
    console.error(`[${tenantId}] Feil ved henting av rapporter for ordre ${orderId}:`, error);
    res.status(500).json({ error: 'Intern serverfeil' });
  }
});

// Endpoint for å hente rapport basert på equipment ID
router.get('/equipment/:equipmentId', async (req, res) => {
  const { equipmentId } = req.params;
  const { orderId } = req.query;
  
  const tenantId = req.session.tenantId;
  
  console.log('=== GET REPORT BY EQUIPMENT ===');
  console.log('Equipment ID:', equipmentId);
  console.log('Order ID:', orderId);
  console.log('Tenant ID:', tenantId);
  
  // Valider input
  if (!tenantId) {
    console.error('❌ Missing tenantId in session');
    return res.status(401).json({ error: 'Ikke autentisert - mangler tenant ID' });
  }
  
  if (!orderId) {
    console.error('❌ Missing orderId parameter');
    return res.status(400).json({ error: 'orderId parameter er påkrevd' });
  }
  
  try {
    const pool = await db.getTenantConnection(tenantId);
    
    // ✅ FIX: Cast både sr.equipment_id og parameter til VARCHAR
    const result = await pool.query(`
      SELECT sr.*, 
             e.systemtype, e.systemnummer, e.systemnavn, e.plassering, e.betjener, e.location
      FROM service_reports sr
      LEFT JOIN equipment e ON sr.equipment_id::varchar = e.id::varchar
      WHERE sr.equipment_id::varchar = $1::varchar AND sr.order_id = $2
    `, [String(equipmentId), orderId]);
    
    console.log(`✅ Query returned ${result.rows.length} rows`);
    
    if (result.rows.length > 0) {
      const transformed = transformDbRowToFrontend(result.rows[0]);
      console.log('📦 TRANSFORMED OUTPUT:', {
        hasProducts: !!transformed.reportData?.products?.length,
        hasAdditionalWork: !!transformed.reportData?.additionalWork?.length,
        productsCount: transformed.reportData?.products?.length || 0,
        workCount: transformed.reportData?.additionalWork?.length || 0
      });
      res.json(transformed);
    } else {
      console.log('ℹ️ No existing report found - returning empty template');
      res.json({
        id: null,
        order_id: orderId,
        equipment_id: String(equipmentId),
        report_data: {
          components: [],
          overallComment: ''
        },
        status: 'draft'
      });
    }
  } catch (error) {
    console.error(`❌ Error fetching report for equipment ${equipmentId}:`, error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Intern serverfeil',
      details: error.message 
    });
  }
});

// CREATE ny servicerapport
router.post('/', async (req, res) => {
  const { reportId, orderId, equipmentId, reportData } = req.body;
  
  if (!req.session.technicianId) {
    return res.status(401).json({ error: 'Ikke autentisert' });
  }
  
  try {
    const pool = await db.getTenantConnection(req.session.tenantId);
    
    // Splitt reportData til passende kolonner
    const dbData = splitReportDataForDB(reportData);

    // Hent systemdata fra equipment table
    const equipmentResult = await pool.query(`
      SELECT systemtype, systemnummer, systemnavn, plassering, betjener, location
      FROM equipment WHERE id = $1
    `, [parseInt(equipmentId)]);

    if (equipmentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Equipment ikke funnet' });
    }

    const equipment = equipmentResult.rows[0];

    // Legg systemData til checklist_data
    const systemData = {
      systemtype: equipment.systemtype,
      systemnummer: equipment.systemnummer,
      systemnavn: equipment.systemnavn,
      plassering: equipment.plassering,
      betjener: equipment.betjener,
      location: equipment.location
    };

    // Oppdater dbData.checklist_data
    dbData.checklist_data.systemData = systemData;
    dbData.checklist_data.metadata = {
      version: '2.0',
      equipment_id: equipmentId,
      saved_at: new Date().toISOString()
    };
    
    const result = await pool.query(
      `INSERT INTO service_reports 
       (id, order_id, equipment_id, checklist_data, products_used, 
        additional_work, photos, status) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
       RETURNING *`,
      [
        reportId, 
        orderId, 
        String(equipmentId), 
        JSON.stringify(dbData.checklist_data),
        JSON.stringify(dbData.products_used),
        JSON.stringify(dbData.additional_work),
        dbData.photos || [],
        'draft'
      ]
    );
    
    res.json(transformDbRowToFrontend(result.rows[0]));
  } catch (error) {
    console.error('Feil ved opprettelse av servicerapport:', error);
    res.status(500).json({ error: 'Intern serverfeil' });
  }
});

// UPDATE eksisterende servicerapport
router.put('/:reportId', async (req, res) => {
  const { reportId } = req.params;
  const { reportData, orderId, equipmentId } = req.body;
  
  console.log('PUT /servicereports/:reportId request:', {
    reportId,
    hasReportData: !!reportData,
    hasOrderId: !!orderId,
    hasEquipmentId: !!equipmentId,
    hasPhotosInRequest: !!(reportData && reportData.photos),
    photosCount: reportData?.photos?.length || 0
  });
  
  if (!req.session.technicianId) {
    console.error('Autentisering feilet - ingen technicianId i session');
    return res.status(401).json({ error: 'Ikke autentisert' });
  }
  
  if (!reportData) {
    console.error('Mangler reportData i request body');
    return res.status(400).json({ error: 'Mangler reportData' });
  }
  
  try {
    const tenantId = req.session.tenantId || req.tenantId || 'airtech';
    console.log('Bruker tenantId:', tenantId);
    
    const pool = await db.getTenantConnection(tenantId);
    
    // Sjekk om rapporten eksisterer
    const checkResult = await pool.query(
      'SELECT * FROM service_reports WHERE id = $1',
      [reportId]
    );
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Rapport ikke funnet' });
    }
    
    // Oppdater eksisterende rapport
    console.log('Oppdaterer eksisterende rapport...');
    
    // KRITISK: Hent eksisterende photos array FØR oppdatering
    const existingPhotos = checkResult.rows[0].photos || [];
    console.log(`📸 Eksisterende bilder i DB: ${existingPhotos.length}`);
    
    // Splitt reportData til passende kolonner
    const dbData = splitReportDataForDB(reportData);
    
    // FORBEDRET LOGIKK: Sjekk om photos faktisk er sendt med intensjon
    if (!reportData.hasOwnProperty('photos')) {
      dbData.photos = existingPhotos;
      console.log('📸 Beholder eksisterende bilder - photos ikke inkludert i request');
    } else if (reportData.photos && reportData.photos.length === 0 && existingPhotos.length > 0) {
      // Hvis tom array er sendt OG det finnes eksisterende bilder, behold dem
      dbData.photos = existingPhotos;
      console.log('📸 Beholder eksisterende bilder - tom array sendt men bilder finnes');
    }
    
    // Sjekk om dette er første gang en sjekkliste lagres
    const currentStatusResult = await pool.query(
      'SELECT status FROM service_reports WHERE id = $1',
      [reportId]
    );

    const currentStatus = currentStatusResult.rows[0]?.status || 'draft';
// Automatisk sett status til 'in_progress' hvis data lagres første gang
const hasChecklistData = reportData.checklist && Object.keys(reportData.checklist).length > 0;
const hasSystemFieldData = reportData.systemFields && Object.keys(reportData.systemFields).length > 0;
const hasAnyData = hasChecklistData || hasSystemFieldData;

let newStatus = reportData.status;
if (!newStatus && hasAnyData && (currentStatus === 'draft' || currentStatus === 'not_started')) {
  newStatus = 'in_progress';
  console.log('📝 Auto-setting status to in_progress because data was saved');
}

    const result = await pool.query(
      `UPDATE service_reports 
       SET checklist_data = $1::jsonb, 
           products_used = $2::jsonb, 
           additional_work = $3::jsonb,
           photos = $4
           ${newStatus ? ', status = $5' : ''}
       WHERE id = ${newStatus ? '$6' : '$5'}
       RETURNING *`,
      newStatus ? 
      [
        JSON.stringify(dbData.checklist_data),
        JSON.stringify(dbData.products_used),
        JSON.stringify(dbData.additional_work),
        dbData.photos,
        newStatus,
        reportId
      ] :
      [
        JSON.stringify(dbData.checklist_data),
        JSON.stringify(dbData.products_used),
        JSON.stringify(dbData.additional_work),
        dbData.photos,
        reportId
      ]
    );
    
    console.log(`✅ Rapport oppdatert. Antall bilder: ${result.rows[0].photos?.length || 0}`);
    
    res.json(transformDbRowToFrontend(result.rows[0]));
  } catch (error) {
    console.error('Feil ved oppdatering av servicerapport:', error);
    res.status(500).json({ error: 'Intern serverfeil', details: error.message });
  }
});
// Fullfør en servicerapport (ferdigstill)
router.post('/:reportId/complete', async (req, res) => {
  const { reportId } = req.params;
  const { signature } = req.body;
  
  if (!req.session.technicianId) {
    return res.status(401).json({ error: 'Ikke autentisert' });
  }
  
  try {
    const pool = await db.getTenantConnection(req.session.tenantId);
    
    const updateData = {
      status: 'completed',
      completed_at: 'CURRENT_TIMESTAMP'
    };
    
    // Legg til signatur hvis den finnes
    let query = `UPDATE service_reports SET status = $1, completed_at = CURRENT_TIMESTAMP`;
    const params = ['completed'];
    
    if (signature) {
      query += `, signature_data = $2 WHERE id = $3 RETURNING *`;
      params.push(JSON.stringify(signature), reportId);
    } else {
      query += ` WHERE id = $2 RETURNING *`;
      params.push(reportId);
    }
    
    const result = await pool.query(query, params);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Rapport ikke funnet' });
    }
    
    res.json(transformDbRowToFrontend(result.rows[0]));
  } catch (error) {
    console.error('Feil ved fullføring av servicerapport:', error);
    res.status(500).json({ error: 'Intern serverfeil' });
  }
});

// Hent en enkelt rapport basert på ID
router.get('/report/:reportId', async (req, res) => {
  const { reportId } = req.params;
  const tenantId = req.tenantId || req.session?.tenantId;
  
  try {
    const pool = await db.getTenantConnection(tenantId);
    
    const result = await pool.query(
      'SELECT * FROM service_reports WHERE id = $1',
      [reportId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Rapport ikke funnet' });
    }
    
    res.json(transformDbRowToFrontend(result.rows[0]));
  } catch (error) {
    console.error(`Feil ved henting av rapport ${reportId}:`, error);
    res.status(500).json({ error: 'Intern serverfeil' });
  }
});

// Send rapport til fakturering
router.post('/:reportId/send-til-fakturering', async (req, res) => {
  const { reportId } = req.params;
  
  if (!req.session.technicianId && !req.session.isAdmin) {
    return res.status(401).json({ error: 'Ikke autentisert' });
  }
  
  try {
    const pool = await db.getTenantConnection(req.session.tenantId || req.tenantId);
    
    const result = await pool.query(
      `UPDATE service_reports 
       SET sent_til_fakturering = true
       WHERE id = $1 
       RETURNING *`,
      [reportId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Rapport ikke funnet' });
    }
    
    res.json(transformDbRowToFrontend(result.rows[0]));
  } catch (error) {
    console.error('Feil ved sending av rapport til fakturering:', error);
    res.status(500).json({ error: 'Intern serverfeil' });
  }
});

// Upload bilder til rapport
router.post('/:reportId/photos', async (req, res) => {
  const { reportId } = req.params;
  const { photos } = req.body; // Array av bilde-URLer
  
  if (!req.session.technicianId) {
    return res.status(401).json({ error: 'Ikke autentisert' });
  }
  
  try {
    const pool = await db.getTenantConnection(req.session.tenantId);
    
    // Hent eksisterende bilder
    const existingResult = await pool.query(
      'SELECT photos FROM service_reports WHERE id = $1',
      [reportId]
    );
    
    if (existingResult.rows.length === 0) {
      return res.status(404).json({ error: 'Rapport ikke funnet' });
    }
    
    const existingPhotos = existingResult.rows[0].photos || [];
    const allPhotos = [...existingPhotos, ...photos];
    
    // Oppdater med nye bilder
    const result = await pool.query(
      `UPDATE service_reports 
       SET photos = $1
       WHERE id = $2 
       RETURNING *`,
      [allPhotos, reportId]
    );
    
    res.json(transformDbRowToFrontend(result.rows[0]));
  } catch (error) {
    console.error('Feil ved opplasting av bilder:', error);
    res.status(500).json({ error: 'Intern serverfeil' });
  }
});

module.exports = router;