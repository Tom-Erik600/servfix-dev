const express = require('express');
const router = express.Router();

console.log('🟢 [ADMIN CUSTOMERS] Route loading...');

// Middleware - sjekk ADMIN auth
router.use((req, res, next) => {
  if (!req.session.isAdmin) {
    return res.status(401).json({ error: 'Admin authentication required' });
  }
  next();
});

// GET all customers — fra lokal DB (ikke Tripletex)
router.get('/', async (req, res) => {
  console.log('🟢 [ADMIN CUSTOMERS] GET all customers (lokal DB)');

  try {
    const customerService = require('../../services/customerService');
    const tenantId = req.session.tenantId;
    if (!tenantId) {
      return res.status(400).json({ error: 'Tenant ID mangler i session' });
    }

    const customers = await customerService.getCustomers(tenantId);
    console.log(`✅ Got ${customers.length} customers from local DB`);

    // Transform til samme shape som frontend forventer
    const transformed = customers.map(c => ({
      id: String(c.id),
      name: c.name || '',
      customerNumber: c.customer_number || '',
      organizationNumber: c.organization_number || '',
      contact: '',  // Hentes via lazy loading fra /contact
      email: c.email || '',
      phone: c.phone || '',
      physicalAddress: c.physical_address || '',
      postalAddress: c.postal_address || '',
      invoiceEmail: c.invoice_email || '',
      reportEmail: null,  // Hentes via lazy loading fra /servfixmail
      externalId: c.external_id || null,
      notes: c.notes || ''
    }));

    console.log(`✅ Transformed ${transformed.length} customers`);
    res.json(transformed);

  } catch (error) {
    console.error('❌ [ADMIN CUSTOMERS] Error:', error.message);
    res.status(500).json({
      error: 'Failed to fetch customers',
      details: error.message
    });
  }
});

// POST: Preview import — sammenlign Tripletex med lokal DB uten å skrive
router.post('/import/preview', async (req, res) => {
  console.log('🔍 [ADMIN CUSTOMERS] POST import preview');
  try {
    const customerImportService = require('../../services/customerImportService');
    const tenantId = req.session.tenantId;
    if (!tenantId) {
      return res.status(400).json({ error: 'Tenant ID mangler i session' });
    }
    const preview = await customerImportService.previewImport(tenantId);
    res.json(preview);
  } catch (error) {
    console.error('❌ [ADMIN CUSTOMERS] Preview feilet:', error.message);
    res.status(500).json({ error: 'Preview feilet', details: error.message });
  }
});

// POST: Apply valgte import-endringer
router.post('/import/apply', async (req, res) => {
  console.log('🔄 [ADMIN CUSTOMERS] POST import apply');
  try {
    const customerImportService = require('../../services/customerImportService');
    const tenantId = req.session.tenantId;
    if (!tenantId) {
      return res.status(400).json({ error: 'Tenant ID mangler i session' });
    }
    const { newCustomerIds, updatedCustomerIds } = req.body;
    if (!Array.isArray(newCustomerIds) || !Array.isArray(updatedCustomerIds)) {
      return res.status(400).json({ error: 'Trenger newCustomerIds og updatedCustomerIds arrays' });
    }
    const stats = await customerImportService.applySelectedImport(tenantId, {
      newCustomerIds,
      updatedCustomerIds
    });
    console.log('✅ [ADMIN CUSTOMERS] Apply ferdig:', stats);
    res.json(stats);
  } catch (error) {
    console.error('❌ [ADMIN CUSTOMERS] Apply feilet:', error.message);
    res.status(500).json({ error: 'Import feilet', details: error.message });
  }
});

