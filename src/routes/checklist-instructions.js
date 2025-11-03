// ==============================================
// FORBEDRET src/routes/checklist-instructions.js
// Med debugging og kompatibilitet for både lokal og cloud
// ==============================================

const express = require('express');
const db = require('../config/database');

const router = express.Router();

// Debugging middleware - logger ALL requests til denne route
router.use((req, res, next) => {
  console.log('📋 [INSTRUCTIONS] Request:', {
    method: req.method,
    path: req.path,
    fullUrl: req.originalUrl,
    params: req.params,
    body: req.body,
    tenantId: req.tenantId,
    sessionTenantId: req.session?.tenantId,
    headers: {
      'content-type': req.headers['content-type'],
      'user-agent': req.headers['user-agent']?.slice(0, 50)
    }
  });
  next();
});

// Test endpoint for å verifisere at ruten fungerer
router.get('/test', (req, res) => {
  console.log('✅ [INSTRUCTIONS] Test endpoint reached');
  res.json({ 
    message: 'Checklist-instructions route is working!',
    tenantId: req.tenantId || req.session?.tenantId || 'airtech',
    timestamp: new Date().toISOString()
  });
});

// GET instruksjoner for et spesifikt sjekkliste-element
router.get('/:templateName/:itemId', async (req, res) => {
  try {
    const { templateName, itemId } = req.params;
    
    // Forbedret tenant-håndtering for både lokal og cloud
    let tenantId = req.tenantId || req.session?.tenantId || 'airtech';
    
    console.log('🔍 [INSTRUCTIONS] GET request:', {
      templateName,
      itemId,
      tenantId,
      sessionExists: !!req.session,
      sessionTenantId: req.session?.tenantId
    });
    
    const pool = await db.getTenantConnection(tenantId);
    
    const result = await pool.query(
      'SELECT instruction_text FROM checklist_instructions WHERE checklist_item_id = $1 AND template_name = $2',
      [itemId, templateName]
    );
    
    console.log('📊 [INSTRUCTIONS] Query result:', {
      rowCount: result.rows.length,
      templateName,
      itemId
    });
    
    if (result.rows.length === 0) {
      console.log('❌ [INSTRUCTIONS] Instruction not found');
      return res.status(404).json({ error: 'Instruksjon ikke funnet' });
    }
    
    console.log('✅ [INSTRUCTIONS] Instruction found');
    res.json({ instruction: result.rows[0].instruction_text });
    
  } catch (error) {
    console.error('❌ [INSTRUCTIONS] Error in GET:', {
      error: error.message,
      stack: error.stack,
      templateName: req.params.templateName,
      itemId: req.params.itemId
    });
    res.status(500).json({ 
      error: 'Server error', 
      details: error.message,
      code: 'GET_INSTRUCTION_ERROR'
    });
  }
});

// GET alle instruksjoner for en template (bulk fetch)
router.get('/:templateName', async (req, res) => {
  try {
    const { templateName } = req.params;
    let tenantId = req.tenantId || req.session?.tenantId || 'airtech';
    
    console.log('📚 [INSTRUCTIONS BULK] Fetching all for template:', templateName);
    
    const pool = await db.getTenantConnection(tenantId);
    
    const result = await pool.query(
      'SELECT checklist_item_id, instruction_text, created_at, updated_at FROM checklist_instructions WHERE template_name = $1 ORDER BY checklist_item_id',
      [templateName]
    );

    // Konverter til object med checklist_item_id som key (for rask frontend lookup)
    const instructions = {};
    result.rows.forEach(row => {
      instructions[row.checklist_item_id] = row.instruction_text;
    });

    console.log('✅ [INSTRUCTIONS] Found instructions:', result.rows.length);
    res.json({ instructions }); // Returnerer object i stedet for array
    
  } catch (error) {
    console.error('❌ [INSTRUCTIONS BULK] Error:', error);
    res.status(500).json({ 
      error: 'Server error', 
      details: error.message 
    });
  }
});

