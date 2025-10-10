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

// GET all customers (UTEN adresser for å unngå rate limiting)
router.get('/', async (req, res) => {
  console.log('🟢 [CUSTOMERS] GET all customers with pagination');
  
  try {
    const tripletexService = require('../services/tripletexService');
    const allCustomers = [];
    const pageSize = 100; // Hent 100 om gangen
    let currentPage = 0;
    let hasMore = true;
    
    while (hasMore) {
      console.log(`📄 Fetching page ${currentPage + 1} (from: ${currentPage * pageSize})`);
      
      const client = await tripletexService.getApiClient();
      const response = await client.get('/customer', {
        params: {
          from: currentPage * pageSize,
          count: pageSize
        }
      });
      
      const customers = response.data.values || [];
      allCustomers.push(...customers);
      
      console.log(`   ✅ Got ${customers.length} customers, total so far: ${allCustomers.length}`);
      
      // Sjekk om det er flere sider
      hasMore = customers.length === pageSize;
      currentPage++;
      
      // Legg inn delay mellom requests for å unngå rate limiting
      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay
      }
    }
    
    console.log(`✅ Total customers fetched: ${allCustomers.length}`);
    
    // Transform customers...
    const transformed = allCustomers.map(c => ({
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
    console.error('❌ [CUSTOMERS] Detailed error:', {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data,
      stack: error.stack
    });
    
    res.status(500).json({ 
      error: 'Failed to fetch customers',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// NY ENDPOINT: Hent adresser for EN spesifikk kunde (LAZY LOADING)
router.get('/:customerId/addresses', async (req, res) => {
  const { customerId } = req.params;
  console.log(`🟢 [CUSTOMERS] GET addresses for customer ${customerId}`);
  
  try {
    const tripletexService = require('../services/tripletexService');
    
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
    
    console.log(`✅ [CUSTOMERS] Fetched addresses for ${customerId}:`, {
      physicalAddress: addresses.physicalAddress || 'none',
      postalAddress: addresses.postalAddress || 'none'
    });
    
    res.json(addresses);
    
  } catch (error) {
    console.error(`❌ [CUSTOMERS] Error fetching addresses:`, error.message);
    res.status(500).json({ 
      error: 'Failed to fetch addresses',
      details: error.message 
    });
  }
});

console.log('✅ [CUSTOMERS] Route module loaded');

module.exports = router;
