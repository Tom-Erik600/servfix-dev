// clear-gcs-images.js - Script for å slette bilder fra GCS bucket
require('dotenv').config();
const { Storage } = require('@google-cloud/storage');

async function clearGCSImages() {
  console.log('🗑️  Sletter bilder fra Google Cloud Storage...');
  
  try {
    // Opprett Storage instance - prøv ADC først, så keyFilename
    let storage;
    
    // Sjekk om nøkkelfil eksisterer
    const fs = require('fs');
    const keyFilePath = process.env.GOOGLE_CLOUD_KEY_FILE;
    
    if (keyFilePath && fs.existsSync(keyFilePath)) {
      console.log('📄 Bruker service account nøkkelfil');
      storage = new Storage({
        projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
        keyFilename: keyFilePath,
      });
    } else {
      console.log('🔑 Bruker Application Default Credentials (ADC)');
      storage = new Storage({
        projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
        // Ingen keyFilename - bruker ADC automatisk
      });
    }
    
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
    
    let totalFilesToDelete = 0;
    let allFiles = [];
    
    // Først, finn alle filer som skal slettes
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
      
      totalFilesToDelete += files.length;
      allFiles = allFiles.concat(files);
    }
    
    if (totalFilesToDelete === 0) {
      console.log('\n✅ Ingen filer å slette!');
      return;
    }
    
    // ADVARSEL og bekreftelse
    console.log(`\n⚠️  ADVARSEL: Dette vil slette ${totalFilesToDelete} filer permanent!`);
    console.log('⚠️  Denne handlingen kan IKKE angres!');
    
    // Aktiver bekreftelse for produksjon
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    const answer = await new Promise(resolve => {
      rl.question('\nVil du fortsette? (skriv "SLETT" for å bekrefte): ', resolve);
    });
    rl.close();
    
    if (answer !== 'SLETT') {
      console.log('❌ Avbrutt av bruker');
      return;
    }
    
    // Slett filer i batcher av 100
    console.log('\n🗑️  Starter sletting...');
    const batchSize = 100;
    let deletedCount = 0;
    
    for (let i = 0; i < allFiles.length; i += batchSize) {
      const batch = allFiles.slice(i, i + batchSize);
      
      console.log(`   🗑️  Sletter batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(allFiles.length/batchSize)} (${batch.length} filer)...`);
      
      await Promise.all(batch.map(file => file.delete()));
      deletedCount += batch.length;
      
      console.log(`   ✅ ${deletedCount}/${allFiles.length} filer slettet`);
    }
    
    console.log(`\n🎉 Ferdig! Slettet totalt ${deletedCount} filer fra Google Cloud Storage!`);
    
  } catch (error) {
    console.error('\n❌ Feil ved sletting av bilder:', error.message);
    
    if (error.message.includes('authentication')) {
      console.log('\n💡 Autentiseringsfeil. Prøv:');
      console.log('  1. Kjør: gcloud auth application-default login');
      console.log('  2. Sjekk at prosjekt er satt: gcloud config set project servfix-production');
      console.log('  3. Eller legg til service account nøkkelfil');
    }
    
    if (error.message.includes('storage.googleapis.com')) {
      console.log('\n💡 API-feil. Sjekk at Cloud Storage API er aktivert:');
      console.log('  https://console.cloud.google.com/apis/library/storage.googleapis.com');
    }
    
    process.exit(1);
  }
}

// Kjør script
if (require.main === module) {
  clearGCSImages();
}