const db = require('../config/database');

/**
 * CustomerService — CRUD-operasjoner mot lokal customers-tabell.
 * ServFix er master, Tripletex er importkilde.
 */
class CustomerService {

  /**
   * Hent alle kunder for en tenant.
   * Returnerer samme shape som den gamle Tripletex-ruten for bakoverkompatibilitet.
   */
  async getCustomers(tenantId) {
    const pool = await db.getTenantConnection(tenantId);
    const result = await pool.query(
      `SELECT id, name, organization_number, customer_number,
              physical_address, postal_address,
              phone, email, invoice_email,
              external_source, external_id,
              notes, is_active,
              created_at, updated_at
       FROM customers
       WHERE is_active = true
       ORDER BY name`
    );
    return result.rows;
  }

  /**
   * Hent én kunde med ID.
   */
  async getCustomer(tenantId, customerId) {
    const pool = await db.getTenantConnection(tenantId);
    const result = await pool.query(
      `SELECT id, name, organization_number, customer_number,
              physical_address, postal_address,
              phone, email, invoice_email,
              external_source, external_id,
              notes, is_active,
              created_at, updated_at
       FROM customers
       WHERE id = $1`,
      [customerId]
    );
    return result.rows[0] || null;
  }

  /**
   * Hent kunde basert på Tripletex external_id.
   */
  async getCustomerByExternalId(tenantId, tripletexId) {
    const pool = await db.getTenantConnection(tenantId);
    const result = await pool.query(
      `SELECT id, name, organization_number, customer_number,
              physical_address, postal_address,
              phone, email, invoice_email,
              external_source, external_id,
              notes, is_active,
              created_at, updated_at
       FROM customers
       WHERE external_source = 'tripletex' AND external_id = $1`,
      [String(tripletexId)]
    );
    return result.rows[0] || null;
  }

