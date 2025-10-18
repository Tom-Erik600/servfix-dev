const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../config/database');
const QuotePDFGenerator = require('../services/quotePDFGenerator');

const router = express.Router();

// Middleware for å sikre tenantId er satt
router.use((req, res, next) => {
    const tenantId = req.session?.tenantId || req.tenantId || process.env.DEFAULT_TENANT_ID || 'airtech';
    req.tenantId = tenantId;
    req.session.tenantId = tenantId;
    
    console.log(`🏢 Quotes API - Tenant: ${tenantId}, Session: ${req.sessionID?.substring(0,8)}...`);
    next();
});

// Transform function för konsistent dataformat
function transformQuoteForFrontend(dbQuote) {
    let items = {};
    try {
        items = typeof dbQuote.items === 'string' ? JSON.parse(dbQuote.items) : (dbQuote.items || {});
    } catch (e) {
        console.error(`Invalid JSON in items for quote ${dbQuote.id}:`, e);
        items = {};
    }
    
    // Parse customer data from orders
    let customer = {};
    try {
        customer = typeof dbQuote.customer_data === 'string' ? 
            JSON.parse(dbQuote.customer_data) : (dbQuote.customer_data || {});
    } catch (e) {
        console.error(`Invalid customer_data for quote ${dbQuote.id}:`, e);
    }
    
    return {
        ...dbQuote,
        description: items.description || dbQuote.description || '',
        estimatedHours: items.estimatedHours || 0,
        estimatedPrice: dbQuote.total_amount || 0,
        products: items.products || [],
        items: items.products || [],
        customer_name: dbQuote.customer_name || 'Ukjent kunde',
        customer: {
            name: dbQuote.customer_name || customer.name || 'Ukjent kunde',
            ...customer
        },
        totalAmount: dbQuote.total_amount || 0
    };
}

// GET all quotes
router.get('/', async (req, res) => {
    console.log('🔍 GET /api/quotes called');
    
    try {
        const tenantId = req.session?.tenantId || req.tenantId || 'airtech';
        console.log('Using tenant:', tenantId);
        
        const pool = await db.getTenantConnection(tenantId);
        console.log('Database connected');
        
        const result = await pool.query(`
            SELECT q.*, q.items::jsonb as items_data,
                   o.customer_name, o.customer_data,
                   COALESCE(o.customer_name, 'Ukjent kunde') as customer_name
            FROM quotes q 
            LEFT JOIN orders o ON q.order_id = o.id
            ORDER BY q.created_at DESC
        `);
        
        console.log('Query executed, rows:', result.rows.length);
        
        const quotes = result.rows.map(quote => {
            quote.items = quote.items_data;
            return transformQuoteForFrontend(quote);
        });
        
        console.log('Quotes transformed, sending response');
        res.json(quotes);
        
    } catch (error) {
        console.error('🔥 QUOTES GET ERROR:', error);
        res.status(500).json({ 
            error: 'Kunne ikke hente tilbud',
            debug: error.message
        });
    }
});

