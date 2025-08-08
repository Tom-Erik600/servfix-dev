// test-current-config.js - Test din nåværende GCS konfigurasjon
require('dotenv').config();
const { Storage } = require('@google-cloud/storage');
const fs = require('fs');

async function testCurrentConfig() {
  console.log('🔍 Testing ServFix GCS Configuration...\n');
  
  // 1. Sjekk miljøvariabler
  console.log('📋 Environment Variables:');
  console.log('------------------------');
  console.log('GOOGLE_APPLICATION_CREDENTIALS:', process.env.GOOGLE_APPLICATION_CREDENTIALS ? '✅ SET (JSON string)' : '❌ NOT SET');
  console.log('GOOGLE_CLOUD_PROJECT_ID:', process.env.GOOGLE_CLOUD_PROJECT_ID || '❌ NOT SET');
  console.log('GOOGLE_CLOUD_KEY_FILE:', process.env.GOOGLE_CLOUD_KEY_FILE || '❌ NOT SET');
  console.log('GCP_PROJECT_ID:', process.env.GCP_PROJECT_ID || '❌ NOT SET');
  console.log('GCS_BUCKET_NAME:', process.env.GCS_BUCKET_NAME || '❌ NOT SET');
  
  // 2. Sjekk om key file eksisterer
  if (process.env.GOOGLE_CLOUD_KEY_FILE) {
    const keyFileExists = fs.existsSync(process.env.GOOGLE_CLOUD_KEY_FILE);
    console.log(`\nKey file check: ${process.env.GOOGLE_CLOUD_KEY_FILE}`);
    console.log(`File exists: ${keyFileExists ? '✅ YES' : '❌ NO'}`);
  }
  
  // 3. Prøv å initialisere Storage
  console.log('\n🔧 Initializing Google Cloud Storage...');
  let storage;
  let method = '';
  
  try {
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      // Metode 1: JSON string i miljøvariabel
      console.log('Using method: GOOGLE_APPLICATION_CREDENTIALS (JSON)');
      const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS);
      storage = new Storage({
        projectId: process.env.GCP_PROJECT_ID || credentials.project_id,
        credentials: credentials
      });
      method = 'GOOGLE_APPLICATION_CREDENTIALS';
      
    } else if (process.env.GOOGLE_CLOUD_KEY_FILE && fs.existsSync(process.env.GOOGLE_CLOUD_KEY_FILE)) {
      // Metode 2: Key file path
      console.log('Using method: GOOGLE_CLOUD_KEY_FILE');
      storage = new Storage({
        projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
        keyFilename: process.env.GOOGLE_CLOUD_KEY_FILE
      });
      method = 'GOOGLE_CLOUD_KEY_FILE';
      
    } else {
      // Metode 3: Fallback til config fil
      console.log('Using method: serviceAccountKey.json (fallback)');
      const keyPath = './src/config/serviceAccountKey.json';
      if (fs.existsSync(keyPath)) {
        const serviceAccountKey = require(keyPath);
        storage = new Storage({
          projectId: serviceAccountKey.project_id,
          credentials: serviceAccountKey
        });
        method = 'serviceAccountKey.json';
      } else {
        throw new Error('No valid GCS credentials found');
      }
    }
    
    console.log(`✅ Storage initialized using: ${method}`);
    
  } catch (error) {
    console.error('❌ Failed to initialize Storage:', error.message);
    process.exit(1);
  }
  
  // 4. Test bucket access
  const bucketName = process.env.GCS_BUCKET_NAME || 'servfix-files';
  console.log(`\n🪣 Testing bucket: ${bucketName}`);
  
  try {
    const bucket = storage.bucket(bucketName);
    const [exists] = await bucket.exists();
    
    if (!exists) {
      throw new Error(`Bucket '${bucketName}' does not exist or is not accessible`);
    }
    
    console.log('✅ Bucket exists and is accessible');
    
    // 5. Test file upload
    console.log('\n📤 Testing file upload...');
    const testContent = Buffer.from('ServFix GCS test file');
    const testFileName = `test/config-test-${Date.now()}.txt`;
    
    const file = bucket.file(testFileName);
    await file.save(testContent, {
      metadata: {
        contentType: 'text/plain'
      }
    });
    
    console.log(`✅ Test file uploaded: ${testFileName}`);
    
    // 6. Test file read
    console.log('\n📥 Testing file download...');
    const [downloaded] = await file.download();
    console.log(`✅ File downloaded, content: "${downloaded.toString()}"`);
    
    // 7. Clean up
    console.log('\n🧹 Cleaning up...');
    await file.delete();
    console.log('✅ Test file deleted');
    
    // Success!
    console.log('\n✨ SUCCESS! Your GCS configuration is working correctly!');
    console.log(`\n📌 Configuration summary:`);
    console.log(`   Method: ${method}`);
    console.log(`   Bucket: ${bucketName}`);
    console.log(`   Ready for production use!`);
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    
    if (error.message.includes('storage.bucket is not a function')) {
      console.log('\n💡 Storage was not initialized properly. Check your credentials.');
    } else if (error.message.includes('does not exist')) {
      console.log('\n💡 Bucket not found. Make sure:');
      console.log('   1. Bucket name is correct in .env');
      console.log('   2. Service account has access to the bucket');
    } else if (error.message.includes('permission')) {
      console.log('\n💡 Permission denied. Make sure:');
      console.log('   1. Service account has Storage Admin or Storage Object Admin role');
      console.log('   2. Bucket permissions are configured correctly');
    }
    
    process.exit(1);
  }
}

// Run the test
testCurrentConfig().catch(console.error);