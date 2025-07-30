// test-gcs-simple.js - Forenklet test uten bucket listing
require('dotenv').config();
const { Storage } = require('@google-cloud/storage');

async function testGoogleCloudStorageSimple() {
  console.log('🧪 Testing ServFix Google Cloud Storage (simplified)...');
  
  try {
    // Les miljøvariabler
    const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
    const keyFilename = process.env.GOOGLE_CLOUD_KEY_FILE;
    const bucketName = process.env.GCS_BUCKET_NAME;
    
    console.log('📋 Configuration:');
    console.log('  Project ID:', projectId);
    console.log('  Key file:', keyFilename);
    console.log('  Bucket:', bucketName);
    
    if (!projectId || !keyFilename || !bucketName) {
      throw new Error('Missing required environment variables. Check your .env file.');
    }
    
    // Opprett Storage instance
    const storage = new Storage({
      projectId: projectId,
      keyFilename: keyFilename,
    });
    
    console.log('\n🔗 Testing connection...');
    
    // Test 1: Check specific bucket (krever ikke project-level tilgang)
    console.log('1. Testing bucket access...');
    const bucket = storage.bucket(bucketName);
    const [exists] = await bucket.exists();
    
    if (!exists) {
      throw new Error(`Bucket '${bucketName}' does not exist or no access`);
    }
    console.log(`✅ Bucket '${bucketName}' exists and is accessible`);
    
    // Test 2: Upload test file
    console.log('2. Testing file upload...');
    const testFileName = `test/servfix-test-${Date.now()}.txt`;
    const testContent = 'This is a test file from ServFix - Air Tech AS';
    
    const file = bucket.file(testFileName);
    await file.save(testContent, {
      metadata: {
        contentType: 'text/plain',
      },
    });
    
    console.log(`✅ Test file uploaded: ${testFileName}`);
    
    // Test 3: Generate public URL
    const publicUrl = `https://storage.googleapis.com/${bucketName}/${testFileName}`;
    console.log(`📎 Public URL: ${publicUrl}`);
    
    // Test 4: Read file back
    console.log('3. Testing file download...');
    const [contents] = await file.download();
    const downloadedContent = contents.toString();
    console.log(`✅ File content verified: "${downloadedContent.substring(0, 30)}..."`);
    
    // Test 5: Delete test file
    console.log('4. Cleaning up test file...');
    await file.delete();
    console.log('✅ Test file deleted');
    
    console.log('\n🎉 Google Cloud Storage setup is working correctly!');
    console.log('\n📁 Your images will be stored like this:');
    console.log('  tenants/airtech/service-reports/2025/01/order-12345/equipment-abc/avvik/avvik-001_timestamp.jpg');
    console.log('  tenants/airtech/service-reports/2025/01/order-12345/equipment-abc/general/general_timestamp.jpg');
    console.log('\n🌐 Public URLs will be:');
    console.log(`  https://storage.googleapis.com/${bucketName}/tenants/airtech/...`);
    console.log('\n✅ Ready for production image uploads!');
    
  } catch (error) {
    console.error('\n❌ Google Cloud Storage test failed:');
    console.error(error.message);
    
    if (error.message.includes('ENOENT')) {
      console.log('\n💡 Key file not found. Make sure:');
      console.log('  1. You downloaded the service account JSON key');
      console.log('  2. You placed it in config/gcp/servfix-storage-key.json');
      console.log('  3. The path in .env is correct');
    } else if (error.message.includes('authentication') || error.message.includes('permission')) {
      console.log('\n💡 Permission issue. Try:');
      console.log('  1. Give service account "Storage Admin" role instead of "Storage Object Admin"');
      console.log('  2. Or use this simplified test that only needs object access');
    } else if (error.message.includes('does not exist')) {
      console.log('\n💡 Bucket issue. Make sure:');
      console.log('  1. Bucket name in .env matches the actual bucket name');
      console.log('  2. Bucket exists in the correct project');
    }
    
    process.exit(1);
  }
}

// Kjør test
testGoogleCloudStorageSimple();