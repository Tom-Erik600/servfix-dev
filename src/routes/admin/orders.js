const express = require('express');
const router = express.Router();
const db = require('../../config/database');
const adminTenant = require('../../middleware/admin-tenant');

// 🔒 Delt middleware: Admin auth + tenant-isolasjon med validering
router.use(adminTenant);

// GET all orders for the selected tenant
// GET all orders - støtter dateFrom, dateTo og status filtrering
router.get('/', async (req, res) => {
  try {
    const pool = await db.getTenantConnection(req.session.tenantId);

    // Hent query parametre for filtrering
    const { dateFrom, dateTo, status } = req.query;

    // Bygg WHERE-klausul dynamisk
    let whereConditions = [];
    let queryParams = [];
    let paramIndex = 1;

    if (dateFrom) {
      whereConditions.push(`o.scheduled_date >= $${paramIndex}::date`);
      queryParams.push(dateFrom);
      paramIndex++;
    }

    if (dateTo) {
      whereConditions.push(`o.scheduled_date <= $${paramIndex}::date`);
      queryParams.push(dateTo);
      paramIndex++;
    }

    if (status) {
      // Støtt kommaseparerte statuser
      const statuses = status.split(',').map(s => s.trim());
      const statusPlaceholders = statuses.map((_, i) => `$${paramIndex + i}`).join(', ');
      whereConditions.push(`o.status IN (${statusPlaceholders})`);
      queryParams.push(...statuses);
      paramIndex += statuses.length;
    }

    const whereClause = whereConditions.length > 0
      ? `WHERE ${whereConditions.join(' AND ')}`
      : '';

    const result = await pool.query(
      `SELECT o.*, t.name as technician_name,
              o.customer_data->>'physicalAddress' as delivery_address,
              pc.name AS contact_name,
              pc.phone AS contact_phone,
              pc.email AS contact_email,
              EXISTS (
                SELECT 1
                FROM service_reports sr
                WHERE sr.order_id = o.id
              ) AS has_service_reports,
              EXISTS (
                SELECT 1
                FROM quotes q
                WHERE q.order_id = o.id
              ) AS has_quotes
       FROM orders o
       LEFT JOIN technicians t ON o.technician_id = t.id
       LEFT JOIN LATERAL (
         SELECT cc.name, cc.phone, cc.email
         FROM customer_contacts cc
         WHERE cc.customer_id = CASE
           WHEN o.customer_id::text ~ '^[0-9]+$' THEN o.customer_id::integer
           ELSE NULL
         END
         ORDER BY cc.is_report_recipient DESC, cc.id ASC
         LIMIT 1
       ) pc ON true
       ${whereClause}
       ORDER BY o.scheduled_date DESC, o.scheduled_time DESC`,
      queryParams
    );
    
    // Legg til orderNumber for frontend
    const ordersWithNumber = result.rows.map(order => ({
      ...order,
      orderNumber: `SO-${order.id.split('-')[1]}-${order.id.split('-')[2].slice(-6)}`
    }));
    
    // === LEGG TIL: Berik ordre med equipment status (samme som tekniker API) ===
    const ordersWithEquipment = await Promise.all(ordersWithNumber.map(async (order) => {
        let equipment = []; // Initialize equipment
        try {
            // Hent equipment for denne ordren
            const equipmentResult = await pool.query(
                `SELECT 
                    e.id,
                    e.systemnavn,
                    e.systemtype,
                    COALESCE(sr.status, 'not_started') as service_status,
                    COALESCE(sr.status, 'not_started') as service_report_status
                FROM equipment e
                LEFT JOIN service_reports sr ON (sr.equipment_id = e.id AND sr.order_id = $2)
                WHERE e.customer_id = $1
                AND e.status = 'active'`,
                [order.customer_id, order.id]
            );

            equipment = equipmentResult.rows.map(eq => ({
                id: eq.id,
                name: eq.systemnavn || 'Ukjent system',
                type: eq.systemtype || '',
                serviceStatus: eq.service_status || 'not_started',
                serviceReportStatus: eq.service_report_status || 'not_started'
            }));
            
        } catch (error) {
            console.log('Could not fetch equipment for order:', order.id);
            // equipment remains empty array
        }
        
        return { // Return the modified order object
            ...order,
            equipment: equipment // Assign the fetched or empty equipment
        };
    }));

    res.json(ordersWithEquipment);
    
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Oppdatert POST route i src/routes/admin/orders.js
// Oppdatert POST route i src/routes/admin/orders.js med bedre error handling
// Oppdater POST route i src/routes/admin/orders.js

// POST create new order - OPPDATERT VERSJON
// Oppdatert POST route for src/routes/admin/orders.js
router.post('/', async (req, res) => {
  try {
    const { 
      customerId, 
      customerName, 
      customerData,
      description, 
      serviceType, 
      technicianId, 
      scheduledDate,
      includedEquipmentIds,
      serviceAddressStreet,
      serviceAddressPostalCode,
      serviceAddressCity
    } = req.body;
    
    console.log('=== CREATE ORDER REQUEST ===');
    console.log('Body:', req.body);
    console.log('includedEquipmentIds:', includedEquipmentIds);
    console.log('Type:', typeof includedEquipmentIds);
    console.log('Is Array:', Array.isArray(includedEquipmentIds));
    
    if (!customerId || !customerName || !technicianId) {
      return res.status(400).json({ error: 'Customer ID, name and technician are required' });
    }
    
    const pool = await db.getTenantConnection(req.session.tenantId);
    const orderId = `PROJ-${new Date().getFullYear()}-${Date.now()}`;
    
    // Opprett customer_data objekt
    const customer_data = {
      id: String(customerId),
      name: String(customerName),
      snapshot_date: new Date().toISOString()
    };
    
    // Merge med eksisterende customerData hvis sendt
    if (customerData && typeof customerData === 'object') {
      Object.assign(customer_data, customerData);
    }
    
    console.log('Customer data objekt:', customer_data);
    
    // Build INSERT query - bruk parameterisert query for JSONB
    const insertQuery = `
      INSERT INTO orders (
        id, 
        customer_id, 
        customer_name, 
        customer_data, 
        description, 
        service_type, 
        technician_id, 
        scheduled_date, 
        status, 
        included_equipment_ids,
        service_address_street,
        service_address_postal_code,
        service_address_city
      ) VALUES (
        $1, 
        $2::integer, 
        $3, 
        $4::jsonb, 
        $5, 
        $6, 
        $7, 
        $8::date, 
        $9, 
        $10::jsonb,
        $11,
        $12,
        $13
      ) RETURNING *
    `;
    
    // Håndter equipment IDs - konverter til JSON string for JSONB
    let equipmentIdsJsonString = null;
    if (includedEquipmentIds && Array.isArray(includedEquipmentIds) && includedEquipmentIds.length > 0) {
      // Konverter array til JSON string
      equipmentIdsJsonString = JSON.stringify(includedEquipmentIds);
    }
    
    console.log('Equipment IDs as JSON string:', equipmentIdsJsonString);
    
const params = [
  orderId,
  parseInt(customerId),
  String(customerName),
  JSON.stringify(customer_data),
  description || null,
  serviceType || 'Generell service',
  technicianId || null,
  scheduledDate || null,
  technicianId ? 'scheduled' : 'pending',
  equipmentIdsJsonString,
  serviceAddressStreet || null,
  serviceAddressPostalCode || null,
  serviceAddressCity || null
];
    
    console.log('INSERT params:');
    params.forEach((param, index) => {
      console.log(`Param ${index + 1}:`, param, 'Type:', typeof param);
    });
    
    // Kjør INSERT
    const result = await pool.query(insertQuery, params);
    
    // Legg til orderNumber for frontend
    result.rows[0].orderNumber = `SO-${orderId.split('-')[1]}-${orderId.split('-')[2].slice(-6)}`;
    
    console.log('Order created successfully:', {
      id: result.rows[0].id,
      included_equipment_ids: result.rows[0].included_equipment_ids
    });
    
    res.status(201).json(result.rows[0]);
    
  } catch (error) {
    console.error('=== ORDER CREATE ERROR ===');
    console.error('Error:', error);
    console.error('Error message:', error.message);
    console.error('Error detail:', error.detail);
    console.error('Error code:', error.code);
    console.error('Error stack:', error.stack);
    
    res.status(500).json({ 
      error: error.message,
      detail: error.detail || 'Se server logs for detaljer',
      code: error.code
    });
  }
});
// PUT /api/admin/orders/:id — endre dato/tid/tekniker på eksisterende ordre
router.put('/:id', async (req, res) => {
  try {
    const pool = await db.getTenantConnection(req.session.tenantId);
    const orderId = req.params.id;
    const { scheduledDate, scheduledTime, technicianId } = req.body;

    const orderResult = await pool.query(
      'SELECT id, status FROM orders WHERE id = $1',
      [orderId]
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Ordre ikke funnet' });
    }

    if (orderResult.rows[0].status === 'completed') {
      return res.status(409).json({ error: 'Kan ikke endre en fullført ordre' });
    }

    const fields = [];
    const params = [];
    let idx = 1;

    if (scheduledDate !== undefined) {
      fields.push(`scheduled_date = $${idx++}::date`);
      params.push(scheduledDate);
    }
    if (scheduledTime !== undefined) {
      fields.push(`scheduled_time = $${idx++}`);
      params.push(scheduledTime);
    }
    if (technicianId !== undefined) {
      fields.push(`technician_id = $${idx++}`);
      params.push(technicianId || null);
      if (orderResult.rows[0].status === 'pending' && technicianId) {
        fields.push(`status = $${idx++}`);
        params.push('scheduled');
      }
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'Ingen felter å oppdatere' });
    }

    params.push(orderId);
    const result = await pool.query(
      `UPDATE orders SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating order:', error);
    res.status(500).json({ error: 'Kunne ikke oppdatere ordre' });
  }
});

// DELETE order - hard delete, kun for pending/scheduled ordrer
router.delete('/:id', async (req, res) => {
  try {
    const pool = await db.getTenantConnection(req.session.tenantId);
    const orderId = req.params.id;

    // Hent ordren og sjekk at den finnes
    const orderResult = await pool.query('SELECT id, status FROM orders WHERE id = $1', [orderId]);
    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Ordre ikke funnet' });
    }

    const order = orderResult.rows[0];

    // Kun pending og scheduled kan slettes
    if (!['pending', 'scheduled'].includes(order.status)) {
      return res.status(400).json({ 
        error: `Kan ikke slette ordre med status "${order.status}". Kun ventende og planlagte ordrer kan slettes.` 
      });
    }

    // Sjekk om det finnes servicerapporter knyttet til ordren
    const reportsResult = await pool.query('SELECT COUNT(*) FROM service_reports WHERE order_id = $1', [orderId]);
    if (parseInt(reportsResult.rows[0].count) > 0) {
      return res.status(400).json({ error: 'Kan ikke slette ordre som har servicerapporter. Slett rapportene først.' });
    }

    // Sjekk om det finnes tilbud knyttet til ordren
    const quotesResult = await pool.query('SELECT COUNT(*) FROM quotes WHERE order_id = $1', [orderId]);
    if (parseInt(quotesResult.rows[0].count) > 0) {
      return res.status(400).json({ error: 'Kan ikke slette ordre som har tilbud. Slett tilbudene først.' });
    }

    // Hard delete av ordren
    await pool.query('DELETE FROM orders WHERE id = $1', [orderId]);

    console.log(`Order deleted: ${orderId} (status was: ${order.status})`);
    res.json({ message: 'Ordre slettet', orderId });

  } catch (error) {
    console.error('Error deleting order:', error);
    res.status(500).json({ error: 'Kunne ikke slette ordre. Prøv igjen.' });
  }
});

module.exports = router;
