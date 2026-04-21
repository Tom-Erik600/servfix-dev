const express = require('express');
const router = express.Router();

console.log('🟢 [CUSTOMERS] Route loading...');

// Health check endpoint
router.get('/health', async (req, res) => {
  try {
    const tripletexService = require('../services/tripletexService');
    
    // Test at vi kan få token
    const token = await tripletexService.getSessionToken();
    const hasToken = !!token;
    
    // Test at vi kan lage client
    const client = await tripletexService.getApiClient();
    const hasClient = !!client;
    
    res.json({
      status: 'ok',
      hasToken,
      hasClient,
      tokenLength: token ? token.length : 0
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message
    });
  }
});

// Middleware - sjekk tekniker ELLER admin auth
router.use((req, res, next) => {
  if (!req.session.technicianId && !req.session.isAdmin) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
});

// GET all customers — fra lokal DB (ikke Tripletex)
router.get('/', async (req, res) => {
  console.log('🟢 [CUSTOMERS] GET all customers (lokal DB)');

  try {
    const customerService = require('../services/customerService');
    const tenantId = req.session?.tenantId || req.tenantId;
    if (!tenantId) {
      return res.status(400).json({ error: 'Tenant ID mangler' });
    }

    const customers = await customerService.getCustomers(tenantId);
    console.log(`✅ Got ${customers.length} customers from local DB`);

    // Transform til samme shape som frontend forventer
    const transformed = customers.map(c => ({
      id: String(c.id),
      name: c.name || '',
      customerNumber: c.customer_number || '',
      organizationNumber: c.organization_number || '',
      contact: '',
      email: c.email || '',
      phone: c.phone || '',
      physicalAddress: c.physical_address || '',
      postalAddress: c.postal_address || '',
      invoiceEmail: c.invoice_email || '',
      externalId: c.external_id || null,
      notes: c.notes || ''
    }));

    console.log(`✅ Transformed ${transformed.length} customers`);
    res.json(transformed);

  } catch (error) {
    console.error('❌ [CUSTOMERS] Error:', error.message);
    res.status(500).json({
      error: 'Failed to fetch customers',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// PUT: Oppdater kundenotat
router.put('/:customerId/notes', async (req, res) => {
  const { customerId } = req.params;
  try {
    const customerService = require('../services/customerService');
    const tenantId = req.session?.tenantId || req.tenantId;
    if (!tenantId) return res.status(400).json({ error: 'Tenant ID mangler' });

    const { notes } = req.body;
    const updated = await customerService.updateCustomer(tenantId, customerId, { notes: notes || '' });
    if (!updated) return res.status(404).json({ error: 'Kunde ikke funnet' });
    res.json({ success: true, notes: updated.notes });
  } catch (error) {
    console.error('Error updating notes:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Hent adresser for kunde — fra lokal DB
router.get('/:customerId/addresses', async (req, res) => {
  const { customerId } = req.params;
  console.log(`🟢 [CUSTOMERS] GET addresses for customer ${customerId} (lokal DB)`);

  try {
    const customerService = require('../services/customerService');
    const tenantId = req.session?.tenantId || req.tenantId;
    if (!tenantId) {
      return res.status(400).json({ error: 'Tenant ID mangler' });
    }

    const customer = await customerService.getCustomer(tenantId, customerId);
    if (!customer) {
      return res.status(404).json({ error: 'Kunde ikke funnet' });
    }

    res.json({
      physicalAddress: customer.physical_address || '',
      postalAddress: customer.postal_address || ''
    });
  } catch (error) {
    console.error(`❌ [CUSTOMERS] Error fetching addresses:`, error.message);
    res.status(500).json({
      error: 'Failed to fetch addresses',
      details: error.message
    });
  }
});

// GET prosjekter for kunde fra Tripletex
router.get('/:customerId/projects', async (req, res) => {
  const { customerId } = req.params;
  console.log(`📁 [CUSTOMERS] GET projects for customer ${customerId}`);

  try {
    const tripletexService = require('../services/tripletexService');
    const client = await tripletexService.getApiClient();

    const response = await client.get('/project', {
      params: {
        customerId: customerId,
        isClosed: false,
        from: 0,
        count: 20,
        fields: 'id,name,number,displayName,startDate,endDate,isClosed'
      }
    });

    const today = new Date().toISOString().split('T')[0];
    const projects = (response.data.values || [])
      .sort((a, b) => b.id - a.id)
      .filter(p => {
        if (!p.endDate) return true;
        const end = p.endDate.toString().slice(0, 10);
        return end >= today;
      });

    const result = projects.map(p => ({
      id: p.id,
      displayName: p.displayName || p.name || '',
      number: p.number || null
    }));

    console.log(`✅ [CUSTOMERS] ${result.length} aktive prosjekter (filtrert på sluttdato)`);
    res.json(result);

  } catch (error) {
    console.error(`❌ [CUSTOMERS] Error fetching projects:`, error.message);
    res.json([]); // Tom liste — ikke krasj
  }
});

console.log('✅ [CUSTOMERS] Route module loaded');

module.exports = router;
