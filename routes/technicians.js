
const express = require('express');
const router = express.Router();

module.exports = (db) => {
    // GET all technicians
    router.get('/', async (req, res, next) => {
        try {
            const data = await db.getTechnicians();
            res.json(data);
        } catch (error) {
            next(error);
        }
    });

    router.post('/', async (req, res, next) => {
        try {
            const newTechnician = await db.addTechnician(req.body);
            res.status(201).json(newTechnician);
        } catch (error) {
            next(error);
        }
    });

    return router;
};
