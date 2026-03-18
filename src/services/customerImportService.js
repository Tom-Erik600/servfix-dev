const db = require('../config/database');
const tripletexService = require('./tripletexService');

/**
 * Importerer kunder fra Tripletex til lokal customers-tabell.
 * Tripletex er importkilde, ServFix er master.
 * Felt som er endret lokalt (updated_at > created_at) overskrives IKKE.
 */
class CustomerImportService {

  /**
   * Formaterer en Tripletex-adresse til lesbar streng.
   * Samme logikk som brukes i admin/customers.js.
   */
  formatAddress(addr) {
    if (!addr) return '';
    const parts = [];
    if (addr.addressLine1) parts.push(addr.addressLine1);
    if (addr.addressLine2) parts.push(addr.addressLine2);
    const loc = [];
    if (addr.postalCode) loc.push(addr.postalCode);
    if (addr.city) loc.push(addr.city);
    if (loc.length) parts.push(loc.join(' '));
    return parts.join(', ');
  }

  /**
   * Henter alle kunder fra Tripletex med paginering.
   * Samme paginering som i customers.js-ruten.
   */
  async fetchAllCustomersFromTripletex() {
    const allCustomers = [];
    const pageSize = 100;
    let currentPage = 0;
    let hasMore = true;

    while (hasMore) {
      console.log(`  📄 Henter side ${currentPage + 1} (fra: ${currentPage * pageSize})`);

      const customers = await tripletexService.getCustomers({
        from: currentPage * pageSize,
        count: pageSize
      });

      allCustomers.push(...customers);
      hasMore = customers.length === pageSize;
      currentPage++;
    }

    console.log(`  ✅ Hentet ${allCustomers.length} kunder fra Tripletex`);
    return allCustomers;
  }

  /**
   * Hovedmetode: Importer alle kunder fra Tripletex til lokal DB.
   *
   * @param {string} tenantId - Tenant-ID for database-tilkobling
   * @returns {{ imported: number, updated: number, skipped: number, contacts_created: number, errors: string[] }}
   */
  async importFromTripletex(tenantId) {
    const pool = await db.getTenantConnection(tenantId);
    const stats = { imported: 0, updated: 0, skipped: 0, contacts_created: 0, errors: [] };

    console.log(`\n🔄 Starter kundeimport for tenant: ${tenantId}`);

    // 1. Hent alle kunder fra Tripletex
    const tripletexCustomers = await this.fetchAllCustomersFromTripletex();

    for (const tc of tripletexCustomers) {
      try {
        await this.importSingleCustomer(pool, tc, stats);
      } catch (error) {
        const msg = `Kunde ${tc.id} (${tc.name}): ${error.message}`;
        console.error(`  ❌ ${msg}`);
        stats.errors.push(msg);
      }
    }

    console.log(`\n✅ Import ferdig:`, stats);
    return stats;
  }

