// routes/quotes.js - Tilbud API endepunkter
const express = require('express');
const { requireAuth } = require('../middleware/auth');

module.exports = (db) => {
    const router = express.Router();
    router.use(requireAuth);
    // GET alle tilbud
    router.get('/', async (req, res, next) => {
        try {
            const quotes = await db.getQuotes();
            res.json(quotes);
        } catch (error) {
            next(error);
        }
    });

    // GET tilbud for spesifikk ordre
    router.get('/order/:orderId', async (req, res, next) => {
        try {
            const quotes = await db.getQuotesByOrder(req.params.orderId);
            res.json(quotes);
        } catch (error) {
            next(error);
        }
    });

    // GET enkelt tilbud
    router.get('/:id', async (req, res, next) => {
        try {
            const quote = await db.getQuote(req.params.id);
            if (quote) {
                res.json(quote);
            } else {
                res.status(404).json({ error: 'Tilbud ikke funnet' });
            }
        } catch (error) {
            next(error);
        }
    });

    // POST nytt tilbud
    router.post('/', async (req, res, next) => {
        try {
            const { orderId, description, estimatedHours, estimatedPrice, products } = req.body;
            
            if (!orderId || !description) {
                return res.status(400).json({ error: 'OrdreId og beskrivelse er påkrevd' });
            }

            const quoteData = {
                orderId,
                description,
                estimatedHours: parseFloat(estimatedHours) || 0,
                estimatedPrice: parseFloat(estimatedPrice) || 0,
                products: products || [],
                status: 'pending'
            };

            const newQuote = await db.addQuote(quoteData);
            res.status(201).json(newQuote);
        } catch (error) {
            next(error);
        }
    });

    // PUT oppdater tilbud
    router.put('/:id', async (req, res, next) => {
        try {
            const updatedQuote = await db.updateQuote(req.params.id, req.body);
            if (updatedQuote) {
                res.json(updatedQuote);
            } else {
                res.status(404).json({ error: 'Tilbud ikke funnet' });
            }
        } catch (error) {
            next(error);
        }
    });

    // DELETE tilbud
    router.delete('/:id', async (req, res, next) => {
        try {
            const deleted = await db.deleteQuote(req.params.id);
            if (deleted) {
                res.json({ message: 'Tilbud slettet' });
            } else {
                res.status(404).json({ error: 'Tilbud ikke funnet' });
            }
        } catch (error) {
            next(error);
        }
    });

    return router;
};