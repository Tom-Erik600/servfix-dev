// src/routes/images.js - Enhanced with JSON settings system
const express = require('express');
const multer = require('multer');
const { Storage } = require('@google-cloud/storage');
const path = require('path');
const db = require('../config/database');

const router = express.Router();

// Google Cloud Storage setup
const storage = new Storage({
  projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
  keyFilename: process.env.GOOGLE_CLOUD_KEY_FILE,
});

const bucketName = process.env.GCS_BUCKET_NAME || 'servfix-files';
const bucket = storage.bucket(bucketName);

// Multer setup for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Kun bildefiler er tillatt'), false);
    }
  }
});

// Helper: Last opp til Google Cloud Storage
async function uploadToGCS(buffer, filePath, mimetype) {
  const file = bucket.file(filePath);
  
  const stream = file.createWriteStream({
    metadata: {
      contentType: mimetype,
    },
    resumable: false,
  });

  return new Promise((resolve, reject) => {
    stream.on('error', reject);
    stream.on('finish', () => {
      const publicUrl = `https://storage.googleapis.com/${bucketName}/${filePath}`;
      resolve(publicUrl);
    });
    stream.end(buffer);
  });
}

// Helper: Load tenant settings from JSON file in GCS
async function loadTenantSettings(tenantId) {
  try {
    const settingsPath = `tenants/${tenantId}/assets/settings.json`;
    const file = bucket.file(settingsPath);
    const [exists] = await file.exists();
    
    if (exists) {
      const [contents] = await file.download();
      return JSON.parse(contents.toString());
    } else {
      return getDefaultSettings(tenantId);
    }
  } catch (error) {
    console.error('Error loading tenant settings:', error);
    return getDefaultSettings(tenantId);
  }
}

// Helper: Save tenant settings to JSON file in GCS
async function saveTenantSettings(tenantId, settings) {
  try {
    const settingsPath = `tenants/${tenantId}/assets/settings.json`;
    const file = bucket.file(settingsPath);
    
    await file.save(JSON.stringify(settings, null, 2), {
      metadata: {
        contentType: 'application/json',
      },
    });
    
    console.log(`✅ Settings saved for tenant ${tenantId}`);
    return true;
  } catch (error) {
    console.error('Error saving tenant settings:', error);
    return false;
  }
}

// Helper: Default settings
function getDefaultSettings(tenantId) {
  return {
    tenantId: tenantId,
    companyInfo: {
      name: "Air-Tech AS",
      address: "Stanseveien 18, 0975 Oslo",
      phone: "+47 22 00 00 00",
      email: "post@air-tech.no",
      cvr: "123 456 789"
    },
    logo: {
      url: null,
      uploadedAt: null,
      originalName: null,
      fileSize: null
    },
    reportSettings: {
      autoSend: false,
      copyAdmin: false,
      senderEmail: "post@air-tech.no"
    },
    lastUpdated: new Date().toISOString()
  };
}

// Auth middleware
router.use((req, res, next) => {
  if (!req.session.technicianId && !req.session.isAdmin) {
    return res.status(401).json({ error: 'Ikke autentisert' });
  }
  next();
});

// GET /api/images/settings - Hent alle innstillinger fra JSON-fil
router.get('/settings', async (req, res) => {
  try {
    const tenantId = req.session.tenantId || 'airtech';
    console.log(`📋 Loading settings for tenant: ${tenantId}`);
    
    const settings = await loadTenantSettings(tenantId);
    
    console.log(`✅ Settings loaded:`, {
      hasLogo: !!settings.logo?.url,
      companyName: settings.companyInfo?.name,
      lastUpdated: settings.lastUpdated
    });
    
    res.json(settings);
    
  } catch (error) {
    console.error('Error loading settings:', error);
    res.status(500).json({ 
      error: 'Kunne ikke laste innstillinger',
      details: error.message 
    });
  }
});

