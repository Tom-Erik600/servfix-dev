const express = require('express');
const db = require('../config/database');
const path = require('path');
const fs = require('fs').promises;

const router = express.Router();

// Middleware - sjekk auth
router.use((req, res, next) => {
  if (!req.session.technicianId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
});

// Hent alle ordrer for pålogget tekniker
router.get('/', async (req, res) => {
  try {
    const pool = await db.getTenantConnection(req.session.tenantId);
    console.log('Fetching orders for technicianId:', req.session.technicianId);
    
    const result = await pool.query(
      `SELECT * FROM orders 
       WHERE technician_id = $1 
       ORDER BY scheduled_date DESC, scheduled_time DESC`,
      [req.session.technicianId]
    );
    
    // Legg til orderNumber for frontend
    const ordersWithNumber = result.rows.map(order => ({
      ...order,
      orderNumber: `SO-${order.id.split('-')[1]}-${order.id.split('-')[2].slice(-6)}`
    }));
    
    // Berik ordre med equipment status
    const ordersWithEquipment = await Promise.all(ordersWithNumber.map(async (order) => {
        let equipment = []; // Initialize equipment here
        try {
            // Hent equipment for denne ordren
            const equipmentResult = await pool.query(
                `SELECT id, data->>'serviceStatus' as service_status 
                 FROM equipment 
                 WHERE customer_id = $1`,
                [order.customer_id]
            );
            
            equipment = equipmentResult.rows.map(eq => ({
                id: eq.id,
                serviceStatus: eq.service_status || 'not_started'
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
    console.error('Error fetching all orders:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Hent dagens ordrer
router.get('/today', async (req, res) => {
  try {
    const pool = await db.getTenantConnection(req.session.tenantId);
    const today = new Date().toISOString().split('T')[0];
    
    const result = await pool.query(
      `SELECT * FROM orders 
       WHERE technician_id = $1 
       AND scheduled_date = $2
       ORDER BY scheduled_time`,
      [req.session.technicianId, today]
    );
    
    // Legg til orderNumber for frontend
    const ordersWithNumber = result.rows.map(order => ({
      ...order,
      orderNumber: `SO-${order.id.split('-')[1]}-${order.id.split('-')[2].slice(-6)}`
    }));
    
    // Berik ordre med equipment status
    const ordersWithEquipment = await Promise.all(ordersWithNumber.map(async (order) => {
        try {
            // Hent equipment for denne ordren
            const equipmentResult = await pool.query(
                `SELECT id, data->>'serviceStatus' as service_status 
                 FROM equipment 
                 WHERE customer_id = $1`,
                [order.customer_id]
            );
            
            order.equipment = equipmentResult.rows.map(eq => ({
                id: eq.id,
                serviceStatus: eq.service_status || 'not_started'
            }));
            
        } catch (error) {
            console.log('Could not fetch equipment for order:', order.id);
            order.equipment = [];
        }
        
        return order;
    }));

    res.json(ordersWithEquipment);
    
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET single order
router.get('/:id', async (req, res) => {
  try {
    const pool = await db.getTenantConnection(req.session.tenantId);
    const orderResult = await pool.query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
    
    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    const order = orderResult.rows[0];
    order.orderNumber = `SO-${order.id.split('-')[1]}-${order.id.split('-')[2].slice(-6)}`;

    // Fetch customer data - sjekk om det finnes customer_data i ordre
    let customer = {
        id: order.customer_id,
        name: order.customer_name
    };

    // Hvis ordre har customer_data, bruk det
    if (order.customer_data && typeof order.customer_data === 'object') {
        customer = {
            ...customer,
            ...order.customer_data
        };
    }

// Prøv å hente fullstendig kundeinformasjon fra Tripletex
try {
    const tripletexService = require('../../services/tripletexService');
    const customerDetails = await tripletexService.getCustomer(order.customer_id);
    
    if (customerDetails) {
        customer.contact = customerDetails.customerContact 
            ? `${customerDetails.customerContact.firstName || ''} ${customerDetails.customerContact.lastName || ''}`.trim()
            : '';
        customer.email = customerDetails.email || customerDetails.invoiceEmail || '';
        customer.phone = customerDetails.phoneNumber || customerDetails.phoneNumberMobile || '';
        customer.physicalAddress = customerDetails.physicalAddress 
            ? `${customerDetails.physicalAddress.addressLine1 || ''}, ${customerDetails.physicalAddress.postalCode || ''} ${customerDetails.physicalAddress.city || ''}`.trim()
            : '';
    }
} catch (error) {
    console.log('Could not fetch customer details from Tripletex:', error.message);
    // Fortsett med grunnleggende kundeinfo
}

    // Hvis ikke, prøv å hente fra customers tabell hvis den finnes
    // (Dette krever at du har en customers tabell, ellers skip denne delen)

    // Fetch equipment data for the customer
    const equipmentResult = await pool.query(
        `SELECT 
            id, 
            customer_id, 
            type, 
            name, 
            location, 
            data,
            data->>'serviceStatus' as service_status,
            data->>'systemNumber' as system_number,
            data->>'systemType' as system_type,
            data->>'operator' as operator
        FROM equipment 
        WHERE customer_id = $1`,
        [order.customer_id || order.customerId]
    );

    // Transform equipment data
    const equipment = equipmentResult.rows.map(eq => ({
        id: eq.id,
        customerId: eq.customer_id,
        type: eq.type,
        name: eq.name,
        location: eq.location,
        serviceStatus: eq.service_status || 'not_started',
        systemNumber: eq.system_number || '',
        systemType: eq.system_type || '',
        operator: eq.operator || '',
        data: eq.data
    }));

    // Fetch technician data (assuming technicianId is available in order or session)
    const technicianResult = await pool.query('SELECT * FROM technicians WHERE id = $1', [order.technician_id]);
    const technician = technicianResult.rows[0] || {};
    
    res.json({
      order: {
          ...order,
          customer_data: customer // Legg til customer data på ordre objektet
      },
      customer: customer,
      equipment: equipment,
      technician: technician,
      quotes: []
    });
    
  } catch (error) {
    console.error('Error fetching order:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT update order status
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    if (!status) {
      return res.status(400).json({ error: 'Status er påkrevd' });
    }
    
    const pool = await db.getTenantConnection(req.session.tenantId);
    
    const result = await pool.query(
      'UPDATE orders SET status = $1 WHERE id = $2 AND technician_id = $3 RETURNING *',
      [status, id, req.session.technicianId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Ordre ikke funnet eller tilhører ikke denne teknikeren' });
    }
    
    console.log(`Order ${id} updated to status: ${status}`);
    res.json(result.rows[0]);
    
  } catch (error) {
    console.error('Error updating order status:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

const ServiceReportPDFGenerator = require('../services/pdfGenerator');

// Generer rapporter når ordre ferdigstilles
router.post('/:orderId/complete', async (req, res) => {
  const { orderId } = req.params;
  const tenantId = req.tenantId || req.session.tenantId;
  
  if (!req.session.technicianId) {
    return res.status(401).json({ error: 'Ikke autentisert' });
  }

  try {
    const pool = await db.getTenantConnection(tenantId);
    
    // Start transaksjon
    await pool.query('BEGIN');
    
    // Oppdater ordre status til completed
    await pool.query(
      'UPDATE orders SET status = $1 WHERE id = $2',
      ['completed', orderId]
    );
    
    // Oppdater alle equipment til completed
    await pool.query(
      `UPDATE equipment 
       SET data = data || '{"serviceStatus": "completed"}'::jsonb 
       WHERE id IN (
         SELECT equipment_id FROM service_reports WHERE order_id = $1
       )`,
      [orderId]
    );
    
    // Hent alle service_reports for denne ordren
    const serviceReportsResult = await pool.query(
      `SELECT sr.*, e.type as equipment_type 
       FROM service_reports sr
       JOIN equipment e ON sr.equipment_id = e.id
       WHERE sr.order_id = $1 AND sr.status = 'completed'`,
      [orderId]
    );
    
    // Generer PDF-er for alle rapporter
    const pdfGenerator = new ServiceReportPDFGenerator();
    const generatedPDFs = [];
    
    for (const report of serviceReportsResult.rows) {
      try {
        console.log(`Genererer PDF for rapport ${report.id}...`);
        const pdfPath = await pdfGenerator.generateReport(report.id, tenantId);
        generatedPDFs.push({
          reportId: report.id,
          equipmentType: report.equipment_type,
          pdfPath: pdfPath
        });
        console.log(`✅ PDF generert: ${pdfPath}`);
      } catch (pdfError) {
        console.error(`❌ PDF-generering feilet for rapport ${report.id}:`, pdfError);
        // Fortsett med andre rapporter selv om en feiler
      }
    }
    
    await pdfGenerator.close();
    
    // Commit transaksjon
    await pool.query('COMMIT');
    
    console.log(`✅ Ordre ${orderId} ferdigstilt med ${generatedPDFs.length} PDF-rapporter`);
    
    res.json({
      success: true,
      message: 'Ordre ferdigstilt',
      generatedPDFs: generatedPDFs
    });
    
  } catch (error) {
    // Rollback ved feil
    try {
      const pool = await db.getTenantConnection(tenantId);
      await pool.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Rollback feilet:', rollbackError);
    }
    
    console.error('Feil ved ferdigstilling av ordre:', error);
    res.status(500).json({ error: 'Kunne ikke ferdigstille ordre' });
  }
});
module.exports = router;