// POST/PUT lagre eller oppdater instruksjon
router.post('/:templateName/:itemId', async (req, res) => {
  try {
    const { templateName, itemId } = req.params;
    const { instructionText } = req.body;
    
    // Forbedret tenant-håndtering
    let tenantId = req.tenantId || req.session?.tenantId || 'airtech';
    
    console.log('💾 [INSTRUCTIONS] POST request:', {
      templateName,
      itemId,
      tenantId,
      hasInstructionText: !!instructionText,
      textLength: instructionText?.length,
      sessionExists: !!req.session
    });
    
    if (!instructionText || instructionText.trim() === '') {
      console.log('❌ [INSTRUCTIONS] Empty instruction text');
      return res.status(400).json({ error: 'Instruksjonstekst er påkrevd' });
    }
    
    const pool = await db.getTenantConnection(tenantId);
    
    // Test database connection først
    await pool.query('SELECT 1');
    console.log('✅ [INSTRUCTIONS] Database connection OK');
    
    // Sjekk om tabellen eksisterer
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'checklist_instructions'
      );
    `);
    
    if (!tableCheck.rows[0].exists) {
      console.error('❌ [INSTRUCTIONS] Table checklist_instructions does not exist!');
      return res.status(500).json({ 
        error: 'Database table missing',
        details: 'checklist_instructions table does not exist'
      });
    }
    
    console.log('✅ [INSTRUCTIONS] Table exists, proceeding with upsert');
    
    // Bruk ON CONFLICT for å håndtere både INSERT og UPDATE
    const result = await pool.query(`
      INSERT INTO checklist_instructions (checklist_item_id, template_name, instruction_text, created_at, updated_at)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (checklist_item_id, template_name)
      DO UPDATE SET 
        instruction_text = EXCLUDED.instruction_text,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [itemId, templateName, instructionText.trim()]);
    
    console.log('✅ [INSTRUCTIONS] Instruction saved:', {
      id: result.rows[0].id,
      templateName,
      itemId,
      wasUpdate: result.rows[0].created_at !== result.rows[0].updated_at
    });
    
    res.json({ 
      success: true, 
      message: 'Instruksjon lagret',
      id: result.rows[0].id
    });
    
  } catch (error) {
    console.error('❌ [INSTRUCTIONS] Error in POST:', {
      error: error.message,
      stack: error.stack,
      templateName: req.params.templateName,
      itemId: req.params.itemId,
      sqlState: error.code
    });
    res.status(500).json({ 
      error: 'Kunne ikke lagre instruksjon', 
      details: error.message,
      code: 'SAVE_INSTRUCTION_ERROR',
      sqlCode: error.code
    });
  }
});

// DELETE slett instruksjon
router.delete('/:templateName/:itemId', async (req, res) => {
  try {
    const { templateName, itemId } = req.params;
    let tenantId = req.tenantId || req.session?.tenantId || 'airtech';
    
    console.log('🗑️ [INSTRUCTIONS] DELETE request:', {
      templateName,
      itemId,
      tenantId
    });
    
    const pool = await db.getTenantConnection(tenantId);
    
    const result = await pool.query(
      'DELETE FROM checklist_instructions WHERE checklist_item_id = $1 AND template_name = $2',
      [itemId, templateName]
    );
    
    console.log('📊 [INSTRUCTIONS] Delete result:', {
      deletedRows: result.rowCount,
      templateName,
      itemId
    });
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Instruksjon ikke funnet' });
    }
    
    console.log('✅ [INSTRUCTIONS] Instruction deleted');
    res.json({ success: true, message: 'Instruksjon slettet' });
    
  } catch (error) {
    console.error('❌ [INSTRUCTIONS] Error in DELETE:', {
      error: error.message,
      templateName: req.params.templateName,
      itemId: req.params.itemId
    });
    res.status(500).json({ 
      error: 'Kunne ikke slette instruksjon',
      details: error.message 
    });
  }
});

// Error handler for this router
router.use((error, req, res, next) => {
  console.error('❌ [INSTRUCTIONS] Unhandled error:', {
    error: error.message,
    stack: error.stack,
    method: req.method,
    path: req.path
  });
  
  res.status(500).json({
    error: 'Internal server error in checklist-instructions',
    details: error.message
  });
});

console.log('✅ [INSTRUCTIONS] Route module loaded successfully');

module.exports = router;

// ==============================================
// TESTING GUIDE
// ==============================================

/*
Etter å ha oppdatert filen, test følgende:

1. Restart serveren og sjekk logs for:
   "✅ [INSTRUCTIONS] Route module loaded successfully"

2. Test direkte i nettleseren:
   http://localhost:3000/api/checklist-instructions/test
   Skal gi JSON response med "route is working"

3. Test GET (skal gi 404 men ikke "Cannot GET"):
   http://localhost:3000/api/checklist-instructions/Boligventilasjon/item1

4. Test POST i Postman/curl:
   POST http://localhost:3000/api/checklist-instructions/Boligventilasjon/item1
   Headers: Content-Type: application/json
   Body: {"instructionText": "Test instruksjon"}

5. Sjekk alle console logs som starter med "[INSTRUCTIONS]"

Dette vil hjelpe oss identifisere hvor problemet ligger.
*/