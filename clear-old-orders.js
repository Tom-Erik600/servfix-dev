// clear-old-orders.js - Fjern alle gamle ordre fra database

const fs = require('fs').promises;

async function clearOldOrders() {
    console.log('🧹 Rydder opp - fjerner alle gamle ordre...\n');
    
    try {
        const dbPath = './database/database.json';
        
        // Les eksisterende database
        const dbContent = await fs.readFile(dbPath, 'utf8');
        const dbData = JSON.parse(dbContent);
        
        // Tell ordre før sletting
        const orderCount = dbData.orders ? dbData.orders.length : 0;
        console.log(`📋 Fant ${orderCount} gamle ordre i database`);
        
        if (orderCount === 0) {
            console.log('✅ Database er allerede tom for ordre!');
            return;
        }
        
        // Lag backup først
        await fs.writeFile(`${dbPath}.backup-${Date.now()}`, dbContent);
        console.log('💾 Backup lagret med timestamp');
        
        // Tøm ordre-array men behold alt annet
        dbData.orders = [];
        
        // Lagre oppdatert database
        await fs.writeFile(dbPath, JSON.stringify(dbData, null, 2));
        
        console.log(`✅ Fjernet ${orderCount} gamle ordre`);
        console.log('📦 Beholdt:');
        console.log(`   - ${dbData.technicians?.length || 0} teknikere`);
        console.log(`   - ${dbData.equipment?.length || 0} utstyr`);
        console.log(`   - ${dbData.quotes?.length || 0} tilbud`);
        console.log(`   - ${dbData.serviceReports?.length || 0} servicerapporter`);
        
        console.log('\n🎉 FERDIG! Database er klar for nye ordre');
        console.log('\n📝 Neste steg:');
        console.log('1. npm start           # Restart server');
        console.log('2. Gå til planlegger   # Skal nå vise 0 ordre');
        console.log('3. Huk av filter       # Test Tripletex-kunder');
        console.log('4. Opprett nytt oppdrag # Bruker automatisk riktige Tripletex ID-er');
        
        console.log('\n✅ Nye ordre vil automatisk bruke riktige Tripletex kunde-IDer!');
        
    } catch (error) {
        console.error('❌ Feil ved sletting av ordre:', error.message);
        console.log('\n🔧 MANUELL LØSNING:');
        console.log('1. Åpne database/database.json');
        console.log('2. Finn "orders": [...]');
        console.log('3. Endre til "orders": []');
        console.log('4. Lagre fil');
    }
}

// Kjør automatisk
if (require.main === module) {
    clearOldOrders();
}

module.exports = clearOldOrders;