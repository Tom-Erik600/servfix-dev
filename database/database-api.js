// database/database-api.js (v2.2 - Komplett med alle nødvendige funksjoner)

const fs = require('fs').promises;
const path = require('path');

class AirTechDatabase {
    constructor(dbPath = './database.json') {
        this.dbPath = dbPath;
        this.data = null;
    }

    async loadDatabase() {
        try {
            const fileContent = await fs.readFile(this.dbPath, 'utf8');
            this.data = JSON.parse(fileContent);
            return this.data;
        } catch (error) {
            console.error('Error loading database:', error);
            this.data = this.createEmptyDatabase();
            await this.saveDatabase();
            return this.data;
        }
    }

    async saveDatabase() {
        try {
            await fs.writeFile(this.dbPath, JSON.stringify(this.data, null, 2));
            return true;
        } catch (error) {
            console.error('Error saving database:', error);
            return false;
        }
    }

    createEmptyDatabase() {
        return {
            customers: [], technicians: [], orders: [], equipment: [],
            serviceTypes: [], checklistTemplates: [], serviceReports: [],
            quotes: [], invoices: [], settings: {}
        };
    }

    async ensureLoaded() {
        if (!this.data) {
            await this.loadDatabase();
        }
    }

    // --- Kunder ---
    async getCustomers() { await this.ensureLoaded(); return this.data.customers; }
    async getCustomer(id) { await this.ensureLoaded(); return this.data.customers.find(c => c.id === id); }

    // --- Teknikere ---
    async getTechnicians() { await this.ensureLoaded(); return this.data.technicians; }
    async getTechnician(id) { await this.ensureLoaded(); return this.data.technicians.find(t => t.id === id); }

    async addTechnician(technician) {
        await this.ensureLoaded();
        technician.id = `TECH-${Date.now()}`;
        this.data.technicians.push(technician);
        await this.saveDatabase();
        return technician;
    }

    // --- Ordrer ---
    async getOrders() { await this.ensureLoaded(); return this.data.orders; }
    async getOrder(id) { await this.ensureLoaded(); return this.data.orders.find(o => o.id === id); }

    async addOrder(order) {
        await this.ensureLoaded();
        order.id = `ORD-${Date.now()}`;
        this.data.orders.push(order);
        await this.saveDatabase();
        return order;
    }

    async updateOrder(id, updates) {
        await this.ensureLoaded();
        const index = this.data.orders.findIndex(o => o.id === id);
        if (index !== -1) {
            this.data.orders[index] = { ...this.data.orders[index], ...updates };
            await this.saveDatabase();
            return this.data.orders[index];
        }
        return null;
    }
    
    // --- Anlegg ---
    async getEquipment() { await this.ensureLoaded(); return this.data.equipment; }
    async addEquipment(equipment) {
        await this.ensureLoaded();
        equipment.id = `EQ-${Date.now()}`;
        this.data.equipment.push(equipment);
        await this.saveDatabase();
        return equipment;
    }
    async updateEquipment(id, updates) {
        await this.ensureLoaded();
        const index = this.data.equipment.findIndex(eq => eq.id === id);
        if (index !== -1) {
            this.data.equipment[index] = { ...this.data.equipment[index], ...updates };
            await this.saveDatabase();
            return this.data.equipment[index];
        }
        return null;
    }

    // --- Sjekklister ---
    async getChecklistTemplates() { await this.ensureLoaded(); return this.data.checklistTemplates; }

    // --- Servicerapporter ---
    async getServiceReports() {
        await this.ensureLoaded();
        return this.data.serviceReports;
    }

    async getServiceReport(id) {
        await this.ensureLoaded();
        return this.data.serviceReports.find(report => report.reportId === id);
    }

    // ** DEN MANGLENDE FUNKSJONEN ER NÅ LAGT TIL HER **
    async getServiceReportByEquipment(equipmentId, orderId) {
        await this.ensureLoaded();
        // Sjekker at serviceReports-arrayet eksisterer før vi søker
        if (!this.data.serviceReports) {
            this.data.serviceReports = [];
            await this.saveDatabase();
            return undefined; // Returnerer undefined siden ingen ble funnet
        }
        return this.data.serviceReports.find(report => 
            report.equipmentId === equipmentId && report.orderId === orderId
        );
    }

    async addServiceReport(report) {
        await this.ensureLoaded();
        report.reportId = `SR-${Date.now()}`;
        report.createdAt = new Date().toISOString();
        if (!this.data.serviceReports) {
            this.data.serviceReports = [];
        }
        this.data.serviceReports.push(report);
        await this.saveDatabase();
        return report;
    }

    async updateServiceReport(id, updates) {
        await this.ensureLoaded();
        const index = this.data.serviceReports.findIndex(report => report.reportId === id);
        if (index !== -1) {
            this.data.serviceReports[index] = { 
                ...this.data.serviceReports[index], 
                ...updates, 
                reportId: id,
                updatedAt: new Date().toISOString() 
            };
            await this.saveDatabase();
            return this.data.serviceReports[index];
        }
        return null;
    }
}

module.exports = AirTechDatabase;