// POST /api/images/save-settings - Lagre innstillinger til JSON-fil
router.post('/save-settings', async (req, res) => {
  try {
    const tenantId = req.session.tenantId || 'airtech';
    const settingsUpdate = req.body;
    
    console.log(`💾 Saving settings for tenant: ${tenantId}`, settingsUpdate);
    
    // Load existing settings
    const currentSettings = await loadTenantSettings(tenantId);
    
    // Merge with updates (deep merge for nested objects)
    const updatedSettings = {
      ...currentSettings,
      ...settingsUpdate,
      tenantId: tenantId,
      lastUpdated: new Date().toISOString()
    };
    
    // Deep merge for nested objects
    if (settingsUpdate.companyInfo) {
      updatedSettings.companyInfo = {
        ...currentSettings.companyInfo,
        ...settingsUpdate.companyInfo
      };
    }
    
    if (settingsUpdate.reportSettings) {
      updatedSettings.reportSettings = {
        ...currentSettings.reportSettings,
        ...settingsUpdate.reportSettings
      };
    }
    
    if (settingsUpdate.logo) {
      updatedSettings.logo = {
        ...currentSettings.logo,
        ...settingsUpdate.logo
      };
    }
    
    // Save to GCS
    const saved = await saveTenantSettings(tenantId, updatedSettings);
    
    if (!saved) {
      throw new Error('Kunne ikke lagre innstillinger til cloud storage');
    }
    
    console.log(`✅ Settings saved successfully for ${tenantId}`);
    
    res.json({
      success: true,
      message: 'Innstillinger lagret!',
      settings: updatedSettings
    });
    
  } catch (error) {
    console.error('Error saving settings:', error);
    res.status(500).json({ 
      error: 'Kunne ikke lagre innstillinger',
      details: error.message 
    });
  }
});

// POST /api/images/upload-logo - Last opp bedriftslogo
router.post('/upload-logo', upload.single('logo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Ingen fil lastet opp' });
    }

    console.log('📤 Laster opp bedriftslogo...', {
      filename: req.file.originalname,
      size: Math.round(req.file.size / 1024) + 'KB',
      mimetype: req.file.mimetype
    });
    
    const tenantId = req.session.tenantId || 'airtech';
    const fileExtension = path.extname(req.file.originalname).slice(1) || 'png';
    const timestamp = Date.now();
    
    // Generate file path for logo
    const filePath = `tenants/${tenantId}/assets/logo_${timestamp}.${fileExtension}`;

    // Upload to Google Cloud Storage
    const logoUrl = await uploadToGCS(req.file.buffer, filePath, req.file.mimetype);

    // Load existing settings
    const settings = await loadTenantSettings(tenantId);
    
    // Update logo info
    settings.logo = {
      url: logoUrl,
      uploadedAt: new Date().toISOString(),
      originalName: req.file.originalname,
      fileSize: req.file.size
    };
    settings.lastUpdated = new Date().toISOString();
    
    // Save updated settings
    const saved = await saveTenantSettings(tenantId, settings);
    
    if (!saved) {
      throw new Error('Kunne ikke lagre logo-innstillinger');
    }

    console.log(`✅ Bedriftslogo lastet opp og lagret for ${tenantId}: ${logoUrl}`);

    res.json({
      success: true,
      logoUrl: logoUrl,
      message: 'Logo lastet opp og lagret!',
      fileInfo: {
        originalName: req.file.originalname,
        size: req.file.size,
        uploadedAt: settings.logo.uploadedAt
      }
    });

  } catch (error) {
    console.error('Feil ved opplasting av logo:', error);
    res.status(500).json({ 
      error: 'Kunne ikke laste opp logo',
      details: error.message 
    });
  }
});

// GET /api/images/logo - Hent logo-info (manglende endepunkt)
router.get('/logo', async (req, res) => {
  try {
    const tenantId = req.session.tenantId || 'airtech';
    console.log(`🖼️ Loading logo for tenant: ${tenantId}`);
    
    const settings = await loadTenantSettings(tenantId);
    
    // Return logo-specific data i samme format som frontend forventer
    const logoData = {
      logoUrl: settings.logo?.url || null,
      hasLogo: !!settings.logo?.url,
      companyInfo: settings.companyInfo || null,
      lastUpdated: settings.lastUpdated
    };
    
    console.log(`✅ Logo data loaded for ${tenantId}:`, {
      hasLogo: logoData.hasLogo,
      logoUrl: logoData.logoUrl ? 'Present' : 'None'
    });
    
    res.json(logoData);
    
  } catch (error) {
    console.error('Error loading logo:', error);
    res.status(500).json({ 
      error: 'Kunne ikke laste logo',
      details: error.message 
    });
  }
});

