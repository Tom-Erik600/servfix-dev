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
    console.error('Stack:', error.stack);
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
    // Slett data i riktig rekkefølge (dependencies først)
    console.log('   🗑️  Sletter service_reports...');
    await pool.query('DELETE FROM service_reports');
    
    console.log('   🗑️  Sletter avvik_images...');
    await pool.query('DELETE FROM avvik_images');
    
    console.log('   🗑️  Sletter quotes...');
    await pool.query('DELETE FROM quotes');
    
    console.log('   🗑️  Sletter orders...');
    await pool.query('DELETE FROM orders');
    
    console.log('   🗑️  Sletter equipment...');
    await pool.query('DELETE FROM equipment');
    
    console.log('   🗑️  Sletter checklist_instructions...');
    await pool.query('DELETE FROM checklist_instructions');
    
    // Reset SERIAL sequences så IDs starter på 1 igjen
    console.log('   🔄 Resetter ID-sekvenser...');
    await pool.query('ALTER SEQUENCE IF EXISTS equipment_id_seq RESTART WITH 1');
    
    console.log('   ✅ Database tømt og ID-sekvenser reset');
  } catch (error) {
    console.error('   ❌ Database-feil:', error.message);
    console.error('   Detaljer:', error);
    throw error;
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