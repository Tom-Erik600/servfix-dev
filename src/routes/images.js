// src/routes/images.js - Bilde upload routes
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
    // Kun tillat bilder
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Kun bildefiler er tillatt'), false);
    }
  }
});

// Auth middleware
router.use((req, res, next) => {
  if (!req.session.technicianId) {
    return res.status(401).json({ error: 'Ikke autentisert' });
  }
  next();
});

// Helper: Generer filsti for GCS
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
      // Generer public URL
      const publicUrl = `https://storage.googleapis.com/${bucketName}/${filePath}`;
      resolve(publicUrl);
    });
    stream.end(buffer);
  });
}

// POST /api/images/avvik - Last opp avvik-bilde
router.post('/avvik', upload.single('image'), async (req, res) => {
  try {
    const { orderId, equipmentId, reportId } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ error: 'Ingen fil lastet opp' });
    }
    
    if (!orderId || !equipmentId || !reportId) {
      return res.status(400).json({ error: 'Mangler påkrevde parametere' });
    }

    const pool = await db.getTenantConnection(req.session.tenantId);
    
    // Generer neste avvik-nummer
    const avvikNumberResult = await pool.query(
      'SELECT get_next_avvik_number($1) as avvik_number',
      [reportId]
    );
    const avvikNumber = avvikNumberResult.rows[0].avvik_number;

    // Generer filsti
    const fileExtension = path.extname(req.file.originalname).slice(1) || 'jpg';
    const filePath = generateImagePath(
      req.session.tenantId, 
      orderId, 
      equipmentId, 
      'avvik', 
      avvikNumber, 
      fileExtension
    );

    // Last opp til Google Cloud Storage
    const imageUrl = await uploadToGCS(req.file.buffer, filePath, req.file.mimetype);

    // Lagre i database
    await pool.query(
      `INSERT INTO avvik_images 
       (service_report_id, avvik_number, image_url, image_type, metadata, uploaded_by) 
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        reportId, 
        avvikNumber, 
        imageUrl, 
        'avvik',
        JSON.stringify({
          originalName: req.file.originalname,
          size: req.file.size,
          mimetype: req.file.mimetype,
          gcsPath: filePath
        }),
        req.session.technicianId
      ]
    );

    console.log(`Avvik-bilde lastet opp: ${imageUrl}, avvik #${avvikNumber}`);

    res.json({
      success: true,
      url: imageUrl,
      avvikNumber: avvikNumber,
      formattedAvvikNumber: String(avvikNumber).padStart(3, '0')
    });

  } catch (error) {
    console.error('Feil ved opplasting av avvik-bilde:', error);
    res.status(500).json({ error: 'Kunne ikke laste opp bilde: ' + error.message });
  }
});

// POST /api/images/general - Last opp generelt rapport-bilde
router.post('/general', upload.single('image'), async (req, res) => {
  try {
    const { orderId, equipmentId, reportId } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ error: 'Ingen fil lastet opp' });
    }

    const pool = await db.getTenantConnection(req.session.tenantId);

    // Generer filsti
    const fileExtension = path.extname(req.file.originalname).slice(1) || 'jpg';
    const filePath = generateImagePath(
      req.session.tenantId, 
      orderId, 
      equipmentId, 
      'general', 
      null, 
      fileExtension
    );

    // Last opp til Google Cloud Storage
    const imageUrl = await uploadToGCS(req.file.buffer, filePath, req.file.mimetype);

    // Oppdater service_reports med nytt bilde
    await pool.query(
      `UPDATE service_reports 
       SET photos = array_append(COALESCE(photos, ARRAY[]::text[]), $1)
       WHERE id = $2`,
      [imageUrl, reportId]
    );

    console.log(`Generelt bilde lastet opp: ${imageUrl}`);

    res.json({
      success: true,
      url: imageUrl
    });

  } catch (error) {
    console.error('Feil ved opplasting av generelt bilde:', error);
    res.status(500).json({ error: 'Kunne ikke laste opp bilde: ' + error.message });
  }
});

// DELETE /api/images/delete - Slett bilde
router.delete('/delete', async (req, res) => {
  try {
    const { imageUrl } = req.body;
    
    if (!imageUrl) {
      return res.status(400).json({ error: 'imageUrl er påkrevd' });
    }

    const pool = await db.getTenantConnection(req.session.tenantId);
    
    // Finn bilde i database
    const imageResult = await pool.query(
      'SELECT id, metadata FROM avvik_images WHERE image_url = $1',
      [imageUrl]
    );
    
    if (imageResult.rows.length > 0) {
      // Det er et avvik-bilde
      const imageData = imageResult.rows[0];
      const metadata = imageData.metadata;
      
      // Slett fra database
      await pool.query('DELETE FROM avvik_images WHERE id = $1', [imageData.id]);
      
      // Slett fra Google Cloud Storage
      if (metadata && metadata.gcsPath) {
        try {
          await bucket.file(metadata.gcsPath).delete();
          console.log(`Slettet avvik-bilde fra GCS: ${metadata.gcsPath}`);
        } catch (gcsError) {
          console.warn('Kunne ikke slette fra GCS:', gcsError.message);
        }
      }
    } else {
      // Det er et generelt rapport-bilde
      const reportResult = await pool.query(
        'SELECT id FROM service_reports WHERE $1 = ANY(photos)',
        [imageUrl]
      );
      
      if (reportResult.rows.length > 0) {
        // Fjern fra photos array
        await pool.query(
          'UPDATE service_reports SET photos = array_remove(photos, $1) WHERE $1 = ANY(photos)',
          [imageUrl]
        );
        
        // Slett fra Google Cloud Storage
        try {
          // Ekstrahér GCS path fra URL
          const gcsPath = imageUrl.replace(`https://storage.googleapis.com/${bucketName}/`, '');
          await bucket.file(gcsPath).delete();
          console.log(`Slettet generelt bilde fra GCS: ${gcsPath}`);
        } catch (gcsError) {
          console.warn('Kunne ikke slette fra GCS:', gcsError.message);
        }
      } else {
        return res.status(404).json({ error: 'Bilde ikke funnet' });
      }
    }

    res.json({ success: true });

  } catch (error) {
    console.error('Feil ved sletting av bilde:', error);
    res.status(500).json({ error: 'Kunne ikke slette bilde' });
  }
});


module.exports = router;