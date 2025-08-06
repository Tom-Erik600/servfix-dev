// clear-all-test-data.js - Kombinert script for å slette ALL testdata
require('dotenv').config();
const { Pool } = require('pg');
const { execSync } = require('child_process');
const readline = require('readline');

async function clearAllTestData() {
  console.log('🧹 ServFix - Komplett nullstilling av testdata');
  console.log('⚠️  ADVARSEL: Dette vil slette:');
  console.log('   - Alle ordre, servicerapporter, utstyr og tilbud fra database');
  console.log('   - Alle bilder i Google Cloud Storage');
  console.log('   - Alle PDF-rapporter på serveren');
  console.log('\n⚠️  Denne handlingen kan IKKE angres!');
  
  // Be om bekreftelse
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  const answer = await new Promise(resolve => {
    rl.question('\nVil du fortsette? (skriv "NULLSTILL" for å bekrefte): ', resolve);
  });
  rl.close();
  
  if (answer !== 'NULLSTILL') {
    console.log('❌ Avbrutt av bruker');
    return;
  }
  
  try {
    // Steg 1: Slett database-data
    console.log('\n📊 Steg 1/3: Sletter database-data...');
    await clearDatabase();
    
    // Steg 2: Slett bilder i GCS
    console.log('\n🖼️ Steg 2/3: Sletter bilder i Google Cloud Storage...');
    await clearGCSImages();
    
    // Steg 3: Slett lokale PDF-er
    console.log('\n📄 Steg 3/3: Sletter lokale PDF-rapporter...');
    await clearLocalPDFs();
    
    console.log('\n✅ FERDIG! All testdata er slettet.');
    console.log('🚀 Du kan nå starte testing på nytt med en ren database!');
    
  } catch (error) {
    console.error('\n❌ Feil under nullstilling:', error.message);
    process.exit(1);
  }
}

async function clearDatabase() {
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: 'airtech_db'
  });
  
  try {
    await pool.query('TRUNCATE TABLE orders, service_reports, equipment, quotes, avvik_images CASCADE');
    console.log('   ✅ Database tømt');
  } finally {
    await pool.end();
  }
}

async function clearGCSImages() {
  // Kjør clear-gcs-images.js som subprocess med auto-bekreftelse
  try {
    execSync('echo "SLETT" | node scripts/clear-gcs-images.js', { 
      stdio: 'inherit',
      shell: true 
    });
  } catch (error) {
    console.log('   ⚠️  Kunne ikke kjøre clear-gcs-images.js automatisk');
    console.log('   💡 Kjør manuelt: node scripts/clear-gcs-images.js');
  }
}

async function clearLocalPDFs() {
  // Kjør clear-local-pdfs.js
  try {
    require('./clear-local-pdfs')();
  } catch (error) {
    console.log('   ⚠️  Kunne ikke slette lokale PDF-er');
    console.log('   💡 Sjekk at clear-local-pdfs.js eksisterer');
  }
}

// Kjør script
if (require.main === module) {
  clearAllTestData();
}