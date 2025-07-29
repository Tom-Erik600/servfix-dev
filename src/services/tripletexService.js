const axios = require('axios');

class TripletexService {
    constructor() {
        this.baseUrl = process.env.BASE_URL || 'https://tripletex.no/v2';
        this.consumerToken = process.env.CONSUMER_TOKEN;
        this.employeeToken = process.env.EMPLOYEE_TOKEN;
        this.sessionToken = null;
        this.apiClient = null;

        if (!this.consumerToken || !this.employeeToken) {
            console.warn('Tripletex API tokens are not fully configured in .env. Tripletex functionality may be limited.');
        }
    }

    async getSessionToken() {
        if (this.sessionToken) {
            return this.sessionToken;
        }

        if (!this.consumerToken || !this.employeeToken) {
            throw new Error('Tripletex API tokens (CONSUMER_TOKEN, EMPLOYEE_TOKEN) are required to get a session token.');
        }

        try {
            const expirationDate = new Date(new Date().getFullYear() + 1, 0, 1) // Jan 1st next year
                .toISOString().slice(0, 10);

            const tokenResponse = await axios({
                method: 'put',
                url: `${this.baseUrl}/token/session/:create`,
                params: {
                    consumerToken: this.consumerToken,
                    employeeToken: this.employeeToken,
                    expirationDate: expirationDate
                }
            });

            this.sessionToken = tokenResponse.data.value.token;
            return this.sessionToken;
        } catch (error) {
            console.error('Error getting Tripletex session token:', error.response?.data || error.message);
            throw new Error('Failed to get Tripletex session token.');
        }
    }

    async getApiClient() {
        if (this.apiClient) {
            return this.apiClient;
        }

        const sessionToken = await this.getSessionToken();
        const basicAuth = Buffer.from(`0:${sessionToken}`).toString('base64');

        this.apiClient = axios.create({
            baseURL: this.baseUrl,
            headers: {
                Authorization: `Basic ${basicAuth}`,
                'Content-Type': 'application/json'
            },
        });
        return this.apiClient;
    }

    async getCustomers(params = {}) {
        try {
            const client = await this.getApiClient();
            const response = await client.get('/customer', {
                params: {
                    from: params.from || 0,
                    count: params.count || 100, // Default to 100 customers
                    ...params
                }
            });
            return response.data.values;
        } catch (error) {
            console.error('Error fetching customers from Tripletex:', error.response?.data || error.message);
            throw new Error('Failed to fetch customers from Tripletex.');
        }
    }
    async getCustomer(customerId) {
        try {
            const client = await this.getApiClient();
            const response = await client.get(`/customer/${customerId}`);
            return response.data.value;
        } catch (error) {
            console.error('Error fetching customer from Tripletex:', error);
            throw new Error('Failed to fetch customer from Tripletex.');
        }
    }
}

module.exports = new TripletexService();