// DELETE /api/images/logo - Fjern logo
router.delete('/logo', async (req, res) => {
  try {
    const tenantId = req.session.tenantId || 'airtech';
    
    console.log(`🗑️ Removing logo for tenant: ${tenantId}`);
    
    // Load current settings
    const settings = await loadTenantSettings(tenantId);
    
    // Clear logo info
    settings.logo = {
      url: null,
      uploadedAt: null,
      originalName: null,
      fileSize: null
    };
    settings.lastUpdated = new Date().toISOString();
    
    // Save updated settings
    const saved = await saveTenantSettings(tenantId, settings);
    
    if (!saved) {
      throw new Error('Kunne ikke lagre endringer');
    }
    
    console.log(`✅ Logo removed for ${tenantId}`);
    
    res.json({
      success: true,
      message: 'Logo fjernet'
    });
    
  } catch (error) {
    console.error('Error removing logo:', error);
    res.status(500).json({ 
      error: 'Kunne ikke fjerne logo',
      details: error.message 
    });
  }
});

// DELETE /api/images/avvik/:imageId - Slett spesifikt avvik-bilde
router.delete('/avvik/:imageId', async (req, res) => {
  try {
    const { imageId } = req.params;
    const tenantId = req.session.tenantId || 'airtech';
    
    console.log(`🗑️ Sletter avvik-bilde ID: ${imageId}`);
    
    const pool = await db.getTenantConnection(tenantId);
    
    // Hent bilde-info før sletting
    const imageResult = await pool.query(
      'SELECT image_url FROM avvik_images WHERE id = $1',
      [imageId]
    );
    
    if (imageResult.rows.length === 0) {
      return res.status(404).json({ error: 'Bilde ikke funnet' });
    }
    
    const imageUrl = imageResult.rows[0].image_url;
    
    // Slett fra database
    await pool.query('DELETE FROM avvik_images WHERE id = $1', [imageId]);
    
    // Slett fra GCS
    try {
      const urlPath = new URL(imageUrl).pathname;
      const filePath = urlPath.substring(urlPath.indexOf(bucketName) + bucketName.length + 1);
      const decodedFilePath = decodeURIComponent(filePath);
      
      await bucket.file(decodedFilePath).delete();
      console.log(`✅ Fil slettet fra GCS: ${decodedFilePath}`);
    } catch (storageError) {
      console.warn('Kunne ikke slette fra GCS:', storageError.message);
    }
    
    res.json({ 
      success: true, 
      message: 'Avvik-bilde slettet',
      deletedImageId: imageId 
    });
    
  } catch (error) {
    console.error('Feil ved sletting av avvik-bilde:', error);
    res.status(500).json({ 
      error: 'Kunne ikke slette avvik-bilde',
      details: error.message 
    });
  }
});

// GET /api/images/logo - Hent bare logo-info
router.get('/logo', async (req, res) => {
  try {
    const tenantId = req.session.tenantId || 'airtech';
    console.log(`🖼️ Loading logo for tenant: ${tenantId}`);
    
    const settings = await loadTenantSettings(tenantId);
    
    // Return logo-specific data
    const logoData = {
      logoUrl: settings.logo?.url || null,
      hasLogo: !!settings.logo?.url,
      logoInfo: settings.logo || null,
      companyInfo: settings.companyInfo || null,
      lastUpdated: settings.lastUpdated
    };
    
    console.log(`✅ Logo data loaded for ${tenantId}:`, {
      hasLogo: logoData.hasLogo,
      logoUrl: logoData.logoUrl ? 'Present' : 'None'
    });
    
    res.json(logoData);
    
  } catch (error) {
    console.error('Error loading logo:', error);
    res.status(500).json({ 
      error: 'Kunne ikke laste logo',
      details: error.message 
    });
  }
});

