// test-gcs.js - Test Google Cloud Storage oppsett
require('dotenv').config();
const { Storage } = require('@google-cloud/storage');

async function testGoogleCloudStorage() {
  console.log('🧪 Testing ServFix Google Cloud Storage setup...');
  
  try {
    // Les miljøvariabler
    const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
    const keyFilename = process.env.GOOGLE_CLOUD_KEY_FILE;
    const bucketName = process.env.GCS_BUCKET_NAME;
    
    console.log('🏢 Project: servfix-production');
    console.log('🪣 Bucket: servfix-files');
    console.log('📋 Configuration:');
    console.log('  Project ID:', projectId, '(servfix-production)');
    console.log('  Key file:', keyFilename);
    console.log('  Bucket:', bucketName, '(servfix-files)');
    
    if (!projectId || !keyFilename || !bucketName) {
      throw new Error('Missing required environment variables. Check your .env file.');
    }
    
    // Opprett Storage instance
    const storage = new Storage({
      projectId: projectId,
      keyFilename: keyFilename,
    });
    
    console.log('\n🔗 Testing connection...');
    
    // Test 1: List buckets
    console.log('1. Testing authentication and project access...');
    const [buckets] = await storage.getBuckets();
    console.log(`✅ Found ${buckets.length} bucket(s) in project`);
    
    // Test 2: Check specific bucket
    console.log('2. Testing bucket access...');
    const bucket = storage.bucket(bucketName);
    const [exists] = await bucket.exists();
    
    if (!exists) {
      throw new Error(`Bucket '${bucketName}' does not exist`);
    }
    console.log(`✅ Bucket '${bucketName}' exists and is accessible`);
    
    // Test 3: Upload test file
    console.log('3. Testing file upload...');
    const testFileName = `test/servfix-test-${Date.now()}.txt`;
    const testContent = 'This is a test file from ServFix - Air Tech AS';
    
    const file = bucket.file(testFileName);
    await file.save(testContent, {
      metadata: {
        contentType: 'text/plain',
      },
    });
    
    console.log(`✅ Test file uploaded: ${testFileName}`);
    
    // Test 4: Generate public URL
    const publicUrl = `https://storage.googleapis.com/${bucketName}/${testFileName}`;
    console.log(`📎 Public URL: ${publicUrl}`);
    
    // Test 5: Delete test file
    console.log('4. Cleaning up test file...');
    await file.delete();
    console.log('✅ Test file deleted');
    
    console.log('\n🎉 Google Cloud Storage setup is working correctly!');
    console.log('\n📁 Your images will be stored like this:');
    console.log('  tenants/airtech/service-reports/2025/01/order-12345/equipment-abc/avvik/avvik-001_timestamp.jpg');
    console.log('  tenants/airtech/service-reports/2025/01/order-12345/equipment-abc/general/general_timestamp.jpg');
    console.log('\n🌐 Public URLs will be:');
    console.log(`  https://storage.googleapis.com/servfix-files/tenants/airtech/...`);
    
  } catch (error) {
    console.error('\n❌ Google Cloud Storage test failed:');
    console.error(error.message);
    
    if (error.message.includes('ENOENT')) {
      console.log('\n💡 Key file not found. Make sure:');
      console.log('  1. You downloaded the service account JSON key');
      console.log('  2. You placed it in the correct path');
      console.log('  3. The path in .env is correct');
    } else if (error.message.includes('authentication')) {
      console.log('\n💡 Authentication failed. Make sure:');
      console.log('  1. Service account has Storage Object Admin role');
      console.log('  2. JSON key file is valid and not corrupted');
      console.log('  3. Project ID is correct');
    } else if (error.message.includes('permission')) {
      console.log('\n💡 Permission denied. Make sure:');
      console.log('  1. Service account has access to the bucket');
      console.log('  2. Cloud Storage API is enabled');
      console.log('  3. Billing is enabled on the project');
    }
    
    process.exit(1);
  }
}

// Kjør test
testGoogleCloudStorage();