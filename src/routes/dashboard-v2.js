const express = require('express');
const db = require('../config/database');
const { requireTenant } = require('../middleware/auth');

const router = express.Router();

router.use((req, res, next) => {
  if (!req.session.technicianId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
});
router.use(requireTenant);

function toISODateString(date) {
  if (!date) return null;

  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return date;
  }

  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return null;

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function deriveOrderStatus(order) {
  if (order.status === 'completed') return 'completed';
  if (order.hasInProgressEquipment) return 'in_progress';
  if (order.allEquipmentCompleted && order.equipmentCount > 0) return 'completed';
  return order.status || 'scheduled';
}

function normalizeCustomerData(rawCustomerData, row) {
  let customerData = rawCustomerData;

  if (typeof customerData === 'string') {
    try {
      customerData = JSON.parse(customerData);
    } catch (error) {
      customerData = {};
    }
  }

  customerData = customerData || {};

  if (!customerData.contact && row.contact_name) {
    customerData.contact = row.contact_name;
  }

  if (!customerData.contactPhone && row.contact_phone) {
    customerData.contactPhone = row.contact_phone;
  }

  if (!customerData.contactEmail && row.contact_email) {
    customerData.contactEmail = row.contact_email;
  }

  if (!customerData.phone && row.customer_phone) {
    customerData.phone = row.customer_phone;
  }

  if (!customerData.email && row.customer_email) {
    customerData.email = row.customer_email;
  }

  if (!customerData.physicalAddress && row.customer_physical_address) {
    customerData.physicalAddress = row.customer_physical_address;
  }

  return customerData;
}

function formatOrderNumber(orderId) {
  const parts = String(orderId || '').split('-');
  if (parts.length >= 3) {
    return `SO-${parts[1]}-${parts[2].slice(-6)}`;
  }
  return String(orderId || '');
}

function getWeekRange(baseDate) {
  const current = new Date(baseDate);
  const day = current.getDay();
  const offset = day === 0 ? 6 : day - 1;
  current.setDate(current.getDate() - offset);

  const start = new Date(current);
  const end = new Date(current);
  end.setDate(end.getDate() + 6);

  return { start, end };
}

function getMonthRange(baseDate) {
  const start = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
  const end = new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 0);
  return { start, end };
}

function buildCalendarSummary(orders) {
  return orders.reduce((summary, order) => {
    if (!order.scheduledDate) return summary;

    const existing = summary[order.scheduledDate] || {
      date: order.scheduledDate,
      total: 0,
      completed: 0,
      inProgress: 0,
      scheduled: 0,
      status: 'scheduled'
    };

    existing.total += 1;

    if (order.derivedStatus === 'completed') {
      existing.completed += 1;
    } else if (order.derivedStatus === 'in_progress') {
      existing.inProgress += 1;
    } else {
      existing.scheduled += 1;
    }

    if (existing.inProgress > 0) {
      existing.status = 'in_progress';
    } else if (existing.completed === existing.total) {
      existing.status = 'completed';
    } else {
      existing.status = 'scheduled';
    }

    summary[order.scheduledDate] = existing;
    return summary;
  }, {});
}

