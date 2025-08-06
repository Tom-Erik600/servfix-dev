// test-pdf-local.js - Test PDF-generering lokalt
require('dotenv').config();
const UnifiedPDFGenerator = require('./src/services/unifiedPdfGenerator');

async function testLocalPDFGeneration() {
  console.log('🧪 Testing local PDF generation...');
  console.log('📍 Chrome location:', process.env.PUPPETEER_EXECUTABLE_PATH || 'Default Puppeteer path');
  
  const generator = new UnifiedPDFGenerator();
  
  try {
    // Test 1: Initialiser Puppeteer
    console.log('\n1. Initializing Puppeteer...');
    await generator.init();
    console.log('✅ Puppeteer initialized successfully');
    
    // Test 2: Generer en enkel test-PDF
    console.log('\n2. Generating test PDF...');
    const testHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Test PDF</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 40px; }
          h1 { color: #0066cc; }
        </style>
      </head>
      <body>
        <h1>ServFix Test PDF</h1>
        <p>Dette er en test-PDF generert lokalt.</p>
        <p>Tidspunkt: ${new Date().toLocaleString('no-NO')}</p>
        <p>Chrome versjon: 138.0.7204.168</p>
      </body>
      </html>
    `;
    
    const pdfBuffer = await generator.generatePDF(testHTML);
    console.log('✅ PDF generated successfully');
    console.log('📄 PDF size:', (pdfBuffer.length / 1024).toFixed(2), 'KB');
    
    // Test 3: Lagre lokalt (ikke til GCS)
    console.log('\n3. Saving test PDF locally...');
    const fs = require('fs').promises;
    const path = require('path');
    
    const testDir = path.join(__dirname, 'test-output');
    await fs.mkdir(testDir, { recursive: true });
    
    const filename = `test-pdf-${Date.now()}.pdf`;
    const filepath = path.join(testDir, filename);
    await fs.writeFile(filepath, pdfBuffer);
    
    console.log('✅ PDF saved to:', filepath);
    
    // Test 4: Cleanup
    console.log('\n4. Cleaning up...');
    await generator.close();
    console.log('✅ Puppeteer closed');
    
    console.log('\n🎉 Local PDF generation is working!');
    console.log('\n📝 Next steps:');
    console.log('1. Test ordre-ferdigstilling i appen');
    console.log('2. PDF-er vil lagres lokalt i: servfix-files/tenants/airtech/reports/');
    console.log('3. På sky vil de lagres i Google Cloud Storage');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error('Stack:', error.stack);
    
    if (error.message.includes('Could not find Chrome')) {
      console.log('\n💡 Chrome ble installert, men Puppeteer finner den ikke.');
      console.log('Prøv å restarte terminalen eller legg til i .env:');
      console.log(`PUPPETEER_EXECUTABLE_PATH=${process.env.HOME || process.env.USERPROFILE}\\.cache\\puppeteer\\chrome\\win64-138.0.7204.168\\chrome-win64\\chrome.exe`);
    }
  } finally {
    try {
      await generator.close();
    } catch (e) {
      // Ignorer feil ved lukking
    }
  }
}

// Kjør test
testLocalPDFGeneration();