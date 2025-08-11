const express = require('express');
const db = require('../config/database');

const router = express.Router();

// Middleware - sjekk auth
router.use((req, res, next) => {
  if (!req.session.technicianId && !req.session.isAdmin) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
});

// GET all quotes
router.get('/', async (req, res) => {
  try {
    const tenantId = req.session.tenantId || req.tenantId || 'airtech';
    const pool = await db.getTenantConnection(tenantId);
    
    const result = await pool.query(`
      SELECT 
        q.*,
        q.items::jsonb as items_data
      FROM quotes q 
      ORDER BY q.created_at DESC
    `);
    
    // Transform for frontend compatibility
    const quotes = result.rows.map(quote => {
      const itemsData = typeof quote.items_data === 'string' ? JSON.parse(quote.items_data) : quote.items_data;
      
      return {
        ...quote,
        description: itemsData?.description || '',
        estimatedHours: itemsData?.estimatedHours || 0,
        estimatedPrice: quote.total_amount,
        products: itemsData?.products || [],
        items: itemsData?.products || []
      };
    });
    
    res.json(quotes);
  } catch (error) {
    console.error('Error fetching quotes:', error);
    res.status(500).json({ error: 'Kunne ikke hente tilbud' });
  }
});

// GET quotes for specific order
router.get('/order/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const tenantId = req.session.tenantId || req.tenantId || 'airtech';
    const pool = await db.getTenantConnection(tenantId);
    
    const result = await pool.query(`
      SELECT 
        q.*,
        q.items::jsonb as items_data
      FROM quotes q 
      WHERE q.order_id = $1
      ORDER BY q.created_at DESC
    `, [orderId]);
    
    // Transform for frontend compatibility
    const quotes = result.rows.map(quote => {
      const itemsData = typeof quote.items_data === 'string' ? JSON.parse(quote.items_data) : quote.items_data;
      
      return {
        ...quote,
        description: itemsData?.description || '',
        estimatedHours: itemsData?.estimatedHours || 0,
        estimatedPrice: quote.total_amount,
        products: itemsData?.products || [],
        items: itemsData?.products || []
      };
    });
    
    res.json(quotes);
  } catch (error) {
    console.error('Error fetching quotes for order:', error);
    res.status(500).json({ error: 'Kunne ikke hente tilbud for ordre' });
  }
});

// POST create new quote
router.post('/', async (req, res) => {
  try {
    const { orderId, description, estimatedHours, estimatedPrice, items, status } = req.body;
    
    if (!orderId) {
      return res.status(400).json({ error: 'orderId er påkrevd' });
    }
    
    const tenantId = req.session.tenantId || req.tenantId || 'airtech';
    const pool = await db.getTenantConnection(tenantId);
    
    // Generate quote ID
    const quoteId = `QUOTE-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    
    // Prepare items data to include description and hours since table doesn't have separate columns
    const quotedItems = items && Array.isArray(items) ? items : [];
    
    // Add description and hours as metadata in items
    const itemsWithMeta = {
      description: description || '',
      estimatedHours: estimatedHours || 0,
      products: quotedItems
    };
    
    const result = await pool.query(`
      INSERT INTO quotes (
        id, 
        order_id, 
        total_amount,
        items,
        status,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
      RETURNING *
    `, [
      quoteId,
      orderId,
      estimatedPrice || 0,
      JSON.stringify(itemsWithMeta),
      status || 'pending'
    ]);
    
    // Transform for frontend compatibility
    const quote = result.rows[0];
    const itemsData = typeof quote.items === 'string' ? JSON.parse(quote.items) : quote.items;
    
    const frontendQuote = {
      ...quote,
      description: itemsData?.description || '',
      estimatedHours: itemsData?.estimatedHours || 0,
      estimatedPrice: quote.total_amount,
      items: itemsData?.products || []
    };
    
    console.log('Quote created:', frontendQuote);
    res.status(201).json(frontendQuote);
    
  } catch (error) {
    console.error('Error creating quote:', error);
    
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Tilbud med denne ID finnes allerede' });
    }
    
    res.status(500).json({ error: 'Kunne ikke opprette tilbud: ' + error.message });
  }
});

// PUT update quote
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { description, estimatedHours, estimatedPrice, products, status } = req.body;
    
    const tenantId = req.session.tenantId || req.tenantId || 'airtech';
    const pool = await db.getTenantConnection(tenantId);
    
    // Get current quote to preserve existing data
    const currentResult = await pool.query('SELECT * FROM quotes WHERE id = $1', [id]);
    
    if (currentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tilbud ikke funnet' });
    }
    
    const currentQuote = currentResult.rows[0];
    const currentItems = typeof currentQuote.items === 'string' ? JSON.parse(currentQuote.items) : currentQuote.items;
    
    // Build updated items object
    const updatedItems = {
      description: description !== undefined ? description : (currentItems?.description || ''),
      estimatedHours: estimatedHours !== undefined ? estimatedHours : (currentItems?.estimatedHours || 0),
      products: products !== undefined ? products : (currentItems?.products || [])
    };
    
    let updateFields = [];
    let updateValues = [];
    let valueIndex = 1;
    
    if (estimatedPrice !== undefined) {
      updateFields.push(`total_amount = ${valueIndex++}`);
      updateValues.push(estimatedPrice);
    }
    
    if (description !== undefined || estimatedHours !== undefined || products !== undefined) {
      updateFields.push(`items = ${valueIndex++}`);
      updateValues.push(JSON.stringify(updatedItems));
    }
    
    if (status !== undefined) {
      updateFields.push(`status = ${valueIndex++}`);
      updateValues.push(status);
    }
    
    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'Ingen felter å oppdatere' });
    }
    
    updateFields.push(`approved_at = CURRENT_TIMESTAMP`);
    updateValues.push(id);
    
    const query = `
      UPDATE quotes 
      SET ${updateFields.join(', ')}
      WHERE id = ${valueIndex}
      RETURNING *
    `;
    
    const result = await pool.query(query, updateValues);
    
    // Transform for frontend compatibility
    const quote = result.rows[0];
    const itemsData = typeof quote.items === 'string' ? JSON.parse(quote.items) : quote.items;
    
    const frontendQuote = {
      ...quote,
      description: itemsData?.description || '',
      estimatedHours: itemsData?.estimatedHours || 0,
      estimatedPrice: quote.total_amount,
      products: itemsData?.products || []
    };
    
    res.json(frontendQuote);
    
  } catch (error) {
    console.error('Error updating quote:', error);
    res.status(500).json({ error: 'Kunne ikke oppdatere tilbud' });
  }
});

// DELETE quote
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.session.tenantId || req.tenantId || 'airtech';
    const pool = await db.getTenantConnection(tenantId);
    
    const result = await pool.query('DELETE FROM quotes WHERE id = $1 RETURNING id', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tilbud ikke funnet' });
    }
    
    res.json({ message: 'Tilbud slettet', id: result.rows[0].id });
    
  } catch (error) {
    console.error('Error deleting quote:', error);
    res.status(500).json({ error: 'Kunne ikke slette tilbud' });
  }
});

module.exports = router;