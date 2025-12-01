
const express = require('express');
const router = express.Router();

module.exports = (db) => {
    // GET all equipment
    router.get('/', async (req, res, next) => {
        try {
            const data = await db.getEquipment();
            res.json(data);
        } catch (error) {
            next(error);
        }
    });

    // GET a single piece of equipment by ID
    router.get('/:id', async (req, res, next) => {
        try {
            const allEquipment = await db.getEquipment();
            const item = allEquipment.find(e => e.id === req.params.id);
            if (item) {
                res.json(item);
            } else {
                res.status(404).json({ error: "Equipment not found" });
            }
        } catch (error) {
            next(error);
        }
    });

    // POST new equipment
    router.post('/', async (req, res, next) => {
        try {
            const newEquipment = await db.addEquipment(req.body);
            res.status(201).json(newEquipment);
        } catch (error) {
            next(error);
        }
    });

    // PUT to update equipment
    router.put('/:id', async (req, res, next) => {
        try {
            const updatedEquipment = await db.updateEquipment(req.params.id, req.body);
            if (updatedEquipment) {
                res.json(updatedEquipment);
            } else {
                res.status(404).json({ error: 'Equipment not found' });
            }
        } catch (error) {
            next(error);
        }
    });

    // DELETE (deactivate) equipment
    router.delete('/:id', async (req, res, next) => {
        try {
            const updatedEquipment = await db.updateEquipment(req.params.id, { status: 'inactive' });
            if (updatedEquipment) {
                res.status(200).json({ message: 'Equipment deactivated successfully' });
            } else {
                res.status(404).json({ error: 'Equipment not found' });
            }
        } catch (error) {
            next(error);
        }
    });

    return router;
};
