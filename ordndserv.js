// reset-orders-and-reports.js - Tøm ordre og servicerapporter for å starte på nytt

const fs = require('fs').promises;
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

async function resetOrdersAndReports() {
    console.log('🔄 AIR-TECH RESET SCRIPT');
    console.log('========================\n');
    console.log('Dette scriptet vil:');
    console.log('✓ Tømme alle ordre');
    console.log('✓ Tømme alle servicerapporter');
    console.log('✓ Tømme alt utstyr (anlegg)');
    console.log('✓ Beholde kunder, teknikere og sjekkliste-maler\n');
    
    const confirm = await question('⚠️  Er du SIKKER på at du vil slette all data? (ja/nei): ');
    
    if (confirm.toLowerCase() !== 'ja') {
        console.log('\n❌ Avbrutt - ingen endringer gjort');
        rl.close();
        return;
    }
    
    try {
        const dbPath = './database/database.json';
        
        // Les eksisterende database
        console.log('\n📖 Leser database...');
        const dbContent = await fs.readFile(dbPath, 'utf8');
        const dbData = JSON.parse(dbContent);
        
        // Tell eksisterende data
        const stats = {
            orders: dbData.orders?.length || 0,
            serviceReports: dbData.serviceReports?.length || 0,
            equipment: dbData.equipment?.length || 0,
            quotes: dbData.quotes?.length || 0
        };
        
        console.log(`\n📊 Eksisterende data:`);
        console.log(`   - ${stats.orders} ordre`);
        console.log(`   - ${stats.serviceReports} servicerapporter`);
        console.log(`   - ${stats.equipment} utstyr/anlegg`);
        console.log(`   - ${stats.quotes} tilbud`);
        
        // Lag backup først
        const timestamp = Date.now();
        const backupPath = `${dbPath}.backup-${timestamp}`;
        await fs.writeFile(backupPath, dbContent);
        console.log(`\n💾 Backup lagret: ${backupPath}`);
        
        // Nullstill data
        console.log('\n🧹 Sletter data...');
        dbData.orders = [];
        dbData.serviceReports = [];
        dbData.equipment = [];
        dbData.quotes = [];
        
        // Lagre oppdatert database
        await fs.writeFile(dbPath, JSON.stringify(dbData, null, 2));
        
        console.log('\n✅ FERDIG! Database er nullstilt');
        console.log('\n📦 Beholdt data:');
        console.log(`   - ${dbData.technicians?.length || 0} teknikere`);
        console.log(`   - ${dbData.checklistTemplates?.length || 0} sjekkliste-maler`);
        console.log(`   - Alle innstillinger`);
        
        console.log('\n🎯 Neste steg:');
        console.log('1. Start serveren på nytt: npm start');
        console.log('2. Gå til admin-panelet');
        console.log('3. Opprett nye ordre på kunder');
        console.log('4. Test systemet med ferske data!');
        
        console.log('\n💡 Tips:');
        console.log('- Kunder hentes fortsatt fra Tripletex');
        console.log('- Husk 1-kunde-1-ordre regelen');
        console.log('- Legg til utstyr/anlegg på hver kunde etter behov');
        
        const restore = await question('\n🔧 Vil du gjenopprette fra backup? (ja/nei): ');
        
        if (restore.toLowerCase() === 'ja') {
            console.log('\n⏮️  Gjenoppretter fra backup...');
            const backupContent = await fs.readFile(backupPath, 'utf8');
            await fs.writeFile(dbPath, backupContent);
            console.log('✅ Database gjenopprettet til tidligere tilstand');
        }
        
    } catch (error) {
        console.error('\n❌ Feil:', error.message);
        console.log('\n🔧 Manuell løsning:');
        console.log('1. Åpne database/database.json');
        console.log('2. Sett "orders": []');
        console.log('3. Sett "serviceReports": []');
        console.log('4. Sett "equipment": []');
        console.log('5. Sett "quotes": []');
        console.log('6. Lagre filen');
    } finally {
        rl.close();
    }
}

// Kjør scriptet
resetOrdersAndReports();