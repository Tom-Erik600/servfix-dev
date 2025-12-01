
const express = require('express');
const router = express.Router();

module.exports = (db) => {
    // GET all customers
    router.get('/', async (req, res, next) => {
        try {
            const data = await db.getCustomers();
            res.json(data);
        } catch (error) {
            next(error);
        }
    });

    // GET a single customer by ID
    router.get('/:id', async (req, res, next) => {
        try {
            const item = await db.getCustomer(req.params.id);
            if (item) {
                res.json(item);
            } else {
                res.status(404).json({ error: "Customer not found" });
            }
        } catch (error) {
            next(error);
        }
    });

    return router;
};
