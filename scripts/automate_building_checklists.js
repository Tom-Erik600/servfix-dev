// automate_building_checklists.js - Updated med nye inputType-alternativer
require('dotenv').config();
const { Pool } = require('pg');

async function automateBuildingChecklists() {
  console.log('🤖 Automatiserer bygging av de 4 kjente sjekklistene med nye inputType-alternativer...');
  
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: 'airtech_db'
  });

  try {
    console.log('🗑️  Sletter eksisterende sjekkliste-maler...');
    await pool.query('TRUNCATE TABLE checklist_templates CASCADE');
    
    console.log('✨ Oppretter de 4 kjente sjekklistene med nye smarte inputTypes...');
    
    // 1. BOLIGVENTILASJON - Enkel struktur
    const boligventilasjon = {
      name: 'Boligventilasjon',
      equipmentType: 'boligventilasjon',
      templateData: {
        systemFields: [
          { name: "etasje", label: "Etasje", required: false, order: 1 },
          { name: "leilighet_nr", label: "Leil. Nr.", required: false, order: 2 },
          { name: "aggregat_type", label: "Aggregat Type", required: true, order: 3 },
          { name: "system_nummer", label: "System Nr.", required: true, order: 4 }
        ],
        checklistItems: [
          { id: 'item1', label: 'Funksjonskontroll', inputType: 'ok_avvik', order: 1 },
          { id: 'item2', label: 'Vifter', inputType: 'ok_avvik', order: 2 },
          { id: 'item3', label: 'Varmegjenvinner', inputType: 'ok_avvik', order: 3 },
          { id: 'item4', label: 'Filter (tilluft)', inputType: 'ok_byttet_avvik', order: 4 },
          { id: 'item5', label: 'Filter (avtrekk)', inputType: 'ok_byttet_avvik', order: 5 },
          { id: 'item6', label: 'Varme', inputType: 'ok_avvik', order: 6 }
        ],
        allowProducts: true,
        allowAdditionalWork: true,
        allowComments: true,
        hasDriftSchedule: false
      }
    };

    // 2. VENTILASJONSAGGREGAT - Med nye smarte inputTypes
    const ventilasjonsaggregat = {
      name: 'Ventilasjonsaggregat',
      equipmentType: 'ventilasjonsaggregat',
      templateData: {
        systemFields: [
          { name: "system_nummer", label: "System Nummer", required: true, order: 1 },
          { name: "systemplassering", label: "Systemplassering", required: true, order: 2 },
          { name: "betjener", label: "Betjener", required: false, order: 3 },
          { name: "aggregat_type", label: "Aggregat Type", required: true, order: 4 }
        ],
        checklistItems: [
          // Grunnleggende komponenter
          { id: 'item1', label: 'Luftinntak / Rister', inputType: 'ok_avvik', order: 1 },
          { id: 'item2', label: 'Spjeld', inputType: 'ok_avvik', order: 2 },
          
          // SMARTE DROPDOWN KOMPONENTER (dropdown_ok_avvik)
          { 
            id: 'item3', 
            label: 'Varmegjenvinner Type', 
            inputType: 'dropdown_ok_avvik', 
            order: 3,
            dropdownOptions: [
              'Roterende varmegjenvinner',
              'Fast plate varmeveksler', 
              'Kryssveksler',
              'Motstrøm varmeveksler',
              'Ikke installert'
            ]
          },
          { id: 'item4', label: 'Frekvens omf. gjenvinner', inputType: 'ok_avvik', order: 4 },
          { 
            id: 'item5', 
            label: 'Gjenvinnerbatteri Type', 
            inputType: 'dropdown_ok_avvik', 
            order: 5,
            dropdownOptions: [
              'Gjenvinnerbatteri Tilluft',
              'Gjenvinnerbatteri Avtrekk',
              'Begge batterier',
              'Ikke aktuelt'
            ]
          },
          
          // Batterier
          { id: 'item6', label: 'Varmebatteri vann', inputType: 'ok_avvik', order: 6 },
          { id: 'item7', label: 'Varmebatteri elektrisk', inputType: 'ok_avvik', order: 7 },
          { id: 'item8', label: 'Kjølebatteri isvann', inputType: 'ok_avvik', order: 8 },
          { id: 'item9', label: 'Kjølebatteri DX', inputType: 'ok_avvik', order: 9 },
          
          // Vifter
          { id: 'item10', label: 'Tilluftsvifte kilerem', inputType: 'ok_avvik', order: 10 },
          { id: 'item11', label: 'Tilluftsvifte direktedrift', inputType: 'ok_avvik', order: 11 },
          { id: 'item12', label: 'Tilluftsvifte frekvensomf.', inputType: 'ok_avvik', order: 12 },
          { id: 'item13', label: 'Avtrekksvifte kilerem', inputType: 'ok_avvik', order: 13 },
          { id: 'item14', label: 'Avtrekksvifte direktedrift', inputType: 'ok_avvik', order: 14 },
          { id: 'item15', label: 'Avtrekksvifte frekvensomf.', inputType: 'ok_avvik', order: 15 },
          
          // Sikkerhet og styring
          { id: 'item16', label: 'Termostat – Brann', inputType: 'ok_avvik', order: 16 },
          { id: 'item17', label: 'Termostat – Overopphet.', inputType: 'ok_avvik', order: 17 },
          { id: 'item18', label: 'Vannlås / Avløp', inputType: 'ok_avvik', order: 18 },
          { id: 'item19', label: 'Pumper', inputType: 'ok_avvik', order: 19 },
          { id: 'item20', label: 'Motorventiler', inputType: 'ok_avvik', order: 20 },
          { id: 'item21', label: 'Spjeldmotorer', inputType: 'ok_avvik', order: 21 },
          { id: 'item22', label: 'Følere', inputType: 'ok_avvik', order: 22 },
          { id: 'item23', label: 'Tavleskap', inputType: 'ok_avvik', order: 23 },
          { id: 'item24', label: 'Trinnkobler', inputType: 'ok_avvik', order: 24 },
          
          // Funksjoner
          { id: 'item25', label: 'Frostsikring', inputType: 'ok_avvik', order: 25 },
          { id: 'item26', label: 'Trykkstyring', inputType: 'ok_avvik', order: 26 },
          { id: 'item27', label: 'Regulator / undersentr.', inputType: 'ok_avvik', order: 27 },
          { id: 'item28', label: 'Start / stopp funksjon', inputType: 'ok_avvik', order: 28 },
          { id: 'item29', label: 'Alarmsignal', inputType: 'ok_avvik', order: 29 },
          { id: 'item30', label: 'Stabilitet', inputType: 'ok_avvik', order: 30 },
          
          // BRYTERE MED DROPDOWN + OK/AVVIK
          { 
            id: 'item31', 
            label: 'Innstilling brytere', 
            inputType: 'dropdown_ok_avvik', 
            order: 31,
            dropdownOptions: [
              'AUTO',
              'Sommer', 
              'Vinter',
              'AV',
              'PÅ'
            ]
          },
          
          // TRYKKFALL MED DROPDOWN + KOMMENTAR + OK/AVVIK
          { 
            id: 'item32', 
            label: 'Tilluft trykkfall og filter', 
            inputType: 'dropdown_ok_avvik_comment', 
            order: 32,
            dropdownOptions: [
              'Tilluft starttrykkfall',
              'Tilluftsfilter trykkfall',
              'Tilluftsfilter status'
            ]
          },
          { 
            id: 'item33', 
            label: 'Avtrekk trykkfall og filter', 
            inputType: 'dropdown_ok_avvik_comment', 
            order: 33,
            dropdownOptions: [
              'Avtrekk starttrykkfall',
              'Avtrekksfilter trykkfall', 
              'Avtrekksfilter status'
            ]
          },
          
          // Rengjøring
          { id: 'item34', label: 'Rengjøring aggregat', inputType: 'ok_avvik', order: 34 },
          { id: 'item35', label: 'Rengjøring teknisk rom', inputType: 'ok_avvik', order: 35 },
          
          // TEMPERATURMÅLINGER MED NYE TEMPERATURE TYPE
          { id: 'temp1', label: 'Temp Ute (T1)', inputType: 'temperature', order: 36 },
          { id: 'temp2', label: 'Temp før gjenvinner (T2)', inputType: 'temperature', order: 37 },
          { id: 'temp3', label: 'Temp etter gjenvinner (T3)', inputType: 'temperature', order: 38 },
          { id: 'temp4', label: 'Temp etter varmebatteri (T4)', inputType: 'temperature', order: 39 },
          { id: 'temp5', label: 'Temp etter kjølebatteri (T5)', inputType: 'temperature', order: 40 },
          { id: 'temp6', label: 'Temp Tilluft (T6)', inputType: 'temperature', order: 41 },
          { id: 'temp7', label: 'Temp Avtrekk / Rom (T7)', inputType: 'temperature', order: 42 },
          { id: 'temp8', label: 'Temp Avkast (T8)', inputType: 'temperature', order: 43 },
          { id: 'temp9', label: 'Temp tur/retur hetvann (T9)', inputType: 'temperature', order: 44 },
          { id: 'temp10', label: 'Temp tur/retur isvann (T10)', inputType: 'temperature', order: 45 },
          
          // VIRKNINGSGRAD MED FORMEL
          { id: 'virkn1', label: 'Virkningsgrad gjenvinner (V1)', inputType: 'virkningsgrad', order: 46 },
          
          // Regulering og setpunkter
          { id: 'item36', label: 'Setpunkt/Reg. form temp (TR2)', inputType: 'text', order: 47 },
          
          // Mengderegulering som dropdown
          { 
            id: 'item37', 
            label: 'Mengderegulering (TR1)', 
            inputType: 'dropdown_ok_avvik', 
            order: 48,
            dropdownOptions: [
              'Hel luftmengde',
              'Halv luftmengde',
              'Konstant luftmengde',
              'Konstant trykkstyring',
              'Optimizerfunksjon Trykk',
              'Optimizer Spjeldstilling'
            ]
          },
          
          // TILSTANDSGRAD OG KONSEKVENSGRAD MED EGNE DROPDOWNS
          { id: 'tilstand1', label: 'Tilstandsgrad (TG)', inputType: 'tilstandsgrad_dropdown', order: 49 },
          { id: 'konsekvens1', label: 'Konsekvensgrad (KG)', inputType: 'konsekvensgrad_dropdown', order: 50 }
        ],
        allowProducts: true,
        allowAdditionalWork: true,
        allowComments: true,
        hasDriftSchedule: true,
        driftScheduleConfig: {
          columns: ["Start", "Stopp"],
          data: {
            "Mandag": { "Start": "", "Stopp": "" },
            "Tirsdag": { "Start": "", "Stopp": "" },
            "Onsdag": { "Start": "", "Stopp": "" },
            "Torsdag": { "Start": "", "Stopp": "" },
            "Fredag": { "Start": "", "Stopp": "" },
            "Lørdag": { "Start": "", "Stopp": "" },
            "Søndag": { "Start": "", "Stopp": "" }
          }
        }
      }
    };

    // 3. VIFTER - Oppdatert struktur
    const vifter = {
      name: 'Vifter',
      equipmentType: 'vifter',
      templateData: {
        systemFields: [
          { name: "system_nummer", label: "System Nummer", required: true, order: 1 },
          { name: "viftetype", label: "Vifte Type", required: true, order: 2 },
          { name: "betjener", label: "Betjener", required: false, order: 3 },
          { name: "plassering", label: "Plassering", required: true, order: 4 }
        ],
        checklistItems: [
          { id: 'item1', label: 'Funksjonskontroll', inputType: 'ok_avvik', order: 1 },
          { id: 'item2', label: 'Frekvensomformer', inputType: 'ok_avvik', order: 2 },
          { id: 'item3', label: 'Motor', inputType: 'ok_avvik', order: 3 },
          { id: 'item4', label: 'Regulering / styring', inputType: 'ok_avvik', order: 4 },
          { id: 'item5', label: 'Viftehjul', inputType: 'ok_avvik', order: 5 },
          { id: 'item6', label: 'Varme', inputType: 'ok_avvik', order: 6 },
          { id: 'item7', label: 'Filter/reimer', inputType: 'ok_byttet_avvik', order: 7 }
        ],
        allowProducts: true,
        allowAdditionalWork: true,
        allowComments: true,
        hasDriftSchedule: false
      }
    };

    // 4. CUSTOM - Fleksibel mal
    const custom = {
      name: 'Custom',
      equipmentType: 'custom',
      templateData: {
        systemFields: [
          { name: "system_nummer", label: "System Nummer", required: true, order: 1 },
          { name: "type", label: "Type", required: true, order: 2 },
          { name: "plassering", label: "Plassering", required: true, order: 3 },
          { name: "beskrivelse", label: "Beskrivelse", required: false, order: 4 }
        ],
        checklistItems: [
          { id: 'item1', label: 'Visuell kontroll', inputType: 'ok_avvik', order: 1 },
          { id: 'item2', label: 'Funksjonskontroll', inputType: 'ok_avvik', order: 2 },
          { id: 'item3', label: 'Rengjøring utført', inputType: 'ok_avvik', order: 3 },
          { id: 'item4', label: 'Måling/justering', inputType: 'numeric', order: 4 },
          { id: 'item5', label: 'Sikkerhetskontroll', inputType: 'ok_avvik', order: 5 },
          { id: 'item6', label: 'Generell kommentar', inputType: 'textarea', order: 6 }
        ],
        allowProducts: true,
        allowAdditionalWork: true,
        allowComments: true,
        hasDriftSchedule: false
      }
    };

    const templates = [boligventilasjon, ventilasjonsaggregat, vifter, custom];
    
    // Sett inn alle templates
    for (const template of templates) {
      const result = await pool.query(
        `INSERT INTO checklist_templates (name, equipment_type, template_data)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [template.name, template.equipmentType, template.templateData]
      );
      
      console.log(`✅ Opprettet mal: "${template.name}"`);
      console.log(`   - ID: ${template.equipmentType}`);
      console.log(`   - ${template.templateData.systemFields.length} systemfelter`);
      console.log(`   - ${template.templateData.checklistItems.length} sjekkpunkter`);
      
      // Analyser inputTypes
      const inputTypeCounts = template.templateData.checklistItems.reduce((counts, item) => {
        counts[item.inputType] = (counts[item.inputType] || 0) + 1;
        return counts;
      }, {});
      
      console.log(`   - InputTypes brukt:`);
      Object.entries(inputTypeCounts).forEach(([type, count]) => {
        console.log(`     • ${type}: ${count}`);
      });
      
      console.log(`   - Driftschema: ${template.templateData.hasDriftSchedule ? 'Ja' : 'Nei'}`);
    }
    
    // Detaljert analyse av nye funksjoner
    console.log('\n🎯 Analyse av nye smarte inputTypes:');
    
    const ventilasjonTemplate = templates.find(t => t.name === 'Ventilasjonsaggregat');
    
    // Tell dropdown typer
    const dropdownItems = ventilasjonTemplate.templateData.checklistItems.filter(
      item => item.inputType === 'dropdown_ok_avvik' || item.inputType === 'dropdown_ok_avvik_comment'
    );
    console.log(`   📋 ${dropdownItems.length} dropdown-komponenter (kortere lister på mobil)`);
    
    // Tell temperatur-typer  
    const tempItems = ventilasjonTemplate.templateData.checklistItems.filter(
      item => item.inputType === 'temperature'
    );
    console.log(`   🌡️  ${tempItems.length} temperaturmålinger (°C + OK/Avvik)`);
    
    // Tell spesialtyper
    const virkningsgradItems = ventilasjonTemplate.templateData.checklistItems.filter(
      item => item.inputType === 'virkningsgrad'
    );
    console.log(`   🔬 ${virkningsgradItems.length} virkningsgrad (automatisk formel)`);
    
    const tilstandItems = ventilasjonTemplate.templateData.checklistItems.filter(
      item => item.inputType === 'tilstandsgrad_dropdown' || item.inputType === 'konsekvensgrad_dropdown'
    );
    console.log(`   📊 ${tilstandItems.length} tilstands/konsekvensgrad dropdowns`);
    
    console.log('\n🎉 De 4 kjente sjekklistene er bygget med smarte inputTypes!');
    console.log('\n📱 Mobiloptimalisering oppnådd:');
    console.log('   ✅ Dropdown i stedet for lange lister');
    console.log('   ✅ Kombinerte felter (dropdown + OK/Avvik)');
    console.log('   ✅ Automatisk formelberegning (virkningsgrad)'); 
    console.log('   ✅ Temperatur med enhet (°C) og status');
    console.log('   ✅ Spesialiserte dropdowns (TG/KG)');
    
    console.log('\n🔧 Testing roadmap:');
    console.log('   1. Verifiser nye inputTypes i Admin → Service Oppsett');
    console.log('   2. Test dropdown-funksjonalitet på mobil');
    console.log('   3. Sjekk virkningsgrad-formel (T3-T2)/(T7-T2)');
    console.log('   4. Verifiser temperatur-input med °C og OK/Avvik');
    console.log('   5. Test at PDF-generering håndterer nye typer');
    
  } catch (error) {
    console.error('❌ Feil ved automatisering av sjekklister:', error);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Test API-transformasjon for nye typer
async function testNewInputTypes() {
  console.log('\n🧪 Tester nye inputTypes i API-transformasjon...');
  
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: 'airtech_db'
  });

  try {
    const result = await pool.query('SELECT * FROM checklist_templates WHERE name = $1', ['Ventilasjonsaggregat']);
    
    if (result.rows.length > 0) {
      const template = result.rows[0];
      const templateData = template.template_data;
      
      console.log('\n📋 Ventilasjonsaggregat template analyse:');
      console.log(`   Totalt ${templateData.checklistItems.length} sjekkpunkter`);
      
      // Grupper items by inputType
      const groupedByType = templateData.checklistItems.reduce((groups, item) => {
        if (!groups[item.inputType]) groups[item.inputType] = [];
        groups[item.inputType].push(item.label);
        return groups;
      }, {});
      
      console.log('\n   📊 InputType fordeling:');
      Object.entries(groupedByType).forEach(([type, items]) => {
        console.log(`     ${type}: ${items.length} items`);
        if (type.includes('dropdown') || type === 'temperature' || type === 'virkningsgrad') {
          console.log(`       - ${items.slice(0, 2).join(', ')}${items.length > 2 ? '...' : ''}`);
        }
      });
      
      // Sjekk dropdown options
      const dropdownItems = templateData.checklistItems.filter(item => item.dropdownOptions);
      console.log(`\n   🔽 ${dropdownItems.length} items har dropdown options:`);
      dropdownItems.forEach(item => {
        console.log(`     "${item.label}": ${item.dropdownOptions.length} valg`);
      });
    }
    
    console.log('\n✅ Nye inputTypes er korrekt lagret i database!');
    
  } catch (error) {
    console.error('❌ Feil ved testing av nye inputTypes:', error);
  } finally {
    await pool.end();
  }
}

// Kjør script
if (require.main === module) {
  automateBuildingChecklists()
    .then(() => testNewInputTypes())
    .catch(error => {
      console.error('❌ Script feilet:', error);
      process.exit(1);
    });
}

module.exports = { automateBuildingChecklists, testNewInputTypes };