// PUT: Oppdater kundenotat
router.put('/:customerId/notes', async (req, res) => {
  const { customerId } = req.params;
  try {
    const customerService = require('../../services/customerService');
    const tenantId = req.session.tenantId;
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

// Hent adresser for kunde — fra lokal DB (allerede lagret ved import)
router.get('/:customerId/addresses', async (req, res) => {
  const { customerId } = req.params;
  console.log(`🟢 [ADMIN CUSTOMERS] GET addresses for customer ${customerId} (lokal DB)`);

  try {
    const customerService = require('../../services/customerService');
    const tenantId = req.session.tenantId;
    if (!tenantId) {
      return res.status(400).json({ error: 'Tenant ID mangler i session' });
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
    console.error(`❌ [ADMIN CUSTOMERS] Error fetching addresses:`, error.message);
    res.status(500).json({
      error: 'Failed to fetch addresses',
      details: error.message
    });
  }
});

// Hent kontaktperson for kunde — fra lokal customer_contacts
router.get('/:customerId/contact', async (req, res) => {
  const { customerId } = req.params;
  console.log(`👤 [ADMIN CUSTOMERS] GET contact for customer ${customerId} (lokal DB)`);

  try {
    const customerService = require('../../services/customerService');
    const tenantId = req.session.tenantId;
    if (!tenantId) {
      return res.status(400).json({ error: 'Tenant ID mangler i session' });
    }

    const contacts = await customerService.getContacts(tenantId, customerId);

    // Filtrer bort rapport-kontakter (servfixmail) for å finne primær kontaktperson
    const realContacts = contacts.filter(c => !c.is_report_recipient);
    const primary = realContacts[0] || null;

    // Fallback: bruk kundens e-post hvis ingen kontaktperson finnes
    let fallbackEmail = '';
    if (!primary) {
      const customer = await customerService.getCustomer(tenantId, customerId);
      fallbackEmail = customer?.email || customer?.invoice_email || '';
    }

    res.json({
      contact: primary?.name || '',
      email: primary?.email || fallbackEmail
    });
  } catch (error) {
    console.error(`❌ [ADMIN CUSTOMERS] Error fetching contact:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// Hent rapport-mottaker (servfixmail) for kunde — fra lokal customer_contacts
router.get('/:customerId/servfixmail', async (req, res) => {
  const { customerId } = req.params;
  console.log(`📧 [ADMIN CUSTOMERS] GET report recipient for customer ${customerId} (lokal DB)`);

  try {
    const customerService = require('../../services/customerService');
    const tenantId = req.session.tenantId;
    if (!tenantId) {
      return res.status(400).json({ error: 'Tenant ID mangler i session' });
    }

    const recipient = await customerService.getReportRecipient(tenantId, customerId);

    if (recipient && recipient.email) {
      console.log(`✅ [ADMIN CUSTOMERS] Found report recipient: ${recipient.email}`);
      res.json({
        email: recipient.email,
        firstName: (recipient.name || '').split(' ')[0] || '',
        lastName: (recipient.name || '').split(' ').slice(1).join(' ') || ''
      });
    } else {
      console.log(`⚠️ [ADMIN CUSTOMERS] No report recipient found for customer ${customerId}`);
      res.json({ email: null });
    }
  } catch (error) {
    console.error(`❌ [ADMIN CUSTOMERS] Error fetching report recipient:`, error.message);
    res.status(500).json({
      error: 'Failed to fetch report recipient',
      details: error.message
    });
  }
});

// ============================================================
// KONTAKTPERSON CRUD
// ============================================================

// GET alle kontakter for en kunde
router.get('/:customerId/contacts', async (req, res) => {
  const { customerId } = req.params;
  try {
    const customerService = require('../../services/customerService');
    const tenantId = req.session.tenantId;
    if (!tenantId) return res.status(400).json({ error: 'Tenant ID mangler' });

    const contacts = await customerService.getContacts(tenantId, customerId);
    res.json(contacts);
  } catch (error) {
    console.error('Error fetching contacts:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST opprett ny kontakt
router.post('/:customerId/contacts', async (req, res) => {
  const { customerId } = req.params;
  try {
    const customerService = require('../../services/customerService');
    const tenantId = req.session.tenantId;
    if (!tenantId) return res.status(400).json({ error: 'Tenant ID mangler' });

    const contact = await customerService.createContact(tenantId, customerId, req.body);
    res.json(contact);
  } catch (error) {
    console.error('Error creating contact:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// PUT oppdater kontakt
router.put('/contacts/:contactId', async (req, res) => {
  const { contactId } = req.params;
  try {
    const customerService = require('../../services/customerService');
    const tenantId = req.session.tenantId;
    if (!tenantId) return res.status(400).json({ error: 'Tenant ID mangler' });

    const contact = await customerService.updateContact(tenantId, contactId, req.body);
    if (!contact) return res.status(404).json({ error: 'Kontakt ikke funnet' });
    res.json(contact);
  } catch (error) {
    console.error('Error updating contact:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// DELETE slett kontakt
router.delete('/contacts/:contactId', async (req, res) => {
  const { contactId } = req.params;
  try {
    const customerService = require('../../services/customerService');
    const tenantId = req.session.tenantId;
    if (!tenantId) return res.status(400).json({ error: 'Tenant ID mangler' });

    const deleted = await customerService.deleteContact(tenantId, contactId);
    if (!deleted) return res.status(404).json({ error: 'Kontakt ikke funnet' });
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting contact:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST: Importer kunder fra Tripletex til lokal customers-tabell
router.post('/import', async (req, res) => {
  console.log('🔄 [ADMIN CUSTOMERS] POST import from Tripletex');

  try {
    const customerImportService = require('../../services/customerImportService');
    const tenantId = req.session.tenantId;

    if (!tenantId) {
      return res.status(400).json({ error: 'Tenant ID mangler i session' });
    }

    const stats = await customerImportService.importFromTripletex(tenantId);

    console.log('✅ [ADMIN CUSTOMERS] Import ferdig:', stats);
    res.json(stats);
  } catch (error) {
    console.error('❌ [ADMIN CUSTOMERS] Import feilet:', error.message);
    res.status(500).json({
      error: 'Import feilet',
      details: error.message
    });
  }
});

// Hent prosjekter for kunde fra Tripletex
router.get('/:customerId/projects', async (req, res) => {
  const { customerId } = req.params;
  console.log(`📁 [ADMIN CUSTOMERS] GET projects for customer ${customerId}`);

  try {
    const tripletexService = require('../../services/tripletexService');
    const client = await tripletexService.getApiClient();

    const response = await client.get('/project', {
      params: {
        customerId: customerId,
        isClosed: false,
        from: 0,
        count: 20,
        fields: 'id,name,number,displayName,startDate,endDate'
      }
    });

    const projects = (response.data.values || [])
      .sort((a, b) => b.id - a.id); // Nyeste først

    const result = projects.map(p => ({
      id: p.id,
      displayName: p.displayName || p.name || ''
    }));

    console.log(`✅ [ADMIN CUSTOMERS] Found ${result.length} projects for customer ${customerId}`);
    res.json(result);

  } catch (error) {
    console.error(`❌ [ADMIN CUSTOMERS] Error fetching projects:`, error.message);
    res.json([]); // Tom liste — ikke krasj modalen
  }
});

console.log('✅ [ADMIN CUSTOMERS] Route module loaded');

module.exports = router;