// POST /api/images/upload - Legacy/fallback endpoint for bulk uploads
// NOTE: Dette endepunktet brukes kanskje ikke lenger - nye uploads bruker /general og /avvik
// Beholdes for bakoverkompatibilitet og eventuelle bulk-operasjoner
router.post('/upload', upload.array('images', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Ingen filer lastet opp' });
    }

    console.log(`📸 Laster opp ${req.files.length} servicebilder...`);
    
    const { serviceReportId, imageType, avvikNumber } = req.body;
    const tenantId = req.session.tenantId || 'airtech';
    
    if (!serviceReportId) {
      return res.status(400).json({ error: 'serviceReportId er påkrevd' });
    }

    // Get order and equipment info for folder structure
    const pool = await db.getTenantConnection(tenantId);
    const reportResult = await pool.query(
      'SELECT order_id, equipment_id FROM service_reports WHERE id = $1',
      [serviceReportId]
    );
    
    if (reportResult.rows.length === 0) {
      return res.status(404).json({ error: 'Service report ikke funnet' });
    }
    
    const { order_id, equipment_id } = reportResult.rows[0];
    const uploadedImages = [];
    
    // Upload each file
    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      const fileExtension = path.extname(file.originalname).slice(1) || 'jpg';
      
      // Generate organized file path
      const filePath = generateImagePath(tenantId, order_id, equipment_id, imageType, avvikNumber, fileExtension);
      
      // Upload to GCS
      const imageUrl = await uploadToGCS(file.buffer, filePath, file.mimetype);
      
      // Save image record to database
      const imageRecord = await pool.query(
        `INSERT INTO avvik_images (service_report_id, avvik_number, image_url, uploaded_at, metadata)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4)
         RETURNING *`,
        [
          serviceReportId,
          avvikNumber || null,
          imageUrl,
          JSON.stringify({
            originalName: file.originalname,
            fileSize: file.size,
            imageType: imageType,
            filePath: filePath
          })
        ]
      );
      
      uploadedImages.push({
        url: imageUrl,
        id: imageRecord.rows[0].id,
        metadata: imageRecord.rows[0].metadata
      });
      
      console.log(`✅ Bilde ${i + 1} lastet opp: ${imageUrl}`);
    }

    res.json({
      success: true,
      message: `${uploadedImages.length} bilder lastet opp`,
      images: uploadedImages
    });

  } catch (error) {
    console.error('Feil ved opplasting av bilder:', error);
    res.status(500).json({ 
      error: 'Kunne ikke laste opp bilder',
      details: error.message 
    });
  }
});

// POST /api/images/general - Last opp rapport-bilder (lagres i service_reports.photos array)
router.post('/general', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Ingen fil lastet opp' });
    }

    console.log('📸 Laster opp rapport-bilde:', req.file.originalname);
    
    const { orderId, equipmentId, reportId } = req.body;
    const tenantId = req.session.tenantId || 'airtech';
    
    if (!reportId || !orderId || !equipmentId) {
      return res.status(400).json({ error: 'reportId, orderId og equipmentId er påkrevd' });
    }

    // Generate file path
    const fileExtension = path.extname(req.file.originalname).slice(1) || 'jpg';
    const filePath = generateImagePath(tenantId, orderId, equipmentId, 'general', null, fileExtension);
    
    // Upload to GCS
    const imageUrl = await uploadToGCS(req.file.buffer, filePath, req.file.mimetype);
    console.log('✅ Bilde lastet opp til GCS:', imageUrl);
    
    // KRITISK ENDRING: Mer robust array-håndtering for Cloud SQL
    const pool = await db.getTenantConnection(tenantId);
    
    try {
      // Metode 1: Prøv først med array_append (fungerer i de fleste tilfeller)
      const result = await pool.query(
        `UPDATE service_reports 
         SET photos = array_append(COALESCE(photos, ARRAY[]::text[]), $1)
         WHERE id = $2 
         RETURNING photos`,
        [imageUrl, reportId]
      );
      
      if (result.rows.length === 0) {
        throw new Error('Rapport ikke funnet');
      }
      
      console.log(`✅ Bilde lagret med array_append. Total bilder: ${result.rows[0].photos.length}`);
      
      res.json({
        success: true,
        url: imageUrl,
        message: 'Rapport-bilde lastet opp',
        imageType: 'general',
        totalPhotos: result.rows[0].photos.length
      });
      
    } catch (arrayAppendError) {
      console.warn('⚠️ array_append feilet, prøver alternativ metode:', arrayAppendError.message);
      
      // Metode 2: Hent eksisterende array og oppdater manuelt
      try {
        // Hent eksisterende photos
        const selectResult = await pool.query(
          'SELECT photos FROM service_reports WHERE id = $1',
          [reportId]
        );
        
        if (selectResult.rows.length === 0) {
          return res.status(404).json({ error: 'Service report ikke funnet' });
        }
        
        // Hent eksisterende bilder eller initialiser tom array
        let existingPhotos = selectResult.rows[0].photos;
        
        // Håndter ulike array-formater
        if (!existingPhotos) {
          existingPhotos = [];
        } else if (typeof existingPhotos === 'string') {
          // Hvis det er en string, prøv å parse den
          try {
            existingPhotos = JSON.parse(existingPhotos);
          } catch {
            existingPhotos = [];
          }
        } else if (!Array.isArray(existingPhotos)) {
          existingPhotos = [];
        }
        
        console.log('📸 Eksisterende bilder:', existingPhotos.length);
        
        // Legg til nytt bilde
        existingPhotos.push(imageUrl);
        
        // Oppdater med hele arrayet - bruk PostgreSQL array literal format
        const updateResult = await pool.query(
          `UPDATE service_reports 
           SET photos = $1::text[]
           WHERE id = $2 
           RETURNING photos`,
          [existingPhotos, reportId]
        );
        
        console.log(`✅ Bilde lagret med manuell array-update. Total bilder: ${updateResult.rows[0].photos.length}`);
        
        res.json({
          success: true,
          url: imageUrl,
          message: 'Rapport-bilde lastet opp',
          imageType: 'general',
          totalPhotos: updateResult.rows[0].photos.length
        });
        
      } catch (manualUpdateError) {
        console.error('❌ Begge update-metoder feilet:', manualUpdateError);
        
        // Som siste utvei, logg detaljert feilinfo
        console.error('Stack:', manualUpdateError.stack);
        
        // Returner success siden bildet ble lastet opp til GCS
        res.json({
          success: true,
          url: imageUrl,
          message: 'Bilde lastet opp (database-oppdatering feilet)',
          imageType: 'general',
          warning: 'Database update failed but image uploaded to storage'
        });
      }
    }

  } catch (error) {
    console.error('Feil ved opplasting av rapport-bilde:', error);
    res.status(500).json({ 
      error: 'Kunne ikke laste opp rapport-bilde',
      details: error.message 
    });
  }
});

