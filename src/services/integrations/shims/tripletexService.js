'use strict';

/**
 * Tripletex shim — backward-compatible drop-in for the old singleton.
 *
 * IMPORTANT: getApiClient() is NOT exported. All call sites must use
 * withClient(tenantId, async (client) => { ... }) directly.
 * This was a prerequisite from the architecture review.
 *
 * @deprecated individual method wrappers — import withClient from
 *   '../integrations/tripletex/provider' directly in new code.
 *   This shim will be removed in Phase 2.
 */

const { withClient } = require('../tripletex/provider');

// Re-export withClient as primary API
module.exports.withClient = withClient;

/**
 * Fetch all customers (with pagination params).
 * @param {string} tenantId
 * @param {{ from?: number, count?: number }} params
 */
module.exports.getCustomers = (tenantId, params = {}) =>
  withClient(tenantId, (client) =>
    client
      .get('/customer', {
        params: { from: params.from || 0, count: params.count || 100, ...params },
      })
      .then((r) => r.data.values)
  );

/**
 * Fetch a single customer by Tripletex ID.
 * @param {string} tenantId
 * @param {string|number} customerId
 */
module.exports.getCustomer = (tenantId, customerId) =>
  withClient(tenantId, (client) =>
    client.get(`/customer/${customerId}`).then((r) => r.data.value)
  );

/**
 * Fetch an address by Tripletex address ID. Returns null if not found or on error.
 * @param {string} tenantId
 * @param {string|number|null} addressId
 */
module.exports.getAddress = async (tenantId, addressId) => {
  if (!addressId) return null;
  try {
    return await withClient(tenantId, (client) =>
      client.get(`/address/${addressId}`).then((r) => r.data.value)
    );
  } catch (err) {
    console.error(`[tripletexService] Error fetching address ${addressId}:`, err.message);
    return null;
  }
};

/**
 * Fetch all contacts for a Tripletex customer. Returns [] on error.
 * @param {string} tenantId
 * @param {string|number} tripletexCustomerId
 */
module.exports.getCustomerContacts = async (tenantId, tripletexCustomerId) => {
  try {
    const contacts = await withClient(tenantId, (client) =>
      client
        .get('/contact', {
          params: { customerId: tripletexCustomerId, from: 0, count: 100 },
        })
        .then((r) => (r.data && r.data.values ? r.data.values : []))
    );
    return contacts;
  } catch (err) {
    console.error(
      `[tripletexService] Error fetching contacts for customer ${tripletexCustomerId}:`,
      err.message
    );
    return [];
  }
};

/**
 * Find the "servfixmail" contact (lastName === 'servfixmail') for a customer.
 * Returns the contact object with .email if found, null otherwise.
 * @param {string} tenantId
 * @param {string|number} tripletexCustomerId
 */
module.exports.getServfixmailContact = async (tenantId, tripletexCustomerId) => {
  try {
    const contacts = await module.exports.getCustomerContacts(tenantId, tripletexCustomerId);
    const match = contacts.find(
      (c) => c.lastName && c.lastName.toLowerCase() === 'servfixmail'
    );
    return match && match.email ? match : null;
  } catch (err) {
    console.error(
      `[tripletexService] Error finding servfixmail contact for ${tripletexCustomerId}:`,
      err.message
    );
    return null;
  }
};
