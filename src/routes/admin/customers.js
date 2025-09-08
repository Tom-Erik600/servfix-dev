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
    
    // FORBEDRET Transform Tripletex data med null-safe adresse-håndtering
    const transformedCustomers = customers.map(customer => {
      
      // DEBUG: Log ALL address data for Ammerudslettas
      if (customer.name && customer.name.toLowerCase().includes('ammerudslettas')) {
        console.log('🏠 AMMERUDSLETTAS ADRESSE DEBUG:');
        console.log('Raw customer object keys:', Object.keys(customer));
        console.log('Raw physicalAddress:', JSON.stringify(customer.physicalAddress, null, 2));
        console.log('Raw postalAddress:', JSON.stringify(customer.postalAddress, null, 2));
        console.log('Raw deliveryAddress:', JSON.stringify(customer.deliveryAddress, null, 2));
        console.log('Raw addresses object:', JSON.stringify(customer.addresses, null, 2));
      }
      
      // Forbedret adresse-parsing som håndterer null/undefined
      const buildAddressString = (addressObj) => {
        if (!addressObj || typeof addressObj !== 'object') {
          return '';
        }
        
        const parts = [];
        
        // Legg til adresselinjer hvis de finnes
        if (addressObj.addressLine1) parts.push(addressObj.addressLine1);
        if (addressObj.addressLine2) parts.push(addressObj.addressLine2);
        
        // Legg til postnummer og sted
        const location = [];
        if (addressObj.postalCode) location.push(addressObj.postalCode);
        if (addressObj.city) location.push(addressObj.city);
        if (location.length > 0) parts.push(location.join(' '));
        
        return parts.filter(part => part && part.trim()).join(', ');
      };
      
      // Forbedret kontaktperson-parsing
      const getContactName = () => {
        if (!customer.customerContact) return '';
        
        const firstName = customer.customerContact.firstName || '';
        const lastName = customer.customerContact.lastName || '';
        const fullName = `${firstName} ${lastName}`.trim();
        
        return fullName;
      };
      
      // Forbedret telefon-parsing med flere kilder
      const getPhoneNumber = () => {
        return customer.phoneNumber || 
               customer.phoneNumberMobile || 
               (customer.customerContact && customer.customerContact.phoneNumber) ||
               (customer.customerContact && customer.customerContact.phoneNumberMobile) ||
               '';
      };
      
      // Forbedret e-post parsing med flere kilder
      const getEmailAddress = () => {
        return customer.email || 
               customer.invoiceEmail || 
               customer.overdueNoticeEmail ||
               (customer.customerContact && customer.customerContact.email) || 
               '';
      };
      
      const transformed = {
        id: String(customer.id),
        name: customer.name || '',
        customerNumber: customer.customerNumber || '',
        organizationNumber: customer.organizationNumber || '',
        
        // FORBEDRET kontaktinfo
        contact: getContactName(),
        email: getEmailAddress(),
        phone: getPhoneNumber(),
        
        // FORBEDRET adresser med null-safe parsing
        physicalAddress: buildAddressString(customer.physicalAddress),
        postalAddress: buildAddressString(customer.postalAddress),
        
        // Andre felter
        currency: customer.currency?.id || 'NOK',
        language: customer.language?.id || 'NO',
        isCustomer: customer.isCustomer || false,
        isSupplier: customer.isSupplier || false,
        isPrivate: customer.isPrivateIndividual || false,
        customerAccountManager: customer.accountManager?.name || '',
        
        // Ekstra data
        invoiceEmail: customer.invoiceEmail || '',
        overdueNoticeEmail: customer.overdueNoticeEmail || ''
      };
      
      return transformed;
    });
    
    res.json(transformedCustomers);
    
  } catch (error) {
    console.error('Error fetching customers from Tripletex:', error);
    res.status(500).json({ error: 'Kunne ikke hente kunder fra Tripletex' });
  }
});

module.exports = router;