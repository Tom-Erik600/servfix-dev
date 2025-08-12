const express = require('express');
const db = require('../config/database');

const router = express.Router();

// Middleware - sjekk auth
router.use((req, res, next) => {
  if (!req.session.technicianId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
});

// GET all customers from Tripletex (for teknikere)
router.get('/tripletex', async (req, res) => {
  try {
    const tripletexService = require('../services/tripletexService');
    
    console.log('🔍 Technician requesting Tripletex customers...');
    
    const customers = await tripletexService.getCustomers({
      from: 0,
      count: 1000
    });
    
    // Transform Tripletex data til forventet format (samme som admin endpoint)
    const transformedCustomers = customers.map(customer => ({
      id: String(customer.id), // Konverter alltid til string
      name: customer.name,
      customerNumber: customer.customerNumber,
      organizationNumber: customer.organizationNumber,
      
      // Kontaktinfo
      contact: customer.customerContact 
        ? `${customer.customerContact.firstName || ''} ${customer.customerContact.lastName || ''}`.trim()
        : '',
      email: customer.email || customer.customerContact?.email || '',
      phone: customer.phoneNumber || customer.phoneNumberMobile || '',
      
      // Adresser
      physicalAddress: customer.physicalAddress 
        ? `${customer.physicalAddress.addressLine1 || ''} ${customer.physicalAddress.addressLine2 || ''}, ${customer.physicalAddress.postalCode || ''} ${customer.physicalAddress.city || ''}`.trim()
        : '',
      postalAddress: customer.postalAddress 
        ? `${customer.postalAddress.addressLine1 || ''} ${customer.postalAddress.addressLine2 || ''}, ${customer.postalAddress.postalCode || ''} ${customer.postalAddress.city || ''}`.trim()
        : '',
      
      // Andre felter
      currency: customer.currency?.id || 'NOK',
      language: customer.language?.id || 'NO',
      isCustomer: customer.isCustomer,
      isSupplier: customer.isSupplier,
      isPrivate: customer.isPrivateIndividual || false,
      customerAccountManager: customer.accountManager?.name || '',
      
      // Ekstra data
      invoiceEmail: customer.invoiceEmail || '',
      overdueNoticeEmail: customer.overdueNoticeEmail || ''
    }));
    
    console.log(`✅ Loaded ${transformedCustomers.length} customers from Tripletex for technician`);
    res.json(transformedCustomers);
    
  } catch (error) {
    console.error('Error fetching customers from Tripletex for technician:', error);
    res.status(500).json({ error: 'Kunne ikke hente kunder fra Tripletex' });
  }
});

// POST create new order (for teknikere)

// Hent ALLE unike kunder fra orders (ikke filtrert på tekniker)
router.get('/', async (req, res) => {
  try {
    const pool = await db.getTenantConnection(req.session.tenantId);
    
    const result = await pool.query(
      `SELECT DISTINCT 
        customer_id as id,
        customer_name as name,
        customer_data
       FROM orders 
       WHERE customer_id IS NOT NULL
       ORDER BY customer_name`
    );
    
    const customers = result.rows.map(row => ({
      id: row.id,
      name: row.name || 'Ukjent kunde',
      ...(row.customer_data || {})
    }));
    
    res.json(customers);
    
  } catch (error) {
    console.error('Error fetching customers:', error);
    // Returner tom array i stedet for 500 for å holde appen kjørende
    res.json([]); 
  }
});

module.exports = router;