router.get('/', async (req, res) => {
  try {
    const tenantId = req.session.tenantId;
    const technicianId = req.session.technicianId;
    const pool = await db.getTenantConnection(tenantId);

    const selectedDate = toISODateString(req.query.date) || toISODateString(new Date());
    const currentView = req.query.view === 'month' ? 'month' : 'week';
    const periodBase = req.query.period ? new Date(req.query.period) : new Date(selectedDate);
    const safePeriodBase = Number.isNaN(periodBase.getTime()) ? new Date(selectedDate) : periodBase;
    const periodRange = currentView === 'month' ? getMonthRange(safePeriodBase) : getWeekRange(safePeriodBase);
    const today = toISODateString(new Date());

    const result = await pool.query(
      `SELECT
          o.id,
          o.customer_id,
          o.customer_name,
          o.customer_data,
          o.technician_id,
          o.scheduled_date,
          o.scheduled_time,
          o.service_type,
          o.status,
          o.description,
          COALESCE(c.name, o.customer_name, 'Ukjent kunde') AS resolved_customer_name,
          c.phone AS customer_phone,
          c.email AS customer_email,
          c.physical_address AS customer_physical_address,
          pc.name AS contact_name,
          pc.phone AS contact_phone,
          pc.email AS contact_email,
          COALESCE(eq.equipment_count, 0) AS equipment_count,
          COALESCE(eq.completed_count, 0) AS equipment_completed_count,
          COALESCE(eq.has_in_progress, false) AS has_in_progress_equipment
       FROM orders o
       LEFT JOIN LATERAL (
         SELECT c.id, c.name, c.phone, c.email, c.physical_address
         FROM customers c
         WHERE c.is_active = true
           AND (
             c.id::text = o.customer_id::text OR
             (c.external_source = 'tripletex' AND c.external_id = o.customer_id::text)
           )
         ORDER BY CASE WHEN c.id::text = o.customer_id::text THEN 0 ELSE 1 END
         LIMIT 1
       ) c ON true
       LEFT JOIN LATERAL (
         SELECT cc.name, cc.phone, cc.email
         FROM customer_contacts cc
         WHERE cc.customer_id = c.id
         ORDER BY cc.is_report_recipient ASC, cc.id ASC
         LIMIT 1
       ) pc ON true
       LEFT JOIN LATERAL (
         SELECT
           COUNT(*) AS equipment_count,
           COUNT(*) FILTER (WHERE COALESCE(sr.status, 'not_started') = 'completed') AS completed_count,
           BOOL_OR(COALESCE(sr.status, 'not_started') = 'in_progress') AS has_in_progress
         FROM equipment e
         LEFT JOIN service_reports sr ON sr.equipment_id = e.id AND sr.order_id = o.id
         WHERE e.status = 'active'
           AND e.customer_id = CASE
             WHEN o.customer_id::text ~ '^[0-9]+$' THEN o.customer_id::integer
             ELSE NULL
           END
       ) eq ON true
       WHERE o.technician_id = $1
       ORDER BY o.scheduled_date DESC NULLS LAST, o.scheduled_time DESC NULLS LAST`,
      [technicianId]
    );

    const normalizedOrders = result.rows.map((row) => {
      const scheduledDate = toISODateString(row.scheduled_date);
      const order = {
        id: row.id,
        customerId: row.customer_id,
        customerName: row.resolved_customer_name,
        customerData: normalizeCustomerData(row.customer_data, row),
        technicianId: row.technician_id,
        scheduledDate,
        scheduledTime: row.scheduled_time || null,
        serviceType: row.service_type || 'Service',
        orderNumber: formatOrderNumber(row.id),
        status: row.status || 'scheduled',
        description: row.description || 'Ingen beskrivelse',
        equipmentCount: Number(row.equipment_count || 0),
        equipmentCompletedCount: Number(row.equipment_completed_count || 0),
        hasInProgressEquipment: Boolean(row.has_in_progress_equipment)
      };

      order.allEquipmentCompleted = order.equipmentCount > 0 && order.equipmentCompletedCount === order.equipmentCount;
      order.derivedStatus = deriveOrderStatus(order);
      return order;
    });

    const calendarSummary = buildCalendarSummary(normalizedOrders);

    const selectedDateOrders = normalizedOrders.filter((order) => order.scheduledDate === selectedDate);
    const upcomingOrders = normalizedOrders.filter((order) => {
      if (!order.scheduledDate) return false;
      if (order.derivedStatus === 'completed') return false;
      const orderDate = new Date(`${order.scheduledDate}T12:00:00`);
      return order.scheduledDate >= today && orderDate <= periodRange.end;
    });
    const unfinishedOrders = normalizedOrders.filter((order) => order.derivedStatus === 'in_progress');

    res.json({
      header: {
        subtitle: 'Planlagte service'
      },
      filters: {
        selectedDate,
        currentView,
        periodStart: toISODateString(periodRange.start),
        periodEnd: toISODateString(periodRange.end)
      },
      orders: normalizedOrders,
      calendarSummary,
      cards: {
        selectedDate: selectedDateOrders,
        upcoming: upcomingOrders,
        unfinished: unfinishedOrders
      }
    });
  } catch (error) {
    console.error('Error loading dashboard v2:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