// POST /api/images/avvik - Last opp avvik-bilder (lagres i avvik_images tabell)
router.post('/avvik', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Ingen fil lastet opp' });
    }

    console.log('📸 Laster opp avvik-bilde:', req.file.originalname);
    
    const { orderId, equipmentId, reportId, avvikId } = req.body;
    const tenantId = req.session.tenantId || 'airtech';
    
    if (!reportId || !orderId || !equipmentId) {
      return res.status(400).json({ error: 'reportId, orderId og equipmentId er påkrevd' });
    }

    const pool = await db.getTenantConnection(tenantId);
    
    // KORREKT: Bruk auto-increment funksjon for å få neste avvik-nummer
    const avvikNumberResult = await pool.query(
      `SELECT COALESCE(MAX(avvik_number), 0) + 1 as next_avvik_number
       FROM avvik_images 
       WHERE service_report_id = $1`,
      [reportId]
    );
    
    const avvikNumber = avvikNumberResult.rows[0].next_avvik_number; // 1, 2, 3, etc.
    console.log('📊 Generated avvik number:', avvikNumber);

    // Generate file path med korrekt nummer
    const fileExtension = path.extname(req.file.originalname).slice(1) || 'jpg';
    const filePath = generateImagePath(tenantId, orderId, equipmentId, 'avvik', avvikNumber, fileExtension);
    
    console.log('📁 Generated file path:', filePath);
    
    // Upload to GCS
    const imageUrl = await uploadToGCS(req.file.buffer, filePath, req.file.mimetype);
    
    console.log('☁️ Uploaded to GCS:', imageUrl);
    
    // Save to avvik_images table med korrekte kolonner
    const imageRecord = await pool.query(
      `INSERT INTO avvik_images (service_report_id, avvik_number, checklist_item_id, image_url, image_type, metadata, uploaded_at, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, $7)
       RETURNING *`,
      [
        reportId,
        avvikNumber,                    // INTEGER: 1, 2, 3, etc.
        avvikId || null,               // checklist_item_id
        imageUrl,
        'avvik',
        JSON.stringify({
          originalName: req.file.originalname,
          fileSize: req.file.size,
          imageType: 'avvik',
          filePath: filePath,
          avvikId: avvikId,
          componentIndex: req.body.componentIndex || null  // VIKTIG: Lagre component index
        }),
        req.session.technicianId
      ]
    );

    console.log(`✅ Avvik-bilde lagret i avvik_images: ${imageUrl}`);

    res.json({
      success: true,
      url: imageUrl,
      avvikNumber: avvikNumber,                                    // Backend returnerer: 1
      formattedAvvikNumber: String(avvikNumber).padStart(3, '0'),  // Frontend får: "001"
      message: `Avvik-bilde #${avvikNumber} lastet opp`,
      imageType: 'avvik',
      id: imageRecord.rows[0].id
    });

  } catch (error) {
    console.error('🚨 Feil ved opplasting av avvik-bilde:', error);
    console.error('🚨 Error stack:', error.stack);
    console.error('🚨 Request body:', req.body);
    res.status(500).json({ 
      error: 'Kunne ikke laste opp avvik-bilde',
      details: error.message 
    });
  }
});