  /**
   * Importer én kunde fra Tripletex til lokal DB.
   * Ved re-import: UPSERT basert på (external_source, external_id).
   * Overskriver IKKE felt som er endret lokalt.
   */
  async importSingleCustomer(pool, tc, stats) {
    const externalId = String(tc.id);

    // Hent begge adresser parallelt (2 API-kall → 1 runde)
    const [physicalAddr, postalAddr] = await Promise.all([
      tc.physicalAddress?.id ? tripletexService.getAddress(tc.physicalAddress.id) : null,
      tc.postalAddress?.id ? tripletexService.getAddress(tc.postalAddress.id) : null
    ]);
    const physicalAddress = this.formatAddress(physicalAddr);
    const postalAddress = this.formatAddress(postalAddr);

    // Kontaktperson fra Tripletex-customer-objektet
    const contactName = tc.customerContact
      ? `${tc.customerContact.firstName || ''} ${tc.customerContact.lastName || ''}`.trim()
      : '';

    // Sjekk om kunden allerede finnes lokalt
    const existing = await pool.query(
      `SELECT id, updated_at, created_at FROM customers
       WHERE external_source = 'tripletex' AND external_id = $1`,
      [externalId]
    );

    if (existing.rows.length > 0) {
      const row = existing.rows[0];

      // Hvis updated_at > created_at betyr det at noen har redigert lokalt — IKKE overskriv
      if (row.updated_at && row.created_at && row.updated_at > row.created_at) {
        console.log(`  ⏭️  Skipper ${tc.name} — endret lokalt`);
        stats.skipped++;
        return row.id;
      }

      // Oppdater med fersk Tripletex-data
      await pool.query(
        `UPDATE customers SET
          name = $1,
          organization_number = $2,
          customer_number = $3,
          physical_address = $4,
          postal_address = $5,
          phone = $6,
          email = $7,
          invoice_email = $8
        WHERE id = $9`,
        [
          tc.name || '',
          tc.organizationNumber || '',
          tc.customerNumber || '',
          physicalAddress,
          postalAddress,
          tc.phoneNumber || tc.phoneNumberMobile || '',
          tc.email || '',
          tc.invoiceEmail || '',
          row.id
        ]
      );
      console.log(`  🔄 Oppdatert: ${tc.name}`);
      stats.updated++;

      // Oppdater servfixmail-kontakt også for eksisterende kunder
      await this.importServfixmailContact(pool, tc.id, row.id, stats);

      return row.id;
    }

    // Ny kunde — INSERT
    const result = await pool.query(
      `INSERT INTO customers (
        name, organization_number, customer_number,
        physical_address, postal_address,
        phone, email, invoice_email,
        external_source, external_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'tripletex', $9)
      RETURNING id`,
      [
        tc.name || '',
        tc.organizationNumber || '',
        tc.customerNumber || '',
        physicalAddress,
        postalAddress,
        tc.phoneNumber || tc.phoneNumberMobile || '',
        tc.email || '',
        tc.invoiceEmail || '',
        externalId
      ]
    );

    const customerId = result.rows[0].id;
    console.log(`  ✅ Importert: ${tc.name} (id: ${customerId})`);
    stats.imported++;

    // Hent servfixmail-kontakt fra Tripletex og lagre som rapport-mottaker
    await this.importServfixmailContact(pool, tc.id, customerId, stats);

    return customerId;
  }

  /**
   * Preview: Sammenligner Tripletex-kunder med lokal DB uten å skrive.
   * Skipper adresseoppslag for ytelse (~10s i stedet for ~60s).
   *
   * @returns {{ new: object[], updated: object[], unchanged: number, total: number, errors: string[] }}
   */
  async previewImport(tenantId) {
    const pool = await db.getTenantConnection(tenantId);
    const result = { new: [], updated: [], unchanged: 0, total: 0, errors: [] };

    console.log(`\n🔍 Starter import-preview for tenant: ${tenantId}`);

    const tripletexCustomers = await this.fetchAllCustomersFromTripletex();
    result.total = tripletexCustomers.length;

    // Hent alle lokale kunder i én query
    const existingResult = await pool.query(
      `SELECT id, external_id, name, organization_number, customer_number,
              phone, email, invoice_email,
              physical_address, postal_address,
              updated_at, created_at
       FROM customers
       WHERE external_source = 'tripletex'`
    );

    const localMap = new Map();
    for (const row of existingResult.rows) {
      localMap.set(row.external_id, row);
    }

    for (const tc of tripletexCustomers) {
      try {
        const externalId = String(tc.id);
        const contactName = tc.customerContact
          ? `${tc.customerContact.firstName || ''} ${tc.customerContact.lastName || ''}`.trim()
          : '';
        const phone = tc.phoneNumber || tc.phoneNumberMobile || '';

        const local = localMap.get(externalId);

        if (!local) {
          result.new.push({
            tripletexId: externalId,
            name: tc.name || '',
            customerNumber: tc.customerNumber || '',
            organizationNumber: tc.organizationNumber || '',
            email: tc.email || '',
            phone: phone,
            contactPerson: contactName
          });
        } else {
          const locallyModified = local.updated_at && local.created_at
            && new Date(local.updated_at) > new Date(local.created_at);

          const fields = {
            name:                { old: local.name || '', new: tc.name || '' },
            organization_number: { old: local.organization_number || '', new: tc.organizationNumber || '' },
            customer_number:     { old: local.customer_number || '', new: tc.customerNumber || '' },
            phone:               { old: local.phone || '', new: phone },
            email:               { old: local.email || '', new: tc.email || '' },
            invoice_email:       { old: local.invoice_email || '', new: tc.invoiceEmail || '' }
          };

          const changes = {};
          for (const [key, val] of Object.entries(fields)) {
            if (String(val.old).trim() !== String(val.new).trim()) {
              changes[key] = val;
            }
          }

          if (Object.keys(changes).length > 0) {
            result.updated.push({
              tripletexId: externalId,
              localId: local.id,
              name: tc.name || '',
              customerNumber: tc.customerNumber || '',
              changes,
              locallyModified
            });
          } else {
            result.unchanged++;
          }
        }
      } catch (error) {
        result.errors.push(`Kunde ${tc.id} (${tc.name}): ${error.message}`);
      }
    }

    console.log(`✅ Preview ferdig: ${result.new.length} nye, ${result.updated.length} endret, ${result.unchanged} uendret`);
    return result;
  }

