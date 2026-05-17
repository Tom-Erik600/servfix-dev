// src/services/storage.js — sentralisert GCS-bildehåndtering
const { bucket, bucketName } = require('../config/gcs');

if (!bucket) {
  throw new Error('GCS bucket not configured — set GCS_BUCKET_NAME environment variable');
}

// Last opp buffer til Google Cloud Storage. Returnerer public URL.
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

// Slett ett bilde fra GCS gitt public URL. Idempotent — kaster ikke hvis filen
// ikke finnes, men logger.
//
// ⚠️ SIKKERHETSGRENSE: Denne funksjonen validerer IKKE at filen tilhører en gitt
// tenant. Den skal KUN kalles med server-genererte URLer (f.eks. kompenserende
// sletting av et bilde vi nettopp selv lastet opp i samme request). Den er IKKE
// en erstatter for ensureTenantFilePath(imageUrl, tenantId) i images.js.
// Slette-rutene (/avvik/:id, /general/:id, /sja/:id) tar bruker-styrt input og
// MÅ fortsatt bruke ensureTenantFilePath for path-traversal-/cross-tenant-vern.
async function deleteImage(imageUrl) {
  try {
    const urlPath = new URL(imageUrl).pathname;
    const rawFilePath = urlPath.substring(
      urlPath.indexOf(bucketName) + bucketName.length + 1
    );
    const decodedFilePath = decodeURIComponent(rawFilePath);
    await bucket.file(decodedFilePath).delete();
    console.log(`✅ Fil slettet fra GCS: ${decodedFilePath}`);
    return true;
  } catch (storageError) {
    console.warn('Kunne ikke slette fra GCS:', storageError.message);
    return false;
  }
}

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
  } else if (imageType === 'ok') {
    // NYTT: OK-bilder har eget filnavn-mønster og lagres i /ok/-undermappen
    filename = `ok_${timestamp}_${random}.${fileExtension}`;
  } else {
    filename = `${imageType}_${timestamp}_${random}.${fileExtension}`;
  }

  // NYTT: OK-bilder lagres i egen undermappe under ordren
  const subfolder = imageType === 'ok' ? '/ok' : '';

  return `tenants/${tenantId}/service-reports/${year}/${month}/order-${orderId}${subfolder}/${filename}`;
}

module.exports = { uploadToGCS, deleteImage, generateImagePath };
