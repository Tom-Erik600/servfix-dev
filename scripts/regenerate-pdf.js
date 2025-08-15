
// scripts/regenerate-pdf.js - Regenerer PDF for en spesifikk rapport eller ordre
require('dotenv').config();
const { Pool } = require('pg');
const UnifiedPDFGenerator = require('../src/services/unifiedPdfGenerator');

async function regeneratePDF() {
  // Parse kommandolinje-argumenter
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('📋 ServFix PDF Regenerering');
    console.log('\nBruk:');
    console.log('  node scripts/regenerate-pdf.js report <rapport-id>');
    console.log('  node scripts/regenerate-pdf.js order <ordre-id>');
    console.log('\nEksempler:');
    console.log('  node scripts/regenerate-pdf.js report 123');
    console.log('  node scripts/regenerate-pdf.js order 456');
    process.exit(1);
  }

  const [type, id] = args;
  const tenantId = process.env.DEFAULT_TENANT || 'airtech';

  if (!['report', 'order'].includes(type)) {
    console.error('❌ Type må være "report" eller "order"');
    process.exit(1);
  }

  if (!id || isNaN(id)) {
    console.error('❌ ID må være et tall');
    process.exit(1);
  }

  console.log(`🔄 Regenererer PDF for ${type} ${id} (tenant: ${tenantId})`);

  try {
    if (type === 'report') {
      await regenerateReportPDF(id, tenantId);
    } else {
      await regenerateOrderPDFs(id, tenantId);
    }
    
    console.log('\n✅ PDF regenerering fullført!');
    
  } catch (error) {
    console.error('\n❌ Feil under regenerering:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

async function regenerateReportPDF(reportId, tenantId) {
  console.log(`\n📄 Regenererer PDF for rapport SR-${reportId}...`);
  
  const pool = await getTenantConnection(tenantId);
  
  try {
    // Sjekk at rapporten eksisterer
    const checkQuery = `
      SELECT 
        sr.id,
        sr.order_id,
        sr.equipment_id,
        sr.pdf_path,
        sr.pdf_generated,
        sr.status,
        e.name as equipment_name,
        e.type as equipment_type,
        o.customer_name
      FROM service_reports sr
      LEFT JOIN equipment e ON sr.equipment_id = e.id
      LEFT JOIN orders o ON sr.order_id = o.id
      WHERE sr.id = $1
    `;
    
    const result = await pool.query(checkQuery, [reportId]);
    
    if (result.rows.length === 0) {
      throw new Error(`Rapport SR-${reportId} ikke funnet`);
    }
    
    const report = result.rows[0];
    
    console.log(`📊 Rapport info:`);
    console.log(`   ID: SR-${report.id}`);
    console.log(`   Ordre: ${report.order_id}`);
    console.log(`   Anlegg: ${report.equipment_type} (${report.equipment_name})`);
    console.log(`   Kunde: ${report.customer_name}`);
    console.log(`   Status: ${report.status}`);
    console.log(`   Eksisterende PDF: ${report.pdf_path || 'Ingen'}`);
    console.log(`   PDF generert: ${report.pdf_generated ? 'Ja' : 'Nei'}`);

    // Initialiser PDF-generator
    const pdfGenerator = new UnifiedPDFGenerator();
    
    try {
      console.log('\n📄 Starter PDF-generering med bildehåndtering...');
      const newPdfPath = await pdfGenerator.generateReport(report.id, tenantId);
      
      console.log(`✅ PDF regenerert: ${newPdfPath}`);
      
      // Vis info om bilder
      console.log('\n📸 Bildehåndtering aktivert:');
      console.log('   - Avvik-bilder vil vises under riktige avvik');
      console.log('   - Generelle bilder vil vises i oppsummering');
      console.log('   - Debug-informasjon lagres i test-output/ (development)');
      
    } finally {
      await pdfGenerator.close();
    }
    
  } finally {
    await pool.end();
  }
}

async function regenerateOrderPDFs(orderId, tenantId) {
  console.log(`\n📋 Regenererer PDF-er for ordre ${orderId}...`);
  
  const pool = await getTenantConnection(tenantId);
  
  try {
    // Hent alle rapporter for ordren
    const query = `
      SELECT 
        sr.id,
        sr.order_id,
        sr.equipment_id,
        sr.pdf_path,
        sr.pdf_generated,
        sr.status,
        e.name as equipment_name,
        e.type as equipment_type,
        o.customer_name
      FROM service_reports sr
      LEFT JOIN equipment e ON sr.equipment_id = e.id
      LEFT JOIN orders o ON sr.order_id = o.id
      WHERE sr.order_id = $1
        AND sr.status = 'completed'
      ORDER BY sr.created_at ASC
    `;
    
    const result = await pool.query(query, [orderId]);
    const reports = result.rows;
    
    if (reports.length === 0) {
      throw new Error(`Ingen fullførte rapporter funnet for ordre ${orderId}`);
    }
    
    console.log(`📊 Fant ${reports.length} rapporter for ordre ${orderId}:`);
    reports.forEach((report, index) => {
      console.log(`   ${index + 1}. SR-${report.id} | ${report.equipment_type} | PDF: ${report.pdf_generated ? 'Ja' : 'Nei'}`);
    });

    // Initialiser PDF-generator
    const pdfGenerator = new UnifiedPDFGenerator();
    let successCount = 0;
    let errorCount = 0;
    
    try {
      for (let i = 0; i < reports.length; i++) {
        const report = reports[i];
        const progress = `[${i + 1}/${reports.length}]`;
        
        console.log(`\n${progress} 📄 Regenererer PDF for SR-${report.id}...`);
        
        try {
          const newPdfPath = await pdfGenerator.generateReport(report.id, tenantId);
          console.log(`   ✅ PDF regenerert: ${newPdfPath}`);
          successCount++;
          
          // Liten pause
          await new Promise(resolve => setTimeout(resolve, 500));
          
        } catch (error) {
          console.error(`   ❌ Feil ved regenerering av SR-${report.id}:`, error.message);
          errorCount++;
        }
      }
      
    } finally {
      await pdfGenerator.close();
    }
    
    console.log(`\n📊 Sammendrag: ${successCount}/${reports.length} PDF-er regenerert, ${errorCount} feil`);
    
  } finally {
    await pool.end();
  }
}

async function getTenantConnection(tenantId) {
  const dbConfig = {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: `${tenantId}_db`
  };
  
  return new Pool(dbConfig);
}

// Kjør script
if (require.main === module) {
  regeneratePDF()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('💥 Script feilet:', error.message);
      process.exit(1);
    });
}