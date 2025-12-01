/**
 * Tripletex API Service - FIKSET VERSJON
 * Kompatibel med eksisterende struktur
 */

const axios = require('axios');
require('dotenv').config();

class TripletexAPI {
    constructor() {
        this.baseUrl = process.env.BASE_URL || process.env.TRIPLETEX_BASE_URL;
        this.consumerToken = process.env.CONSUMER_TOKEN || process.env.TRIPLETEX_CONSUMER_TOKEN;
        this.employeeToken = process.env.EMPLOYEE_TOKEN || process.env.TRIPLETEX_EMPLOYEE_TOKEN;
        this.sessionToken = null;
        this.apiClient = null;
    }

    async getSessionToken() {
        if (this.sessionToken) {
            return this.sessionToken;
        }

        try {
            console.log('Henter session token fra Tripletex...');
            const expirationDate = new Date(new Date().getFullYear(), 11, 31).toISOString().slice(0, 10);
            const response = await axios({
                method: 'put',
                url: `${this.baseUrl}/token/session/:create?consumerToken=${this.consumerToken}&employeeToken=${this.employeeToken}&expirationDate=${expirationDate}`,
            });
            
            this.sessionToken = response.data.value.token;
            console.log('✅ Session token mottatt');
            return this.sessionToken;
        } catch (error) {
            console.error("Feil ved henting av session token:", error.response?.data || error.message);
            throw new Error("Kunne ikke autentisere med Tripletex");
        }
    }

    async getApiClient() {
        if (this.apiClient) {
            return this.apiClient;
        }

        const token = await this.getSessionToken();
        const basicAuth = Buffer.from(`0:${token}`).toString('base64');

        this.apiClient = axios.create({
            baseURL: this.baseUrl,
            headers: {
                Authorization: `Basic ${basicAuth}`,
            },
        });

        return this.apiClient;
    }

    /**
     * FIKSET: Henter alle kunder fra Tripletex
     */
    async getCustomers(params = {}) {
        try {
            console.log('Henter kunder fra Tripletex...', params);
            const client = await this.getApiClient();
            const response = await client.get('/customer', { params });
            
            console.log(`✅ Hentet ${response.data.values?.length || 0} kunder fra Tripletex`);
            return response.data;
        } catch (error) {
            console.error('Feil ved henting av kunder:', error);
            throw this.handleError(error);
        }
    }

    /**
     * FIKSET: Henter enkelt kunde fra Tripletex
     */
    async getCustomer(id) {
        try {
            console.log(`Henter kunde ${id} fra Tripletex...`);
            const client = await this.getApiClient();
            const response = await client.get(`/customer/${id}`);
            
            console.log(`✅ Hentet kunde ${id} fra Tripletex`);
            return response.data;
        } catch (error) {
            console.error(`Feil ved henting av kunde ${id}:`, error);
            throw this.handleError(error);
        }
    }

    /**
     * Test-metode for å sjekke forbindelse
     */
    async testConnection() {
        try {
            console.log('🔍 Tester Tripletex-forbindelse...');
            const data = await this.getCustomers({ count: 1 });
            return {
                success: true,
                message: 'Tripletex API fungerer',
                customerCount: data.fullResultSize || 0
            };
        } catch (error) {
            return {
                success: false,
                message: error.message,
                error: error
            };
        }
    }

    handleError(error) {
        if (error.response) {
            const errorMessage = error.response.data?.message || error.message;
            const errorDetails = {
                status: error.response.status,
                statusText: error.response.statusText,
                data: error.response.data
            };
            console.error('Tripletex API Error:', errorDetails);
            return new Error(`Tripletex API Error: ${errorMessage}`);
        } else if (error.request) {
            console.error('Ingen respons fra Tripletex API');
            return new Error('Ingen respons fra Tripletex API');
        } else {
            console.error('Feil ved oppsett av Tripletex request:', error.message);
            return new Error(`Request setup error: ${error.message}`);
        }
    }
}

// VIKTIG: Eksporter instans, ikke klassen
module.exports = new TripletexAPI();