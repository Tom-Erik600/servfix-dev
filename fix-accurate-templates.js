// fix-accurate-templates.js - Basert på faktiske PDF-maler
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'database', 'database.json');

console.log('🔧 Oppdaterer templates basert på faktiske PDF-maler...');

try {
    const dbData = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    
    // RIKTIGE TEMPLATES basert på PDF-ene
    const templates = [
        {
            id: "checklist_boligventilasjon",
            name: "Sjekkliste Boligventilasjon",
            equipmentType: "boligventilasjon",
            items: [
                { id: "funksjonskontroll", label: "Funksjonskontroll", type: "select", options: ["OK", "Avvik"] },
                { id: "vifter", label: "Vifter", type: "select", options: ["OK", "Avvik"] },
                { id: "varmegjenvinner", label: "Varmegjenvinner", type: "select", options: ["OK", "Avvik"] },
                { id: "varme", label: "Varme", type: "select", options: ["OK", "Avvik"] },
                { id: "filter", label: "Filter", type: "select", options: ["OK", "Avvik", "Byttet"] }
            ]
        },
        {
            id: "checklist_vifter", 
            name: "Sjekkliste Ventilasjonsvifter",
            equipmentType: "vifter",
            items: [
                { id: "funksjonskontroll", label: "Funksjonskontroll", type: "select", options: ["OK", "Avvik"] },
                { id: "frekvensomformer", label: "Frekvensomformer", type: "select", options: ["OK", "Avvik"] },
                { id: "motor", label: "Motor", type: "select", options: ["OK", "Avvik"] },
                { id: "regulering_styring", label: "Reg./styring", type: "select", options: ["OK", "Avvik"] },
                { id: "viftehjul", label: "Viftehjul", type: "select", options: ["OK", "Avvik"] },
                { id: "varme", label: "Varme", type: "select", options: ["OK", "Avvik"] },
                { id: "filter_reimer", label: "Filter/reimer", type: "select", options: ["OK", "Avvik", "Byttet"] }
            ]
        },
        {
            id: "checklist_ventilasjon",
            name: "Sjekkliste Ventilasjonsaggregat", 
            equipmentType: "ventilasjonsaggregat",
            items: [
                // Hovedkomponenter 1-15
                { id: "pkt1", label: "Luftinntak / Rister", type: "select", options: ["Normal", "Slitasje", "Reparasjon", "Justert", "Byttet", "Smurt", "Defekt"] },
                { id: "pkt2", label: "Spjeld", type: "select", options: ["Normal", "Slitasje", "Reparasjon", "Justert", "Byttet", "Smurt", "Defekt"] },
                { id: "pkt3", label: "Roterende varmegjenvinner", type: "select", options: ["Normal", "Slitasje", "Reparasjon", "Justert", "Byttet", "Smurt", "Defekt"] },
                { id: "pkt4", label: "Varmebatteri vann", type: "select", options: ["Normal", "Slitasje", "Reparasjon", "Justert", "Byttet", "Smurt", "Defekt"] },
                { id: "pkt5", label: "Kjølebatteri isvann", type: "select", options: ["Normal", "Slitasje", "Reparasjon", "Justert", "Byttet", "Smurt", "Defekt"] },
                { id: "pkt6", label: "Tilluftsvifte kilerem", type: "select", options: ["Normal", "Slitasje", "Reparasjon", "Justert", "Byttet", "Smurt", "Defekt"] },
                { id: "pkt7", label: "Avtrekksvifte kilerem", type: "select", options: ["Normal", "Slitasje", "Reparasjon", "Justert", "Byttet", "Smurt", "Defekt"] },
                { id: "pkt8", label: "Termostat – Brann", type: "select", options: ["Normal", "Slitasje", "Reparasjon", "Justert", "Byttet", "Smurt", "Defekt"] },
                { id: "pkt9", label: "Vannlås / Avløp", type: "select", options: ["Normal", "Slitasje", "Reparasjon", "Justert", "Byttet", "Smurt", "Defekt"] },
                { id: "pkt10", label: "Pumper", type: "select", options: ["Normal", "Slitasje", "Reparasjon", "Justert", "Byttet", "Smurt", "Defekt"] },
                { id: "pkt11", label: "Motorventiler", type: "select", options: ["Normal", "Slitasje", "Reparasjon", "Justert", "Byttet", "Smurt", "Defekt"] },
                { id: "pkt12", label: "Spjeldmotorer", type: "select", options: ["Normal", "Slitasje", "Reparasjon", "Justert", "Byttet", "Smurt", "Defekt"] },
                { id: "pkt13", label: "Følere", type: "select", options: ["Normal", "Slitasje", "Reparasjon", "Justert", "Byttet", "Smurt", "Defekt"] },
                { id: "pkt14", label: "Tavleskap", type: "select", options: ["Normal", "Slitasje", "Reparasjon", "Justert", "Byttet", "Smurt", "Defekt"] },
                { id: "pkt15", label: "Trinnkobler", type: "select", options: ["Normal", "Slitasje", "Reparasjon", "Justert", "Byttet", "Smurt", "Defekt"] },
                
                // Funksjonstester 16-26
                { id: "pkt16", label: "Frostsikring", type: "select", options: ["Normal", "Slitasje", "Reparasjon", "Justert", "Byttet", "Smurt", "Defekt"] },
                { id: "pkt17", label: "Trykkstyring", type: "select", options: ["Normal", "Slitasje", "Reparasjon", "Justert", "Byttet", "Smurt", "Defekt"] },
                { id: "pkt18", label: "Regulator / undersentr.", type: "select", options: ["Normal", "Slitasje", "Reparasjon", "Justert", "Byttet", "Smurt", "Defekt"] },
                { id: "pkt19", label: "Start / stopp funksjon", type: "select", options: ["Normal", "Slitasje", "Reparasjon", "Justert", "Byttet", "Smurt", "Defekt"] },
                { id: "pkt20", label: "Alarmsignal", type: "select", options: ["Normal", "Slitasje", "Reparasjon", "Justert", "Byttet", "Smurt", "Defekt"] },
                { id: "pkt21", label: "Stabilitet", type: "select", options: ["Normal", "Slitasje", "Reparasjon", "Justert", "Byttet", "Smurt", "Defekt"] },
                
                // Spesielle felt
                { id: "pkt22", label: "Innstilling brytere", type: "select", options: ["AUTO", "Sommer", "Vinter", "AV", "PÅ"] },
                { id: "pkt23", label: "Tilluft starttrykkfall", type: "select", options: ["Normal", "Slitasje", "Reparasjon", "Justert", "Byttet", "Smurt", "Defekt"] },
                { id: "pkt24", label: "Avtrekk starttrykkfall", type: "select", options: ["Normal", "Slitasje", "Reparasjon", "Justert", "Byttet", "Smurt", "Defekt"] },
                { id: "pkt25", label: "Rengjøring aggregat", type: "select", options: ["Normal", "Slitasje", "Reparasjon", "Justert", "Byttet", "Smurt", "Defekt"] },
                { id: "pkt26", label: "Rengjøring teknisk rom", type: "select", options: ["Normal", "Slitasje", "Reparasjon", "Justert", "Byttet", "Smurt", "Defekt"] },
                
                // Temperaturmålinger
                { id: "temp_ute", label: "T1 - Temp Ute (°C)", type: "number" },
                { id: "temp_for_gjenvinner", label: "T2 - Temp før gjenvinner (°C)", type: "number" },
                { id: "temp_etter_gjenvinner", label: "T3 - Temp etter gjenvinner (°C)", type: "number" },
                { id: "temp_etter_varmebatteri", label: "T4 - Temp etter varmebatteri (°C)", type: "number" },
                { id: "temp_etter_kjolebatteri", label: "T5 - Temp etter kjølebatteri (°C)", type: "number" },
                { id: "temp_tilluft", label: "T6 - Temp Tilluft (°C)", type: "number" },
                { id: "temp_avtrekk_rom", label: "T7 - Temp Avtrekk / Rom (°C)", type: "number" },
                { id: "temp_avkast", label: "T8 - Temp Avkast (°C)", type: "number" },
                { id: "temp_tur_retur_hetvann", label: "T9 - Temp tur/retur hetvann (°C)", type: "number" },
                { id: "temp_tur_retur_isvann", label: "T10 - Temp tur/retur isvann (°C)", type: "number" },
                
                // Virkningsgrad
                { id: "virkningsgrad_gjenvinner", label: "V1 - Virkningsgrad gjenvinner (%)", type: "number" }
            ]
        },
        {
            id: "checklist_ventilasjon",
            name: "Sjekkliste Ventilasjon (Generell)",
            equipmentType: "ventilasjon", 
            items: [
                { id: "funksjonskontroll", label: "Funksjonskontroll", type: "select", options: ["OK", "Avvik"] },
                { id: "vifter", label: "Vifter", type: "select", options: ["OK", "Avvik"] },
                { id: "filter", label: "Filter", type: "select", options: ["OK", "Byttet", "Avvik"] },
                { id: "styring", label: "Styring", type: "select", options: ["OK", "Avvik"] }
            ]
        },
        {
            id: "checklist_custom",
            name: "Fritekst Rapport",
            equipmentType: "custom",
            items: [
                { id: "rapport_kommentar", label: "Rapport og kommentarer", type: "textarea" },
                { id: "bildeopplasting", label: "Bilder", type: "image" }
            ]
        }
    ];
    
    // Oppdater database
    dbData.checklistTemplates = templates;
    fs.writeFileSync(DB_PATH, JSON.stringify(dbData, null, 2));
    
    console.log('✅ Templates oppdatert basert på faktiske PDF-maler!');
    console.log('\n📋 Oppdaterte templates:');
    
    templates.forEach(t => {
        console.log(`\n🔧 ${t.name} (${t.equipmentType}):`);
        console.log(`   - ${t.items.length} sjekkpunkter`);
        
        if (t.equipmentType === 'ventilasjonsaggregat') {
            console.log('   - Inkluderer N/S/R/J/B/Sm/D statuser');
            console.log('   - 10 temperaturmålinger (T1-T10)');
            console.log('   - Virkningsgrad-måling');
        }
        
        if (t.equipmentType === 'vifter') {
            console.log('   - Multi-komponent støtte');
            console.log('   - 7 sjekkpunkter per vifte');
        }
    });
    
} catch (error) {
    console.error('❌ Feil:', error.message);
    process.exit(1);
}
