// init-quotes.js - Kjør denne filen for å initialisere quotes i database.json
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'database', 'database.json');

console.log('🔧 Initialiserer tilbud-funksjonalitet i database...');

try {
    // Les eksisterende database
    const dbData = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    
    // Legg til quotes array hvis det ikke eksisterer
    if (!dbData.quotes) {
        dbData.quotes = [];
        console.log('✅ Lagt til quotes array i database');
    } else {
        console.log('ℹ️ Quotes array eksisterer allerede');
    }
    
    // Skriv tilbake til database
    fs.writeFileSync(DB_PATH, JSON.stringify(dbData, null, 2));
    
    console.log('✅ Database oppdatert for tilbud-funksjonalitet!');
    console.log('\n📋 For å teste tilbud-systemet:');
    console.log('1. Start serveren: npm start');
    console.log('2. Gå til en ordre i tekniker-appen');
    console.log('3. Trykk "+ Opprett tilbud"');
    console.log('4. Fyll ut og send til admin');
    console.log('5. Sjekk admin-siden under /admin/tilbud.html');
    
} catch (error) {
    console.error('❌ Feil:', error.message);
    process.exit(1);
}