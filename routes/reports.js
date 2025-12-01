
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

module.exports = (db) => {
    // GET annual summary report
    router.get('/annual_summary', async (req, res, next) => {
        try {
            const customers = await db.getCustomers();
            const orders = await db.getOrders();
            
            const invoicesPath = path.join(__dirname, '..', 'database', 'simulated-invoices.json');
            const simulatedInvoices = JSON.parse(fs.readFileSync(invoicesPath, 'utf-8'));

            const customerSummary = {};

            (customers || []).forEach(customer => {
                customerSummary[customer.id] = {
                    name: customer.name,
                    projectCount: 0,
                    totalInvoiced: 0
                };
            });

            (orders || []).forEach(order => {
                if (customerSummary[order.customerId]) {
                    customerSummary[order.customerId].projectCount++;
                }
            });

            simulatedInvoices.forEach(invoice => {
                if (customerSummary[invoice.customerId]) {
                    customerSummary[invoice.customerId].totalInvoiced += invoice.amount;
                }
            });

            const summaryList = Object.keys(customerSummary).map(id => ({
                customerId: id,
                ...customerSummary[id]
            }));
            
            res.json(summaryList);

        } catch (error) {
            next(error);
        }
    });

    return router;
};
