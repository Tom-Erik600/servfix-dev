/**
 * F2: Sentralisert GCS bucket-konfigurasjon.
 * Alle filer som trenger bucket-navn bruker denne modulen.
 */
const { Storage } = require('@google-cloud/storage');

// Resolve bucket-navn én gang
let bucketName = process.env.GCS_BUCKET_NAME;
if (!bucketName) {
  const env = process.env.NODE_ENV || 'development';
  if (env === 'production') {
    bucketName = 'servfix-files';
  } else if (env === 'staging' || env === 'test') {
    bucketName = 'servfix-files-test';
  }
  // development: leave undefined — GCS disabled locally unless env var is set
  if (bucketName) {
    console.warn(`⚠️ GCS_BUCKET_NAME not set, using fallback: ${bucketName} (NODE_ENV: ${env})`);
  }
}

// Opprett Storage-instans (delt for hele appen)
let storage = null;
let bucket = null;

if (bucketName) {
  try {
    storage = new Storage({
      projectId: process.env.GOOGLE_CLOUD_PROJECT_ID || undefined,
      keyFilename: process.env.GOOGLE_CLOUD_KEY_FILE || undefined,
    });
    bucket = storage.bucket(bucketName);
    console.log(`🪣 GCS bucket: ${bucketName}`);
  } catch (e) {
    console.warn('⚠️ GCS init failed:', e.message);
  }
}

module.exports = { storage, bucket, bucketName };
