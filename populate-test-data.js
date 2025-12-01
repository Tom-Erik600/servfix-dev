// Fil: populate-test-data.js (v3 - Med uplanlagte ordre for planleggeren)
const fs = require('fs');
const path = require('path');
const DB_PATH = path.join(__dirname, 'database', 'database.json');

console.log('🌱 Populating database with test data for planner...');

const getISODate = (daysFromNow = 0) => {
    const date = new Date();
    date.setDate(date.getDate() + daysFromNow);
    return date.toISOString().split('T')[0];
};

const testData = {
    technicians: [
        { "id": "T-01", "name": "Rune Bakken", "initials": "RB", "specialization": "Vent/Kjøl" },
        { "id": "T-02", "name": "Erik Sørensen", "initials": "ES", "specialization": "Vifter/Bolig" }
    ],
    customers: [
        { "id": "C-101", "name": "Oslo Kontorsenter AS", "address": "Storgata 15, 0184 Oslo", "contactPerson": "Lars Hansen", "phone": "22334455" },
        { "id": "C-102", "name": "Bergen Sykehus", "address": "Haukelandsveien 22, 5021 Bergen", "contactPerson": "Mona Andersen", "phone": "55975000" },
        { "id": "C-103", "name": "Akershus Næringspark", "address": "Industriveien 5, 2020 Skedsmokorset", "contactPerson": "Per Olsen", "phone": "63870000" }
    ],
    // Disse ordrene er "uplanlagte" og vil vises i planleggeren
    orders: [
        {
            "id": "PROJ-2025-101",
            "orderNumber": "PROJ-2025-101",
            "customerId": "C-101",
            "description": "Serviceavtale 2025",
            "serviceType": "Ventilasjon",
            "status": "pending", // Status for uskedulert
            "technicianId": null,
            "scheduledDate": null,
            "scheduledTime": null
        },
        {
            "id": "PROJ-2025-102",
            "orderNumber": "PROJ-2025-102",
            "customerId": "C-102",
            "description": "Hovedservice Vifter",
            "serviceType": "Vifter",
            "status": "pending",
            "technicianId": null,
            "scheduledDate": null,
            "scheduledTime": null
        },
        {
            "id": "PROJ-2025-103",
            "orderNumber": "PROJ-2025-103",
            "customerId": "C-103",
            "description": "Kontroll av boligventilasjon",
            "serviceType": "Boligventilasjon",
            "status": "pending",
            "technicianId": null,
            "scheduledDate": null,
            "scheduledTime": null
        }
    ],
    equipment: [],
    checklistTemplates: [], // La disse være tomme for nå for å unngå feil
    serviceReports: [],
    settings: {}
};

try {
    fs.writeFileSync(DB_PATH, JSON.stringify(testData, null, 2));
    console.log('✅ Database successfully populated with new data.');
} catch (error) {
    console.error('❌ Error writing to database file:', error);
}