require('dotenv').config();
const { Pool } = require('pg');

async function insertChecklistTemplate() {
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: 'airtech_db' // Assuming this is the tenant database
  });

  try {
    const templateName = 'Standard Ventilasjon';
    const equipmentType = 'ventilation';
    const templateData = {
      checklistItems: [
        { id: 'item1', text: 'Sjekk filter', completed: false },
        { id: 'item2', text: 'Rengjør vifter', completed: false },
        { id: 'item3', text: 'Kontroller motor', completed: false }
      ]
    };

    const result = await pool.query(
      `INSERT INTO checklist_templates (name, equipment_type, template_data)
       VALUES ($1, $2, $3)
       ON CONFLICT (name) DO UPDATE SET equipment_type = $2, template_data = $3
       RETURNING *`,
      [templateName, equipmentType, templateData]
    );

    console.log('✅ Sjekklistemal opprettet/oppdatert:', result.rows[0]);

  } catch (error) {
    console.error('❌ Feil ved innsetting av sjekklistemal:', error);
  } finally {
    await pool.end();
  }
}

insertChecklistTemplate();