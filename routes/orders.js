
const express = require('express');
const router = express.Router();

module.exports = (db) => {
    // GET all orders
    router.get('/', async (req, res, next) => {
        try {
            const data = await db.getOrders();
            res.json(data);
        } catch (error) {
            next(error);
        }
    });

    // GET a single order by ID
    router.get('/:id', async (req, res, next) => {
        try {
            const item = await db.getOrder(req.params.id);
            if (item) {
                res.json(item);
            } else {
                res.status(404).json({ error: "Order not found" });
            }
        } catch (error) {
            next(error);
        }
    });

    // POST a new order
    router.post('/', async (req, res, next) => {
        try {
            const newOrderData = req.body;
            if (!newOrderData.customerId || !newOrderData.technicianId || !newOrderData.scheduledDate) {
                return res.status(400).json({ error: 'Missing required fields for order' });
            }
            const createdOrder = await db.addOrder(newOrderData);
            res.status(201).json(createdOrder);
        } catch (error) {
            next(error);
        }
    });

    // PUT to update an order
    router.put('/:id', async (req, res, next) => {
        try {
            const updatedOrder = await db.updateOrder(req.params.id, req.body);
            if (updatedOrder) {
                res.json(updatedOrder);
            } else {
                res.status(404).json({ error: 'Order not found' });
            }
        } catch (error) {
            next(error);
        }
    });

    return router;
};
