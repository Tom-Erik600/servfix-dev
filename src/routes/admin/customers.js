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

// GET all customers (UTEN adresser for å unngå rate limiting)
router.get('/', async (req, res) => {
  console.log('🟢 [ADMIN CUSTOMERS] GET all customers');
  
  try {
    const tripletexService = require('../../services/tripletexService');
    
    // Hent kunder UTEN å fetche adresser
    const client = await tripletexService.getApiClient();
    const response = await client.get('/customer', {
      params: {
        from: 0,
        count: 1000
      }
    });
    
    const customers = response.data.values;
    console.log(`✅ Got ${customers.length} customers from Tripletex`);
    
    // Transform uten å hente adresser
    const transformed = customers.map(c => ({
      id: String(c.id),
      name: c.name || '',
      customerNumber: c.customerNumber || '',
      organizationNumber: c.organizationNumber || '',
      contact: c.customerContact ? 
        `${c.customerContact.firstName || ''} ${c.customerContact.lastName || ''}`.trim() : '',
      email: c.email || c.customerContact?.email || '',
      phone: c.phoneNumber || c.phoneNumberMobile || '',
      
      // Bare lagre ID-ene, hent faktisk adresse senere (lazy loading)
      physicalAddressId: c.physicalAddress?.id || null,
      postalAddressId: c.postalAddress?.id || null,
      physicalAddress: '', // Tom til den hentes
      postalAddress: '', // Tom til den hentes
      
      currency: c.currency?.id || 'NOK',
      language: c.language?.id || 'NO',
      isCustomer: c.isCustomer || false,
      isSupplier: c.isSupplier || false,
      isPrivate: c.isPrivateIndividual || false,
      customerAccountManager: c.accountManager?.name || '',
      invoiceEmail: c.invoiceEmail || '',
      overdueNoticeEmail: c.overdueNoticeEmail || ''
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

// NY ENDPOINT: Hent adresser for EN spesifikk kunde (LAZY LOADING)
router.get('/:customerId/addresses', async (req, res) => {
  const { customerId } = req.params;
  console.log(`🟢 [ADMIN CUSTOMERS] GET addresses for customer ${customerId}`);
  
  try {
    const tripletexService = require('../../services/tripletexService');
    
    // Hent kunde for å få address IDs
    const customer = await tripletexService.getCustomer(customerId);
    
    const addresses = {
      physicalAddress: '',
      postalAddress: ''
    };
    
    // Hent physical address hvis den finnes
    if (customer.physicalAddress?.id) {
      const addr = await tripletexService.getAddress(customer.physicalAddress.id);
      if (addr) {
        const parts = [];
        if (addr.addressLine1) parts.push(addr.addressLine1);
        if (addr.addressLine2) parts.push(addr.addressLine2);
        const loc = [];
        if (addr.postalCode) loc.push(addr.postalCode);
        if (addr.city) loc.push(addr.city);
        if (loc.length) parts.push(loc.join(' '));
        addresses.physicalAddress = parts.join(', ');
      }
    }
    
    // Hent postal address hvis den finnes
    if (customer.postalAddress?.id) {
      const addr = await tripletexService.getAddress(customer.postalAddress.id);
      if (addr) {
        const parts = [];
        if (addr.addressLine1) parts.push(addr.addressLine1);
        if (addr.addressLine2) parts.push(addr.addressLine2);
        const loc = [];
        if (addr.postalCode) loc.push(addr.postalCode);
        if (addr.city) loc.push(addr.city);
        if (loc.length) parts.push(loc.join(' '));
        addresses.postalAddress = parts.join(', ');
      }
    }
    
    console.log(`✅ [ADMIN CUSTOMERS] Fetched addresses for ${customerId}:`, {
      physicalAddress: addresses.physicalAddress || 'none',
      postalAddress: addresses.postalAddress || 'none'
    });
    
    res.json(addresses);
    
  } catch (error) {
    console.error(`❌ [ADMIN CUSTOMERS] Error fetching addresses:`, error.message);
    res.status(500).json({ 
      error: 'Failed to fetch addresses',
      details: error.message 
    });
  }
});

console.log('✅ [ADMIN CUSTOMERS] Route module loaded');

module.exports = router;