  /**
   * Importer kun valgte kunder fra Tripletex.
   * Re-henter fra Tripletex for fersk data, med adresseoppslag.
   */
  async applySelectedImport(tenantId, { newCustomerIds, updatedCustomerIds }) {
    const pool = await db.getTenantConnection(tenantId);
    const stats = { imported: 0, updated: 0, skipped: 0, contacts_created: 0, errors: [] };

    const selectedNew = new Set(newCustomerIds.map(String));
    const selectedUpdated = new Set(updatedCustomerIds.map(String));
    const totalSelected = selectedNew.size + selectedUpdated.size;

    console.log(`\n🔄 Starter selektiv import: ${selectedNew.size} nye, ${selectedUpdated.size} oppdateringer`);

    const tripletexCustomers = await this.fetchAllCustomersFromTripletex();

    // Filtrer til kun valgte kunder
    const selectedCustomers = tripletexCustomers.filter(tc => {
      const externalId = String(tc.id);
      return selectedNew.has(externalId) || selectedUpdated.has(externalId);
    });

    // Nullstill updated_at for oppdateringer (batch-query)
    if (selectedUpdated.size > 0) {
      const updatedIds = Array.from(selectedUpdated);
      await pool.query(
        `UPDATE customers SET updated_at = created_at
         WHERE external_source = 'tripletex' AND external_id = ANY($1::text[])`,
        [updatedIds]
      );
    }

    // Prosesser i parallelle batcher (5 om gangen for å unngå API rate-limiting)
    const BATCH_SIZE = 5;
    for (let i = 0; i < selectedCustomers.length; i += BATCH_SIZE) {
      const batch = selectedCustomers.slice(i, i + BATCH_SIZE);
      console.log(`  📦 Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(selectedCustomers.length / BATCH_SIZE)} (${batch.length} kunder)`);

      await Promise.all(batch.map(async (tc) => {
        try {
          await this.importSingleCustomer(pool, tc, stats);
        } catch (error) {
          const msg = `Kunde ${tc.id} (${tc.name}): ${error.message}`;
          console.error(`  ❌ ${msg}`);
          stats.errors.push(msg);
        }
      }));
    }

    console.log(`✅ Selektiv import ferdig:`, stats);
    return stats;
  }

  /**
   * Henter servfixmail-kontakt fra Tripletex og lagrer i customer_contacts.
   */
  async importServfixmailContact(pool, tripletexCustomerId, localCustomerId, stats) {
    try {
      const contact = await tripletexService.getServfixmailContact(tripletexCustomerId);

      if (contact && contact.email) {
        await pool.query(
          `INSERT INTO customer_contacts (
            customer_id, name, email, is_report_recipient
          ) VALUES ($1, $2, $3, true)
          ON CONFLICT (customer_id, email) DO UPDATE SET
            name = EXCLUDED.name,
            is_report_recipient = true`,
          [
            localCustomerId,
            `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || 'servfixmail',
            contact.email
          ]
        );
        console.log(`    📧 Kontakt lagret: ${contact.email}`);
        stats.contacts_created++;
      }
    } catch (error) {
      console.log(`    ⚠️  Kunne ikke hente servfixmail-kontakt: ${error.message}`);
    }
  }
}

module.exports = new CustomerImportService();
