const express = require('express');
const router = express.Router();
const db = require('../../config/database');

// Middleware for å sette adminTenantId (beholdes fra tidligere)
router.use((req, res, next) => {
  if (!req.session.isAdmin) {
    return res.status(401).json({ error: 'Admin authentication required' });
  }
  
  req.adminTenantId = req.headers['x-tenant-id'] || 
                      req.query.tenantId || 
                      req.session.selectedTenantId || 
                      'airtech'; // default
  
  if (req.headers['x-tenant-id'] || req.query.tenantId) {
    req.session.selectedTenantId = req.adminTenantId;
  }
  
  next();
});

// GET all orders for the selected tenant
// GET all orders
router.get('/', async (req, res) => {
  try {
    const pool = await db.getTenantConnection(req.session.tenantId);
    
    const result = await pool.query(
      `SELECT o.*, t.name as technician_name
   FROM orders o
   LEFT JOIN technicians t ON o.technician_id = t.id
   ORDER BY o.scheduled_date DESC, o.scheduled_time DESC`
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
                    COALESCE(sr.status, 'not_started') as service_status,
                    COALESCE(sr.status, 'not_started') as service_report_status
                FROM equipment e
                LEFT JOIN service_reports sr ON (sr.equipment_id = e.id AND sr.order_id = $2)
                WHERE e.customer_id = $1`,
                [order.customer_id, order.id]
            );

            equipment = equipmentResult.rows.map(eq => ({
                id: eq.id,
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
      includedEquipmentIds
    } = req.body;
    
    console.log('=== CREATE ORDER REQUEST ===');
    console.log('Body:', req.body);
    console.log('includedEquipmentIds:', includedEquipmentIds);
    console.log('Type:', typeof includedEquipmentIds);
    console.log('Is Array:', Array.isArray(includedEquipmentIds));
    
    if (!customerId || !customerName) {
      return res.status(400).json({ error: 'Customer ID and name are required' });
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
        included_equipment_ids
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
        $10::jsonb
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
  equipmentIdsJsonString
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
module.exports = router;