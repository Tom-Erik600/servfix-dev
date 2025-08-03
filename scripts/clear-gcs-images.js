// clear-gcs-images.js - Script for å slette bilder fra GCS bucket
require('dotenv').config();
const { Storage } = require('@google-cloud/storage');

async function clearGCSImages() {
  console.log('🗑️  Sletter bilder fra Google Cloud Storage...');
  
  try {
    // Opprett Storage instance
    const storage = new Storage({
      projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
      keyFilename: process.env.GOOGLE_CLOUD_KEY_FILE,
    });
    
    const bucketName = process.env.GCS_BUCKET_NAME || 'servfix-files';
    const bucket = storage.bucket(bucketName);
    
    const tenantId = 'airtech'; // Eller hent fra miljøvariabler
    
    // Definer prefixes for ulike typer bilder
    const imagePrefixes = [
      `tenants/${tenantId}/service-reports/`, // Alle servicerapport-bilder
      `tenants/${tenantId}/uploads/`,          // Eventuelle andre opplastninger
      `test/`                                  // Test-filer
    ];
    
    console.log(`📁 Bucket: ${bucketName}`);
    console.log(`🏢 Tenant: ${tenantId}`);
    
    for (const prefix of imagePrefixes) {
      console.log(`\n🔍 Søker etter filer med prefix: ${prefix}`);
      
      const [files] = await bucket.getFiles({
        prefix: prefix,
      });
      
      if (files.length === 0) {
        console.log(`   ✅ Ingen filer funnet med prefix ${prefix}`);
        continue;
      }
      
      console.log(`   📄 Fant ${files.length} filer`);
      
      // Vis liste over filer som skal slettes (første 10)
      const filesToShow = files.slice(0, 10);
      filesToShow.forEach(file => {
        console.log(`   - ${file.name}`);
      });
      
      if (files.length > 10) {
        console.log(`   ... og ${files.length - 10} til`);
      }
      
      // ADVARSEL og bekreftelse
      console.log(`\n⚠️  ADVARSEL: Dette vil slette ${files.length} filer permanent!`);
      
      // I produksjon, legg til bekreftelse:
      // const readline = require('readline');
      // const rl = readline.createInterface({
      //   input: process.stdin,
      //   output: process.stdout
      // });
      // 
      // const answer = await new Promise(resolve => {
      //   rl.question('Vil du fortsette? (skriv "SLETT" for å bekrefte): ', resolve);
      // });
      // rl.close();
      // 
      // if (answer !== 'SLETT') {
      //   console.log('❌ Avbrutt av bruker');
      //   continue;
      // }
      
      // Slett filer i batcher av 100
      const batchSize = 100;
      let deletedCount = 0;
      
      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        
        console.log(`   🗑️  Sletter batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(files.length/batchSize)} (${batch.length} filer)...`);
        
        await Promise.all(batch.map(file => file.delete()));
        deletedCount += batch.length;
        
        console.log(`   ✅ ${deletedCount}/${files.length} filer slettet`);
      }
      
      console.log(`✅ Alle ${deletedCount} filer med prefix ${prefix} er slettet!`);
    }
    
    console.log('\n🎉 Google Cloud Storage er tømt for bilder!');
    
  } catch (error) {
    console.error('\n❌ Feil ved sletting av bilder:', error.message);
    
    if (error.message.includes('authentication')) {
      console.log('\n💡 Autentiseringsfeil. Sjekk:');
      console.log('  1. Service account nøkkel er korrekt');
      console.log('  2. Service account har "Storage Object Admin" rolle');
    }
    
    process.exit(1);
  }
}

// Spesiell funksjon for å slette ALLE filer fra bucket (FARLIG!)
async function clearEntireBucket() {
  console.log('💀 ADVARSEL: Dette vil slette ALT fra bucket!');
  
  const storage = new Storage({
    projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
    keyFilename: process.env.GOOGLE_CLOUD_KEY_FILE,
  });
  
  const bucketName = process.env.GCS_BUCKET_NAME;
  const bucket = storage.bucket(bucketName);
  
  const [files] = await bucket.getFiles();
  console.log(`Fant ${files.length} filer totalt`);
  
  // Uncomment for å faktisk slette alt:
  // await Promise.all(files.map(file => file.delete()));
  // console.log('✅ Alle filer slettet fra bucket');
}

// Kjør script
if (require.main === module) {
  // Kjør clearGCSImages() for normal tømming
  clearGCSImages();
  
  // Eller kjør clearEntireBucket() for å slette ALT (kommenter ut clearGCSImages() først)
  // clearEntireBucket();
}