  /**
   * Oppdater kundedata. Setter updated_at automatisk.
   * Kun oppdaterer felter som er oppgitt i data-objektet.
   */
  async updateCustomer(tenantId, customerId, data) {
    const pool = await db.getTenantConnection(tenantId);
    const allowedFields = [
      'name', 'organization_number', 'customer_number',
      'physical_address', 'postal_address',
      'phone', 'email', 'invoice_email',
      'notes', 'is_active'
    ];

    const setClauses = [];
    const values = [];
    let paramIndex = 1;

    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        setClauses.push(`${field} = $${paramIndex}`);
        values.push(data[field]);
        paramIndex++;
      }
    }

    if (setClauses.length === 0) {
      return this.getCustomer(tenantId, customerId);
    }

    // updated_at settes automatisk for å markere lokale endringer
    setClauses.push(`updated_at = NOW()`);
    values.push(customerId);

    const result = await pool.query(
      `UPDATE customers SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );
    return result.rows[0] || null;
  }

  /**
   * Hent alle kontaktpersoner for en kunde.
   */
  async getContacts(tenantId, customerId) {
    const pool = await db.getTenantConnection(tenantId);
    const result = await pool.query(
      `SELECT id, customer_id, name, email, phone, role,
              is_report_recipient, created_at, updated_at
       FROM customer_contacts
       WHERE customer_id = $1
       ORDER BY is_report_recipient DESC, name`,
      [customerId]
    );
    return result.rows;
  }

  /**
   * Opprett ny kontaktperson for kunde.
   */
  async createContact(tenantId, customerId, data) {
    const pool = await db.getTenantConnection(tenantId);
    const result = await pool.query(
      `INSERT INTO customer_contacts (customer_id, name, email, phone, role, is_report_recipient)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        customerId,
        data.name || '',
        data.email || '',
        data.phone || '',
        data.role || '',
        data.is_report_recipient || false
      ]
    );
    return result.rows[0];
  }

  /**
   * Oppdater kontaktperson.
   */
  async updateContact(tenantId, contactId, data) {
    const pool = await db.getTenantConnection(tenantId);
    const allowedFields = ['name', 'email', 'phone', 'role', 'is_report_recipient'];
    const setClauses = [];
    const values = [];
    let paramIndex = 1;

    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        setClauses.push(`${field} = $${paramIndex}`);
        values.push(data[field]);
        paramIndex++;
      }
    }

    if (setClauses.length === 0) {
      return null;
    }

    setClauses.push(`updated_at = NOW()`);
    values.push(contactId);

    const result = await pool.query(
      `UPDATE customer_contacts SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );
    return result.rows[0] || null;
  }

  /**
   * Slett kontaktperson.
   */
  async deleteContact(tenantId, contactId) {
    const pool = await db.getTenantConnection(tenantId);
    const result = await pool.query(
      `DELETE FROM customer_contacts WHERE id = $1 RETURNING id`,
      [contactId]
    );
    return result.rows.length > 0;
  }

  /**
   * UPSERT kontaktperson basert på (customer_id, email).
   * Hvis kontakten finnes fra før, oppdateres navn/telefon/rolle —
   * men is_report_recipient berøres IKKE (bruker styrer dette manuelt).
   * Brukes ved import fra Tripletex.
   */
  async upsertContact(tenantId, customerId, data) {
    const pool = await db.getTenantConnection(tenantId);
    const result = await pool.query(
      `INSERT INTO customer_contacts (customer_id, name, email, phone, role, is_report_recipient)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (customer_id, email) DO UPDATE SET
         name  = CASE WHEN EXCLUDED.name  <> '' THEN EXCLUDED.name  ELSE customer_contacts.name  END,
         phone = CASE WHEN EXCLUDED.phone <> '' THEN EXCLUDED.phone ELSE customer_contacts.phone END,
         role  = CASE WHEN EXCLUDED.role  <> '' THEN EXCLUDED.role  ELSE customer_contacts.role  END,
         updated_at = NOW()
       RETURNING *`,
      [
        customerId,
        data.name || '',
        data.email || '',
        data.phone || '',
        data.role || '',
        data.is_report_recipient || false
      ]
    );
    return result.rows[0];
  }

  /**
   * Hent rapport-mottaker (is_report_recipient = true) for en kunde.
   * Returnerer første mottaker — beholdt for bakoverkompatibilitet.
   */
  async getReportRecipient(tenantId, customerId) {
    const recipients = await this.getReportRecipients(tenantId, customerId);
    return recipients[0] || null;
  }

  /**
   * Hent ALLE rapport-mottakere (is_report_recipient = true) for en kunde.
   */
  async getReportRecipients(tenantId, customerId) {
    const pool = await db.getTenantConnection(tenantId);
    const result = await pool.query(
      `SELECT id, name, email, phone
       FROM customer_contacts
       WHERE customer_id = $1 AND is_report_recipient = true
       ORDER BY id`,
      [customerId]
    );
    return result.rows;
  }

  /**
   * Hent rapport-mottaker basert på customer_id fra orders-tabellen.
   * Prøver først direkte oppslag (nye ordrer med lokal ID),
   * deretter via external_id (gamle ordrer med Tripletex ID).
   * Drop-in erstatning for tripletexService.getServfixmailContact().
   * Returnerer første mottaker — beholdt for bakoverkompatibilitet.
   */
  async getReportRecipientByExternalId(tenantId, customerId) {
    const recipients = await this.getReportRecipientsByExternalId(tenantId, customerId);
    return recipients[0] || null;
  }

  /**
   * Hent ALLE rapport-mottakere basert på customer_id fra orders-tabellen.
   * Prøver først direkte oppslag (nye ordrer med lokal ID),
   * deretter via external_id (gamle ordrer med Tripletex ID).
   */
  async getReportRecipientsByExternalId(tenantId, customerId) {
    const pool = await db.getTenantConnection(tenantId);

    // 1. Prøv direkte oppslag (lokal customer.id)
    const direct = await pool.query(
      `SELECT cc.id, cc.name, cc.email, cc.phone
       FROM customer_contacts cc
       WHERE cc.customer_id = $1 AND cc.is_report_recipient = true
       ORDER BY cc.id`,
      [customerId]
    );
    if (direct.rows.length > 0) return direct.rows;

    // 2. Fallback: oppslag via Tripletex external_id (gamle ordrer)
    const byExternal = await pool.query(
      `SELECT cc.id, cc.name, cc.email, cc.phone
       FROM customer_contacts cc
       JOIN customers c ON c.id = cc.customer_id
       WHERE c.external_source = 'tripletex'
         AND c.external_id = $1
         AND cc.is_report_recipient = true
       ORDER BY cc.id`,
      [String(customerId)]
    );
    return byExternal.rows;
  }
}

module.exports = new CustomerService();