// GET quotes for specific order
router.get('/order/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        const tenantId = req.session.tenantId || req.tenantId || 'airtech';
        const pool = await db.getTenantConnection(tenantId);
        
        const result = await pool.query(`
            SELECT q.*, q.items::jsonb as items_data
            FROM quotes q 
            WHERE q.order_id = $1
            ORDER BY q.created_at DESC
        `, [orderId]);
        
        const quotes = result.rows.map(quote => {
            quote.items = quote.items_data;
            return transformQuoteForFrontend(quote);
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
        
        const quoteId = `QUOTE-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        
        const quotedItems = items && Array.isArray(items) ? items : [];
        
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
        
        const quote = result.rows[0];
        const frontendQuote = transformQuoteForFrontend(quote);
        
        res.json(frontendQuote);
        
    } catch (error) {
        console.error('Error creating quote:', error);
        res.status(500).json({ error: 'Kunne ikke opprette tilbud' });
    }
});

// PUT update quote
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { description, estimatedHours, products, total_amount, status, items } = req.body;
        
        console.log('PUT /api/quotes/:id request:', {
            quoteId: id,
            bodyKeys: Object.keys(req.body),
            hasDescription: !!description,
            hasProducts: !!products,
            hasTotalAmount: !!total_amount
        });
        
        const tenantId = req.session?.tenantId || req.tenantId || 'airtech';
        const pool = await db.getTenantConnection(tenantId);
        
        // Prepare items JSON
        const itemsJson = items || {
            description: description,
            estimatedHours: estimatedHours || 0,
            products: products || []
        };
        
        const result = await pool.query(`
            UPDATE quotes 
            SET total_amount = $1, 
                status = $2,
                items = $3
            WHERE id = $4 
            RETURNING *
        `, [
            total_amount || 0,
            status || 'pending',
            JSON.stringify(itemsJson),
            id
        ]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Tilbud ikke funnet' });
        }
        
        // Hent komplett quote data med customer info fra orders tabellen
        const completeQuoteResult = await pool.query(`
            SELECT q.*, q.items::jsonb as items_data,
                   o.customer_name, o.customer_data,
                   COALESCE(o.customer_name, 'Ukjent kunde') as customer_name
            FROM quotes q 
            LEFT JOIN orders o ON q.order_id = o.id
            WHERE q.id = $1
        `, [id]);

        if (completeQuoteResult.rows.length === 0) {
            console.error('❌ Could not fetch updated quote with customer data for id:', id);
            return res.status(500).json({ error: 'Kunne ikke hente oppdatert tilbud' });
        }

        // Prepare data for transform function
        const completeQuote = completeQuoteResult.rows[0];
        completeQuote.items = completeQuote.items_data;

        const updatedQuote = transformQuoteForFrontend(completeQuote);
        console.log('✅ Quote updated successfully with customer data:', id);
        
        res.json(updatedQuote);
        
    } catch (error) {
        console.error('Error updating quote:', error);
        res.status(500).json({ 
            error: 'Kunne ikke oppdatere tilbud',
            details: error.message 
        });
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

// GET HTML preview for a quote
router.get('/:quoteId/html-preview', async (req, res) => {
    const { quoteId } = req.params;
    const tenantId = req.session.tenantId || 'airtech';

    try {
        console.log(`📄 Generating HTML preview for quote ${quoteId}`);
        
        const generator = new QuotePDFGenerator();
        const quoteData = await generator.fetchQuoteData(quoteId, tenantId);
        if (!quoteData) {
            return res.status(404).send('<h1>Tilbud ikke funnet</h1>');
        }
        
        const companySettings = await generator.loadCompanySettings(tenantId);
        const html = await generator.generateHTML(quoteData, companySettings);
        
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
        
        console.log(`✅ HTML preview generated for quote ${quoteId}`);
        
    } catch (error) {
        console.error(`❌ HTML preview error for ${quoteId}:`, error);
        res.status(500).send(`
            <h1>Feil ved generering av tilbud</h1>
            <p>Teknisk feil: ${error.message}</p>
            <p>Tilbud ID: ${quoteId}</p>
        `);
    }
});

// POST generate PDF for a quote
router.post('/:quoteId/generate-pdf', async (req, res) => {
    const { quoteId } = req.params;
    console.log('🔍 PDF Generate called for:', quoteId);
    
    let generator;
    try {
        const tenantId = req.session?.tenantId || req.tenantId || 'airtech';
        console.log('PDF Tenant:', tenantId);
        
        const pool = await db.getTenantConnection(tenantId);
        console.log('PDF Database connected');
        
        const quoteCheck = await pool.query('SELECT id FROM quotes WHERE id = $1', [quoteId]);
        if (quoteCheck.rows.length === 0) {
            console.log('PDF Quote not found');
            return res.status(404).json({ error: 'Tilbud ikke funnet', quoteId });
        }
        
        console.log('PDF Quote exists, initializing generator');
        generator = new QuotePDFGenerator();
        await generator.init();
        
        console.log('PDF Generator initialized, generating...');
        const pdfBuffer = await generator.generate(quoteId, tenantId);
        
        console.log('PDF Generated successfully');
        res.json({ 
            success: true, 
            message: 'PDF generated successfully',
            quoteId: quoteId,
            size: pdfBuffer.length
        });
        
    } catch (error) {
        console.error('🔥 PDF GENERATE ERROR:', error);
        res.status(500).json({ 
            error: 'PDF generation failed',
            debug: error.message,
            quoteId
        });
    } finally {
        if (generator) {
            await generator.close();
        }
    }
});

// GET PDF for a quote - DIREKTE GENERERING
router.get('/:id/pdf', async (req, res) => {
    const { id } = req.params;
    const tenantId = req.session.tenantId || 'airtech';
    let generator;

    try {
        console.log(`📄 Direct PDF download requested for quote ${id}`);
        
        generator = new QuotePDFGenerator();
        await generator.init();
        
        const pdfBuffer = await generator.generate(id, tenantId);
        console.log(`✅ PDF generated for download - size: ${(pdfBuffer.length / 1024).toFixed(2)}KB`);
        
        // KRITISK: Sett riktige headers for PDF
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Length', pdfBuffer.length);
        res.setHeader('Content-Disposition', `attachment; filename="tilbud_${id}.pdf"`);
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        
        // Send RAW buffer data
        res.end(pdfBuffer);
        
    } catch (error) {
        console.error(`PDF download failed for ${id}:`, error);
        res.status(500).json({ 
            error: 'PDF generation failed',
            debug: error.message 
        });
    } finally {
        if (generator) {
            await generator.close();
        }
    }
});

// POST send quote to customer - FAKTISK EMAIL SENDING
router.post('/:quoteId/send-to-customer', async (req, res) => {
    const { quoteId } = req.params;
    const tenantId = req.session.tenantId || 'airtech';
    let generator;

    try {
        console.log(`📧 Starting quote email for ${quoteId} (tenant: ${tenantId})`);
        
        // Hent quote fra database
        const pool = await db.getTenantConnection(tenantId);
        const quoteResult = await pool.query(`
            SELECT q.*, o.customer_name, o.customer_id 
            FROM quotes q 
            JOIN orders o ON q.order_id = o.id 
            WHERE q.id = $1
        `, [quoteId]);
        
        if (quoteResult.rows.length === 0) {
            return res.status(404).json({ error: 'Tilbud ikke funnet' });
        }
        
        const quote = quoteResult.rows[0];
        console.log(`📧 Quote found: ${quote.customer_name} (ID: ${quote.customer_id})`);
        
        // Hent servfixmail-kontakt
        const tripletexService = require('../services/tripletexService');
        const servfixContact = await tripletexService.getServfixmailContact(quote.customer_id);
        
        if (!servfixContact || !servfixContact.email) {
            return res.status(400).json({ 
                error: `Ingen servfixmail-kontakt funnet for kunde: ${quote.customer_name}`,
                customer_id: quote.customer_id
            });
        }
        
        console.log(`📧 Found servfixmail email: ${servfixContact.email}`);
        
        // GENERER PDF FØRST
        console.log(`📧 Generating PDF for email attachment...`);
        generator = new QuotePDFGenerator();
        await generator.init();
        const pdfBuffer = await generator.generate(quoteId, tenantId);
        console.log(`📧 PDF generated: ${Math.round(pdfBuffer.length / 1024)}KB`);
        
        // INITIALISER EMAIL SERVICE
        const EmailService = require('../services/emailService');
        await EmailService.init();
        console.log(`📧 Email service initialized`);
        
        // SEND EMAIL MED PDF ATTACHMENT
        const emailResult = await EmailService.sendQuoteToCustomer(
            quoteId, 
            tenantId, 
            pdfBuffer,
            servfixContact.email,
            quote
        );
        
        console.log(`📧 Email sent successfully to: ${emailResult.sentTo}`);
        
        // Oppdater database status
        await pool.query(
            'UPDATE quotes SET status = $1, sent_to_customer = true, sent_date = CURRENT_TIMESTAMP WHERE id = $2',
            ['sent', quoteId]
        );
        
        res.json({
            success: true,
            message: 'Tilbud sendt til kunde',
            sentTo: emailResult.sentTo,
            messageId: emailResult.messageId
        });
        
    } catch (error) {
        console.error(`📧 Email sending error for ${quoteId}:`, error);
        res.status(500).json({ 
            error: 'Kunne ikke sende tilbud',
            details: error.message 
        });
    } finally {
        if (generator) {
            await generator.close();
        }
    }
});

module.exports = router;