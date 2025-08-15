// scripts/regenerate-all-pdfs.js - Fungerer med eksisterende database og bucket
require('dotenv').config();
const { Pool } = require('pg');
const readline = require('readline');

async function regenerateAllPDFs() {
  console.log('🔄 ServFix - Regenerer alle PDF-er med bildehåndtering');
  console.log('📋 Dette scriptet vil:');
  console.log('   - Finne alle servicerapporter med eksisterende PDF-er');
  console.log('   - Regenerere PDF-ene med den oppdaterte unifiedPdfGenerator.js');
  console.log('   - Koble avvik-bilder fra avvik_images tabellen til PDF-en');
  console.log('   - Oppdatere PDF-stier i databasen');
  
  // Be om bekreftelse
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  const answer = await new Promise(resolve => {
    rl.question('\nVil du fortsette? (j/N): ', resolve);
  });
  rl.close();
  
  const validAnswers = ['j', 'ja', 'y', 'yes'];
  if (!validAnswers.includes(answer.toLowerCase())) {
    console.log('❌ Avbrutt av bruker');
    return;
  }

  console.log('\n🚀 Starter regenerering av PDF-er...\n');

  // Bruk direkte database-tilkobling som andre scripts
  const { Pool } = require('pg');
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: 'airtech_db'  // Direkte til airtech_db
  });
  
  try {
    console.log('📋 Henter rapporter som kan regenereres...');
    
    // Test database connection først
    await pool.query('SELECT 1');
    console.log('✅ Database tilkobling OK');
    
    // Hent alle servicerapporter som har genererte PDF-er
    const query = `
      SELECT 
        sr.id,
        sr.order_id,
        sr.equipment_id,
        sr.pdf_path,
        sr.pdf_generated,
        sr.status,
        sr.created_at,
        e.name as equipment_name,
        e.type as equipment_type,
        o.customer_name
      FROM service_reports sr
      LEFT JOIN equipment e ON sr.equipment_id = e.id
      LEFT JOIN orders o ON sr.order_id = o.id
      WHERE sr.pdf_generated = true 
        AND sr.status = 'completed'
      ORDER BY sr.created_at DESC
    `;
    
    const result = await pool.query(query);
    const reports = result.rows;
    
    console.log(`📊 Fant ${reports.length} rapporter med eksisterende PDF-er`);
    
    if (reports.length === 0) {
      console.log('✅ Ingen rapporter å regenerere');
      return;
    }

    // Vis oversikt over bilder i systemet
    await showImageStats(pool);

    // Vis oversikt over rapporter
    console.log('\n📋 Rapporter som skal regenereres:');
    reports.forEach((report, index) => {
      console.log(`   ${index + 1}. SR-${report.id} | ${report.equipment_type} | ${report.customer_name}`);
    });
    
    // Initialiser PDF-generator (den oppdaterte versjonen)
    console.log('\n📄 Initialiserer PDF-generator med bildehåndtering...');
    const UnifiedPDFGenerator = require('../src/services/unifiedPdfGenerator');
    const pdfGenerator = new UnifiedPDFGenerator();
    
    let successCount = 0;
    let errorCount = 0;
    
    try {
      // Regenerer hver rapport
      for (let i = 0; i < reports.length; i++) {
        const report = reports[i];
        const progress = `[${i + 1}/${reports.length}]`;
        
        console.log(`\n${progress} 📄 Regenererer PDF for rapport SR-${report.id}...`);
        console.log(`   Type: ${report.equipment_type}`);
        console.log(`   Kunde: ${report.customer_name}`);
        console.log(`   Original PDF: ${report.pdf_path}`);
        
        try {
          // Regenerer PDF med den oppdaterte generatoren
          const newPdfPath = await pdfGenerator.generateReport(report.id, 'airtech');
          
          console.log(`   ✅ PDF regenerert: ${newPdfPath}`);
          successCount++;
          
          // Legg til liten pause for å unngå overbelastning
          await new Promise(resolve => setTimeout(resolve, 1000));
          
        } catch (error) {
          console.error(`   ❌ Feil ved regenerering av SR-${report.id}:`, error.message);
          errorCount++;
          
          // Log detaljert feilinfo for debugging
          console.error(`      Report ID: ${report.id}`);
          console.error(`      Equipment: ${report.equipment_type}`);
          console.error(`      Error: ${error.stack?.split('\n')[0] || error.message}`);
        }
      }
      
    } finally {
      // Lukk PDF-generator
      await pdfGenerator.close();
    }
    
    // Sammendrag
    console.log('\n🎉 === SAMMENDRAG ===');
    console.log(`📊 Totalt prosessert: ${reports.length} rapporter`);
    console.log(`✅ Vellykket regenerert: ${successCount} PDF-er`);
    console.log(`❌ Feil: ${errorCount}`);
    
    if (reports.length > 0) {
      console.log(`📈 Suksessrate: ${((successCount/reports.length)*100).toFixed(1)}%`);
    }
    
    if (successCount > 0) {
      console.log('\n🎯 Alle PDF-er har nå bildehåndtering aktivert!');
      console.log('   - Avvik-bilder fra avvik_images tabellen vises under riktige avvik');
      console.log('   - Generelle bilder fra photos kolonnen vises i oppsummering');
      console.log('   - Bilder hentes fra Google Cloud Storage bucket');
      console.log('   - Debug-informasjon er tilgjengelig i loggene');
    }

  } catch (error) {
    console.error('\n❌ Kritisk feil under regenerering:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

async function showImageStats(pool) {
  console.log('\n📸 === BILDE STATISTIKK ===');
  
  // Avvik-bilder statistikk
  const avvikQuery = `
    SELECT 
      COUNT(*) as total_avvik_images,
      COUNT(DISTINCT service_report_id) as reports_with_avvik_images,
      COUNT(DISTINCT avvik_number) as unique_avvik_numbers
    FROM avvik_images
  `;
  
  const avvikResult = await pool.query(avvikQuery);
  const avvikStats = avvikResult.rows[0];
  
  console.log(`📸 Totalt avvik-bilder: ${avvikStats.total_avvik_images}`);
  console.log(`📋 Rapporter med avvik-bilder: ${avvikStats.reports_with_avvik_images}`);
  console.log(`🔢 Unike avvik-numre: ${avvikStats.unique_avvik_numbers}`);
  
  // Generelle bilder statistikk
  const generalQuery = `
    SELECT 
      COUNT(*) as reports_with_photos,
      SUM(array_length(photos, 1)) as total_general_images
    FROM service_reports 
    WHERE photos IS NOT NULL AND array_length(photos, 1) > 0
  `;
  
  const generalResult = await pool.query(generalQuery);
  const generalStats = generalResult.rows[0];
  
  console.log(`📷 Rapporter med generelle bilder: ${generalStats.reports_with_photos || 0}`);
  console.log(`🖼️ Totalt generelle bilder: ${generalStats.total_general_images || 0}`);
  
  // Sample bilde-URLs
  const sampleQuery = `
    SELECT image_url FROM avvik_images 
    WHERE image_url IS NOT NULL 
    LIMIT 2
  `;
  
  const sampleResult = await pool.query(sampleQuery);
  if (sampleResult.rows.length > 0) {
    console.log('\n📎 Sample bilde-URLs:');
    sampleResult.rows.forEach((row, index) => {
      const url = row.image_url;
      const shortUrl = url.length > 80 ? url.substring(0, 77) + '...' : url;
      console.log(`   ${index + 1}. ${shortUrl}`);
      
      // Sjekk om det er GCS URL
      if (url.includes('storage.googleapis.com')) {
        console.log(`      ✅ Google Cloud Storage URL`);
      } else {
        console.log(`      ⚠️  Ikke-standard URL format`);
      }
    });
  }
}

// Kjør script hvis det er hovedmodulen
if (require.main === module) {
  regenerateAllPDFs()
    .then(() => {
      console.log('\n🎉 Regenerering fullført!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Script feilet:', error.message);
      process.exit(1);
    });
}

module.exports = { regenerateAllPDFs };