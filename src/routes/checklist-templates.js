const express = require('express');
const db = require('../config/database');

const router = express.Router();

// GET all checklist templates
router.get('/', async (req, res) => {
  try {
    const pool = await db.getTenantConnection(req.tenantId || 'airtech');
    const result = await pool.query('SELECT * FROM checklist_templates');
    
    // Transform database format to match frontend expectations
    const facilityTypes = result.rows.map(row => ({
      id: row.name.toLowerCase().replace(/[^a-z0-9]+/g, '_'), // Generate string ID from name
      name: row.name,
      ...row.template_data // Spread all template data (systemFields, checklistItems, etc.)
    }));
    
    res.json({ facilityTypes });
  } catch (error) {
    console.error('Error fetching checklist templates:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST (save) checklist templates
router.post('/', async (req, res) => {
  let pool;
  try {
    const { facilityTypes } = req.body;
    pool = await db.getTenantConnection(req.tenantId || 'airtech');

    // Start a transaction
    await pool.query('BEGIN');

    // Get existing templates to identify deletions
    const existingTemplatesResult = await pool.query('SELECT name FROM checklist_templates');
    const existingTemplateNames = new Set(existingTemplatesResult.rows.map(row => row.name));

    for (const template of facilityTypes) {
      const { id, name, ...templateData } = template;
      
      // Store equipment_type based on the template id
      const equipmentType = id; // Use the string ID as equipment type

      if (existingTemplateNames.has(name)) {
        // Update existing template
        await pool.query(
          'UPDATE checklist_templates SET equipment_type = $1, template_data = $2 WHERE name = $3',
          [equipmentType, templateData, name]
        );
        existingTemplateNames.delete(name); // Mark as processed
      } else {
        // Insert new template
        await pool.query(
          'INSERT INTO checklist_templates (name, equipment_type, template_data) VALUES ($1, $2, $3)',
          [name, equipmentType, templateData]
        );
      }
    }

    // Delete templates that are no longer present in the request
    for (const nameToDelete of existingTemplateNames) {
      await pool.query('DELETE FROM checklist_templates WHERE name = $1', [nameToDelete]);
    }

    await pool.query('COMMIT');
    res.status(200).json({ message: 'Checklist templates saved successfully' });
  } catch (error) {
    if (pool) {
      await pool.query('ROLLBACK');
    }
    console.error('Error saving checklist templates:', error);
    res.status(500).json({ error: 'Failed to save checklist templates' });
  }
});

module.exports = router;