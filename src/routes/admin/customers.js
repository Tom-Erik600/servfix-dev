const express = require('express');
const router = express.Router();
const tripletexService = require('../../services/tripletexService');

router.use((req, res, next) => {
  if (!req.session.isAdmin) {
    return res.status(401).json({ error: 'Admin authentication required' });
  }
  next();
});

// GET all customers from Tripletex
router.get('/', async (req, res) => {
  try {
    const customers = await tripletexService.getCustomers({
      from: 0,
      count: 1000
    });
    
    // Transform Tripletex data til forventet format
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
    
    res.json(transformedCustomers);
    
  } catch (error) {
    console.error('Error fetching customers from Tripletex:', error);
    res.status(500).json({ error: 'Kunne ikke hente kunder fra Tripletex' });
  }
});

module.exports = router;