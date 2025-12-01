// database/init-database.js (v3 - Komplett sjekkliste for ventilasjon)

const AirTechDatabase = require('./database-api');
const fs = require('fs').promises;
const path = require('path');

async function initializeDatabase() {
    console.log('🚀 Initialiserer Air-Tech database med komplette sjekklister...');
    
    try {
        const dbPath = path.join(__dirname, 'database.json');
        const db = new AirTechDatabase(dbPath);

        await db.loadDatabase();
        
        console.log('📋 Erstatter sjekkliste-maler...');

        const templates = [
            {
                id: "checklist_boligventilasjon", name: "Sjekkliste Boligventilasjon", equipmentType: "boligventilasjon",
                items: [
                    { id: "funksjonskontroll", label: "Funksjonskontroll", type: "select", options: ["OK", "Avvik"] },
                    { id: "vifter", label: "Vifter", type: "select", options: ["OK", "Avvik"] },
                    { id: "varmegjenvinner", label: "Varmegjenvinner", type: "select", options: ["OK", "Avvik"] },
                    { id: "varme", label: "Varme", type: "select", options: ["OK", "Avvik"] },
                    { id: "filter", label: "Filter", type: "select", options: ["OK", "Byttet"] }
                ]
            },
            {
                id: "checklist_ventilasjonsaggregat", name: "Sjekkliste Ventilasjonsaggregat", equipmentType: "ventilasjonsaggregat",
                items: [ // KOMPLETT LISTE FRA PDF
                    { id: "pkt1", label: "Luftinntak / Rister", type: "select", options: ["OK", "Avvik"] },
                    { id: "pkt2", label: "Spjeld", type: "select", options: ["OK", "Avvik"] },
                    { id: "pkt3", label: "Roterende varmegjenvinner", type: "select", options: ["OK", "Avvik"] },
                    { id: "pkt4", label: "Gjenvinnerbatteri Avtrekk", type: "select", options: ["OK", "Avvik"] },
                    { id: "pkt5", label: "Kjølebatteri isvann", type: "select", options: ["OK", "Avvik"] },
                    { id: "pkt6", label: "Kjølebatteri DX", type: "select", options: ["OK", "Avvik"] },
                    { id: "pkt7", label: "Avtrekksvifte kilerem", type: "select", options: ["OK", "Avvik"] },
                    { id: "pkt8", label: "Termostat - Brann", type: "select", options: ["OK", "Avvik"] },
                    { id: "pkt9", label: "Vannlås/Avløp", type: "select", options: ["OK", "Avvik"] },
                    { id: "pkt10", label: "Pumper", type: "select", options: ["OK", "Avvik"] },
                    { id: "pkt11", label: "Motorventiler", type: "select", options: ["OK", "Avvik"] },
                    { id: "pkt12", label: "Spjeldmotorer", type: "select", options: ["OK", "Avvik"] },
                    { id: "pkt13", label: "Følere", type: "select", options: ["OK", "Avvik"] },
                    { id: "pkt14", label: "Tavleskap", type: "select", options: ["OK", "Avvik"] },
                    { id: "pkt15", label: "Trinnkobler", type: "select", options: ["OK", "Avvik"] },
                    { id: "pkt16", label: "Frostsikring", type: "select", options: ["OK", "Avvik"] },
                    { id: "pkt17", label: "Trykkstyring", type: "select", options: ["OK", "Avvik"] },
                    { id: "pkt18", label: "Regulator/undersentr.", type: "select", options: ["OK", "Avvik"] },
                    { id: "pkt19", label: "Start/stopp funksjon", type: "select", options: ["OK", "Avvik"] },
                    { id: "pkt20", label: "Alarmsignal", type: "select", options: ["OK", "Avvik"] },
                    { id: "pkt21", label: "Stabilitet", type: "select", options: ["OK", "Avvik"] },
                    { id: "pkt22", label: "Innstilling brytere", type: "select", options: ["AUTO", "Sommer", "Vinter", "AV", "PÅ"] },
                    { id: "pkt23", label: "Tilluftsfilter status", type: "select", options: ["OK", "Byttet", "Avvik"] },
                    { id: "pkt24", label: "Avtrekksfilter status", type: "select", options: ["OK", "Byttet", "Avvik"] },
                    { id: "pkt25", label: "Rengjøring aggregat", type: "select", options: ["OK", "Avvik"] },
                    { id: "pkt26", label: "Rengjøring teknisk rom", type: "select", options: ["OK", "Avvik"] },
                    { id: "temp_ute", label: "Temp Ute (°C)", type: "number" },
                    { id: "temp_tilluft", label: "Temp Tilluft (°C)", type: "number" },
                    { id: "temp_avkast", label: "Temp Avkast (°C)", type: "number" }
                ]
            },
            {
                id: "checklist_vifter", name: "Sjekkliste Vifter", equipmentType: "vifter",
                items: [
                    { id: "funksjonskontroll", label: "Funksjonskontroll", type: "select", options: ["OK", "Avvik"] },
                    { id: "frekvensomformer", label: "Frekvensomformer", type: "select", options: ["OK", "Avvik"] },
                    { id: "motor", label: "Motor", type: "select", options: ["OK", "Avvik"] },
                    { id: "regulering_styring", label: "Regulering/Styring", type: "select", options: ["OK", "Avvik"] },
                    { id: "viftehjul", label: "Viftehjul", type: "select", options: ["OK", "Avvik"] },
                    { id: "filter_reimer", label: "Filter/Reimer", type: "select", options: ["OK", "Byttet", "Avvik"] }
                ]
            },
            {
                id: "checklist_fritekst", name: "Fritekst Rapport", equipmentType: "fritekst",
                items: [ { id: "rapport_kommentar", label: "Rapport og kommentarer", type: "textarea" }, { id: "bildeopplasting", label: "Bilder", type: "image" } ]
            }
        ];
        
        db.data.checklistTemplates = templates;
        await db.saveDatabase();
        
        console.log('\n✅ Database initialisert med suksess!');
        console.log(`📋 ${templates.length} sjekkliste-maler er lagret i ${db.dbPath}`);
        
    } catch (error) {
        console.error('❌ Feil ved initialisering av database:', error);
        process.exit(1);
    }
}

if (require.main === module) {
    initializeDatabase().then(() => {
        console.log('\n🚀 Script fullført!');
        process.exit(0);
    }).catch(error => {
        console.error('💥 Script feilet:', error);
        process.exit(1);
    });
}