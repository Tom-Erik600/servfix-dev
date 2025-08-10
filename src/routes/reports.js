const express = require('express');
const router = express.Router();
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
  // Sikker initialisering
  const dbData = {
    checklist_data: {
      components: [],
      overallComment: ''
    },
    products_used: [],
    additional_work: [],
    photos: []
  };

  // Håndter tilfelle hvor reportData er null eller undefined
  if (!reportData) {
    console.warn('splitReportDataForDB: reportData er null eller undefined');
    return dbData;
  }

  // Sett overallComment hvis den finnes
  if (reportData.overallComment !== undefined) {
    dbData.checklist_data.overallComment = reportData.overallComment;
  }

  // Håndter photos BARE hvis de er eksplisitt inkludert
  if (reportData.hasOwnProperty('photos')) {
    dbData.photos = reportData.photos || [];
  }

  // Prosesser komponenter hvis de finnes
  if (reportData.components && Array.isArray(reportData.components)) {
    reportData.components.forEach((component, index) => {
      try {
        // Lagre sjekkliste-komponenten uten produkter og tilleggsarbeid
        const cleanComponent = {
          details: component.details || {},
          checklist: component.checklist || {},
          driftSchedule: component.driftSchedule || {}
        };
        dbData.checklist_data.components.push(cleanComponent);

        // Samle produkter - håndter både quantity og price
        if (component.products && Array.isArray(component.products)) {
          component.products.forEach(product => {
            // Sjekk at produktet har innhold (navn eller pris)
            if (product.name || (product.price && product.price > 0)) {
              dbData.products_used.push({
                name: product.name || '',
                quantity: product.quantity || 0,
                price: product.price || 0,
                componentDetails: component.details || {}
              });
            }
          });
        }

        // Samle tilleggsarbeid - håndter alle felter trygt
        if (component.additionalWork && Array.isArray(component.additionalWork)) {
          component.additionalWork.forEach(work => {
            // Sjekk at arbeidet har innhold
            if (work.description || (work.hours && work.hours > 0) || (work.price && work.price > 0)) {
              dbData.additional_work.push({
                description: work.description || '',
                hours: work.hours || 0,
                price: work.price || 0,
                componentDetails: component.details || {}
              });
            }
          });
        }
      } catch (err) {
        console.error(`Feil ved prosessering av komponent ${index}:`, err);
        // Fortsett med neste komponent selv om en feiler
      }
    });
  }

  console.log('splitReportDataForDB result:', {
    components: dbData.checklist_data.components.length,
    products: dbData.products_used.length,
    work: dbData.additional_work.length,
    hasPhotos: dbData.photos !== undefined
  });

  return dbData;
}

// Helper funksjon for å kombinere database kolonner tilbake til frontend format
function mergeDBDataToFrontendFormat(dbRow) {
  if (!dbRow) return null;

  const reportData = {
    components: [],
    overallComment: ''
  };

  // Hent base checklist data
  const checklistData = dbRow.checklist_data || {};
  reportData.overallComment = checklistData.overallComment || '';

  // Lag map for å finne produkter og arbeid per komponent
  const productsByComponent = {};
  const workByComponent = {};

  // Grupper produkter etter komponent detaljer
  if (dbRow.products_used && Array.isArray(dbRow.products_used)) {
    dbRow.products_used.forEach(product => {
      const key = JSON.stringify(product.componentDetails || {});
      if (!productsByComponent[key]) productsByComponent[key] = [];
      productsByComponent[key].push({
        name: product.name,
        price: product.price
      });
    });
  }

  // Grupper tilleggsarbeid etter komponent detaljer
  if (dbRow.additional_work && Array.isArray(dbRow.additional_work)) {
    dbRow.additional_work.forEach(work => {
      const key = JSON.stringify(work.componentDetails || {});
      if (!workByComponent[key]) workByComponent[key] = [];
      workByComponent[key].push({
        description: work.description,
        hours: work.hours,
        price: work.price
      });
    });
  }

  // Rekonstruer komponenter med deres produkter og arbeid
  if (checklistData.components && Array.isArray(checklistData.components)) {
    checklistData.components.forEach(component => {
      const key = JSON.stringify(component.details || {});
      const fullComponent = {
        ...component,
        products: productsByComponent[key] || [],
        additionalWork: workByComponent[key] || []
      };
      reportData.components.push(fullComponent);
    });
  }

  // Legg til bilder hvis de finnes
  if (dbRow.photos && Array.isArray(dbRow.photos) && dbRow.photos.length > 0) {
    reportData.photos = dbRow.photos;
  }

  return reportData;
}

// Helper funksjon for å transformere database rad til frontend format
function transformDbRowToFrontend(row) {
  if (!row) return null;
  
  // Kombiner data fra separate kolonner tilbake til reportData format
  const reportData = mergeDBDataToFrontendFormat(row);
  
  return {
    ...row,
    report_data: reportData,
    reportData: reportData,
    // Map database navn til frontend navn
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
  const tenantId = req.tenantId;
  
  try {
    const pool = await db.getTenantConnection(tenantId);
    
    const result = await pool.query(
      'SELECT * FROM service_reports WHERE equipment_id = $1 AND order_id = $2',
      [equipmentId, orderId]
    );
    
    if (result.rows.length > 0) {
      res.json(transformDbRowToFrontend(result.rows[0]));
    } else {
      res.json({
        id: null,
        order_id: orderId,
        equipment_id: equipmentId,
        report_data: {
          components: [],
          overallComment: ''
        },
        status: 'draft'
      });
    }
  } catch (error) {
    console.error(`[${tenantId}] Feil ved henting av rapport for utstyr ${equipmentId}:`, error);
    res.status(500).json({ error: 'Intern serverfeil' });
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
    
    const result = await pool.query(
      `INSERT INTO service_reports 
       (id, order_id, equipment_id, checklist_data, products_used, 
        additional_work, photos, status) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
       RETURNING *`,
      [
        reportId, 
        orderId, 
        equipmentId, 
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
    const hasComponents = reportData.components && reportData.components.length > 0;

    // Automatisk sett status til 'in_progress' hvis:
    // 1. Current status er 'draft' eller 'not_started'
    // 2. Vi har minst én sjekkliste-komponent
    let newStatus = reportData.status;
    if (!newStatus && hasComponents && (currentStatus === 'draft' || currentStatus === 'not_started')) {
      newStatus = 'in_progress';
    }

    const result = await pool.query(
      `UPDATE service_reports 
       SET checklist_data = $1, 
           products_used = $2, 
           additional_work = $3,
           photos = $4
           ${newStatus ? ', status = $6' : ''}
       WHERE id = $5 
       RETURNING *`,
      newStatus ? 
      [
        JSON.stringify(dbData.checklist_data),
        JSON.stringify(dbData.products_used),
        JSON.stringify(dbData.additional_work),
        dbData.photos,
        reportId,
        newStatus
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