// Helper: Generate image path for service images
function generateImagePath(tenantId, orderId, equipmentId, imageType, avvikNumber = null, fileExtension = 'jpg') {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 1000);
  
  let filename;
  if (imageType === 'avvik' && avvikNumber) {
    const formattedAvvikNumber = String(avvikNumber).padStart(3, '0');
    filename = `avvik-${formattedAvvikNumber}_${timestamp}_${random}.${fileExtension}`;
  } else {
    filename = `${imageType}_${timestamp}_${random}.${fileExtension}`;
  }
  
  return `tenants/${tenantId}/service-reports/${year}/${month}/order-${orderId}/equipment-${equipmentId}/${imageType}/${filename}`;
}

// GET /api/images/avvik/:reportId - Hent alle avvik-bilder for en rapport
router.get('/avvik/:reportId', async (req, res) => {
  try {
    const { reportId } = req.params;
    
    const pool = await db.getTenantConnection(req.session.tenantId);
    
    const result = await pool.query(
      `SELECT id, service_report_id, avvik_number, image_url, uploaded_at, metadata, checklist_item_id
       FROM avvik_images 
       WHERE service_report_id = $1 
       ORDER BY avvik_number ASC`,
      [reportId]
    );
    
    // Legg til formatted_avvik_number for frontend
    const formattedResults = result.rows.map(row => ({
      ...row,
      formatted_avvik_number: String(row.avvik_number).replace('AVVIK-', '')
    }));
    
    console.log(`Found ${formattedResults.length} avvik images for report ${reportId}`);
    res.json(formattedResults);
  } catch (error) {
    console.error('Feil ved henting av avvik-bilder:', error);
    res.status(500).json({ error: 'Kunne ikke hente avvik-bilder' });
  }
});

// GET /api/images/general/:reportId - Hent alle rapport-bilder for en rapport
router.get('/general/:reportId', async (req, res) => {
  try {
    const { reportId } = req.params;
    
    const pool = await db.getTenantConnection(req.session.tenantId);
    
    const result = await pool.query(
      `SELECT photos FROM service_reports WHERE id = $1`,
      [reportId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Service report ikke funnet' });
    }
    
    const photos = result.rows[0].photos || [];
    
    // Format for frontend
    const formattedPhotos = photos.map((url, index) => ({
      image_url: url,
      uploaded_at: new Date().toISOString(), // Fallback since we don't store timestamp in array
      imageType: 'general',
      index: index
    }));
    
    console.log(`Found ${formattedPhotos.length} general images for report ${reportId}`);
    res.json(formattedPhotos);
  } catch (error) {
    console.error('Feil ved henting av rapport-bilder:', error);
    res.status(500).json({ error: 'Kunne ikke hente rapport-bilder' });
  }
});

// POST /api/images/cleanup - Slett foreldreløse bilder
router.post('/cleanup', async (req, res) => {
  try {
    const { imageUrls } = req.body;
    const tenantId = req.session.tenantId || 'airtech';

    if (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0) {
      return res.status(400).json({ error: 'Mangler liste med bilde-URLer' });
    }

    console.log(`🗑️ Starter opprydding av ${imageUrls.length} bilder for tenant: ${tenantId}`);

    const deletePromises = imageUrls.map(async (url) => {
      try {
        // Hent filsti fra URL
        const urlPath = new URL(url).pathname;
        const filePath = urlPath.substring(urlPath.indexOf(bucketName) + bucketName.length + 1);
        
        const decodedFilePath = decodeURIComponent(filePath);

        console.log(`   - Sletter fil: ${decodedFilePath}`)

        // Slett fra GCS
        await bucket.file(decodedFilePath).delete();
        return { url, status: 'deleted' };
      } catch (error) {
        console.error(`   - Kunne ikke slette ${url}:`, error.message);
        return { url, status: 'error', reason: error.message };
      }
    });

    const results = await Promise.all(deletePromises);

    console.log('✅ Opprydding fullført');
    res.json({ success: true, message: 'Bilder slettet', results });

  } catch (error) {
    console.error('Feil under opprydding av bilder:', error);
    res.status(500).json({ 
      error: 'Kunne ikke rydde opp i bilder',
      details: error.message 
    });
  }
});

module.exports = router;
