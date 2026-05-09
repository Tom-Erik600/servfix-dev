const express = require('express');
const router = express.Router();
const db = require('../../config/database');
const adminTenant = require('../../middleware/admin-tenant');

// 🔒 Admin auth + tenant-isolasjon
router.use(adminTenant);

// ─────────────────────────────────────────────────────────────────
// Frekvens-algoritme
// Returnerer array av YYYY-MM-DD-strenger for alle ordredatoer
// innenfor regelens periode. Bruker lokal tid (new Date()) for å
// unngå UTC-glipp rundt midnatt / månedsskifter.
// ─────────────────────────────────────────────────────────────────
function toLocalDateString(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseLocalDate(str) {
  // str er YYYY-MM-DD (DATE fra pg kommer som Date-objekt eller ISO-string)
  if (str instanceof Date) {
    return new Date(str.getFullYear(), str.getMonth(), str.getDate());
  }
  const [y, m, d] = str.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

function expandDates(rule) {
  const {
    start_date,
    end_date,
    frequency_type,
    frequency_value,
    weekdays, // INTEGER[] fra pg — allerede JS-array
  } = rule;

  const start = parseLocalDate(start_date);
  const end   = parseLocalDate(end_date);
  const dates = [];

  if (start > end) return dates;

  switch (frequency_type) {

    case 'daily': {
      const cur = new Date(start);
      while (cur <= end) {
        dates.push(toLocalDateString(cur));
        cur.setDate(cur.getDate() + 1);
      }
      break;
    }

    case 'weekly': {
      const cur = new Date(start);
      while (cur <= end) {
        dates.push(toLocalDateString(cur));
        cur.setDate(cur.getDate() + 7);
      }
      break;
    }

    case 'monthly': {
      const targetDay = start.getDate();
      let year  = start.getFullYear();
      let month = start.getMonth(); // 0-indeksert

      while (true) {
        // Antall dager i denne måneden
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const day = Math.min(targetDay, daysInMonth);
        const cur = new Date(year, month, day);
        if (cur > end) break;
        if (cur >= start) dates.push(toLocalDateString(cur));
        month++;
        if (month > 11) { month = 0; year++; }
      }
      break;
    }

    case 'yearly': {
      const targetMonth = start.getMonth();
      const targetDay   = start.getDate();
      let year = start.getFullYear();

      while (true) {
        // Håndter 29. feb i ikke-skuddår
        const isLeap = (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0));
        const day = (targetMonth === 1 && targetDay === 29 && !isLeap) ? 28 : targetDay;
        const cur = new Date(year, targetMonth, day);
        if (cur > end) break;
        if (cur >= start) dates.push(toLocalDateString(cur));
        year++;
      }
      break;
    }

    case 'every_x_days': {
      const step = Math.max(1, parseInt(frequency_value) || 1);
      const cur  = new Date(start);
      while (cur <= end) {
        dates.push(toLocalDateString(cur));
        cur.setDate(cur.getDate() + step);
      }
      break;
    }

    case 'weekdays': {
      const allowed = new Set(Array.isArray(weekdays) ? weekdays.map(Number) : []);
      const cur = new Date(start);
      while (cur <= end) {
        if (allowed.has(cur.getDay())) {
          dates.push(toLocalDateString(cur));
        }
        cur.setDate(cur.getDate() + 1);
      }
      break;
    }

    default:
      break;
  }

  return dates;
}

// ─────────────────────────────────────────────────────────────────
// Validering av request-body
// ─────────────────────────────────────────────────────────────────
function validateRuleBody(body) {
  const {
    customerId, customerName,
    startDate, endDate,
    frequencyType, frequencyValue, weekdays,
    equipmentIds,
  } = body;

  if (!customerId)    return 'customerId er påkrevd';
  if (!customerName)  return 'customerName er påkrevd';
  if (!startDate)     return 'startDate er påkrevd';
  if (!endDate)       return 'endDate er påkrevd';

  const start = parseLocalDate(startDate);
  const end   = parseLocalDate(endDate);
  if (end < start)    return 'endDate må være lik eller etter startDate';

  const validTypes = ['daily','weekly','monthly','yearly','every_x_days','weekdays'];
  if (!validTypes.includes(frequencyType)) {
    return `frequencyType må være én av: ${validTypes.join(', ')}`;
  }

  if (frequencyType === 'every_x_days') {
    const val = parseInt(frequencyValue);
    if (!val || val < 1) return 'frequencyValue må være ≥ 1 for every_x_days';
  }

  if (frequencyType === 'weekdays') {
    if (!Array.isArray(weekdays) || weekdays.length === 0) {
      return 'weekdays (array av ukedager 0–6) er påkrevd for weekdays-frekvens';
    }
  }

  if (equipmentIds !== undefined && !Array.isArray(equipmentIds)) {
    return 'equipmentIds må være en array';
  }

  return null; // OK
}

// ─────────────────────────────────────────────────────────────────
// GET / — list alle regler for tenanten
// ─────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const pool = await db.getTenantConnection(req.adminTenantId);
    const result = await pool.query(
      `SELECT * FROM recurring_orders ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('❌ [RECURRING] GET / error:', err.message);
    res.status(500).json({ error: 'Kunne ikke hente perioderegler', details: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /:id — enkeltregel (brukes av "Kopier"-funksjon i UI)
// ─────────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const pool = await db.getTenantConnection(req.adminTenantId);
    const result = await pool.query(
      `SELECT * FROM recurring_orders WHERE id = $1`,
      [parseInt(req.params.id)]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Periorderegel ikke funnet' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('❌ [RECURRING] GET /:id error:', err.message);
    res.status(500).json({ error: 'Kunne ikke hente periorderegel', details: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// POST / — opprett ny regel (ingen ordrer opprettes her)
// ─────────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const {
    customerId, customerName, technicianId,
    equipmentIds, description, serviceType,
    serviceAddressStreet, serviceAddressPostalCode, serviceAddressCity,
    startDate, endDate,
    frequencyType, frequencyValue, weekdays, scheduledTime,
  } = req.body;

  const validationError = validateRuleBody(req.body);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  console.log(`📅 [RECURRING] POST ny regel: kunde=${customerId} freq=${frequencyType} ${startDate}→${endDate}`);

  try {
    const pool = await db.getTenantConnection(req.adminTenantId);
    const result = await pool.query(
       `INSERT INTO recurring_orders (
         customer_id, customer_name, technician_id,
         equipment_ids, description, service_type,
         service_address_street, service_address_postal_code, service_address_city,
         start_date, end_date,
         frequency_type, frequency_value, weekdays, scheduled_time
       ) VALUES (
         $1, $2, $3,
         $4::jsonb, $5, $6,
         $7, $8, $9,
         $10::date, $11::date,
         $12, $13, $14, $15
       ) RETURNING *`,
      [
        parseInt(customerId),
        String(customerName),
        technicianId ? String(technicianId) : null,
        JSON.stringify(equipmentIds || []),
        description || null,
        serviceType || 'Generell service',
        serviceAddressStreet || null,
        serviceAddressPostalCode || null,
        serviceAddressCity || null,
        startDate,
        endDate,
        frequencyType,
        frequencyValue ? parseInt(frequencyValue) : null,
        weekdays ? weekdays.map(Number) : null,
        scheduledTime || null,
      ]
    );

    console.log(`✅ [RECURRING] Regel opprettet: id=${result.rows[0].id}`);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('❌ [RECURRING] POST / error:', err.message);
    res.status(500).json({ error: 'Kunne ikke opprette periorderegel', details: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// PUT /:id — oppdater regel (påvirker ikke allerede genererte ordrer)
// ─────────────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  const {
    customerId, customerName, technicianId,
    equipmentIds, description, serviceType,
    serviceAddressStreet, serviceAddressPostalCode, serviceAddressCity,
    startDate, endDate,
    frequencyType, frequencyValue, weekdays, scheduledTime,
    isActive,
  } = req.body;

  const validationError = validateRuleBody(req.body);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  console.log(`📅 [RECURRING] PUT regel ${req.params.id}`);

  try {
    const pool = await db.getTenantConnection(req.adminTenantId);
    const result = await pool.query(
      `UPDATE recurring_orders SET
         customer_id = $1, customer_name = $2, technician_id = $3,
         equipment_ids = $4::jsonb, description = $5, service_type = $6,
         service_address_street = $7, service_address_postal_code = $8, service_address_city = $9,
         start_date = $10::date, end_date = $11::date,
         frequency_type = $12, frequency_value = $13, weekdays = $14, scheduled_time = $15,
         is_active = $16,
         updated_at = NOW()
       WHERE id = $17
       RETURNING *`,
      [
        parseInt(customerId),
        String(customerName),
        technicianId ? String(technicianId) : null,
        JSON.stringify(equipmentIds || []),
        description || null,
        serviceType || 'Generell service',
        serviceAddressStreet || null,
        serviceAddressPostalCode || null,
        serviceAddressCity || null,
        startDate,
        endDate,
        frequencyType,
        frequencyValue ? parseInt(frequencyValue) : null,
        weekdays ? weekdays.map(Number) : null,
        scheduledTime || null,
        isActive !== undefined ? isActive : true,
        parseInt(req.params.id),
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Periorderegel ikke funnet' });
    }

    console.log(`✅ [RECURRING] Regel oppdatert: id=${result.rows[0].id}`);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('❌ [RECURRING] PUT /:id error:', err.message);
    res.status(500).json({ error: 'Kunne ikke oppdatere periorderegel', details: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// DELETE /:id — slett kun regelen; genererte ordrer beholdes
// ─────────────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  console.log(`📅 [RECURRING] DELETE regel ${req.params.id}`);

  try {
    const pool = await db.getTenantConnection(req.adminTenantId);
    const result = await pool.query(
      `DELETE FROM recurring_orders WHERE id = $1 RETURNING id, customer_name`,
      [parseInt(req.params.id)]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Periorderegel ikke funnet' });
    }

    console.log(`✅ [RECURRING] Regel slettet: id=${result.rows[0].id}`);
    res.json({ message: 'Regel slettet. Genererte ordrer beholdes.', deletedId: result.rows[0].id });
  } catch (err) {
    console.error('❌ [RECURRING] DELETE /:id error:', err.message);
    res.status(500).json({ error: 'Kunne ikke slette periorderegel', details: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /:id/preview — beregn datoer uten å skrive noe
// Returnerer { count, first_dates: [...maks 5...], last_date, warning_threshold_exceeded? }
// ─────────────────────────────────────────────────────────────────
router.post('/:id/preview', async (req, res) => {
  try {
    const pool = await db.getTenantConnection(req.adminTenantId);
    const ruleResult = await pool.query(
      `SELECT * FROM recurring_orders WHERE id = $1`,
      [parseInt(req.params.id)]
    );

    if (ruleResult.rows.length === 0) {
      return res.status(404).json({ error: 'Periorderegel ikke funnet' });
    }

    const rule = ruleResult.rows[0];
    const dates = expandDates(rule);
    const count = dates.length;

    const response = {
      count,
      first_dates: dates.slice(0, 5),
      last_date: dates.length > 0 ? dates[dates.length - 1] : null,
    };

    if (count > 1000) {
      response.warning_threshold_exceeded = true;
    }

    console.log(`📅 [RECURRING] Preview regel ${req.params.id}: ${count} datoer`);
    res.json(response);
  } catch (err) {
    console.error('❌ [RECURRING] POST /:id/preview error:', err.message);
    res.status(500).json({ error: 'Kunne ikke beregne forhåndsvisning', details: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /:id/generate — generer ordrer i én transaksjon
// Krever { confirmed: true } i body.
// Bruker idBase = Date.now() + 1000 for å unngå ID-kollisjon.
// ─────────────────────────────────────────────────────────────────
router.post('/:id/generate', async (req, res) => {
  const ruleId = parseInt(req.params.id);
  const { confirmed } = req.body;

  console.log(`📅 [RECURRING] Generate regel ${ruleId}, confirmed=${confirmed}`);

  const pool = await db.getTenantConnection(req.adminTenantId);
  const client = await pool.connect();

  try {
    // ── Hent regel (utenfor transaksjon — rask sjekk) ──────────────
    const ruleCheck = await client.query(
      `SELECT * FROM recurring_orders WHERE id = $1`,
      [ruleId]
    );

    if (ruleCheck.rows.length === 0) {
      client.release();
      return res.status(404).json({ error: 'Periorderegel ikke funnet' });
    }

    const rule = ruleCheck.rows[0];

    // ── Beregn datoer ──────────────────────────────────────────────
    const dates = expandDates(rule);
    const count = dates.length;

    // ── Sjekk 1000-grense ──────────────────────────────────────────
    if (count > 1000 && !confirmed) {
      client.release();
      return res.status(400).json({
        error: `Generering vil opprette ${count} ordrer (over grensen på 1000). Send confirmed: true for å bekrefte.`,
        count,
        warning_threshold_exceeded: true,
      });
    }

    // ── Start transaksjon ──────────────────────────────────────────
    await client.query('BEGIN');

    // ── FOR UPDATE-lås: hindrer parallelle generate-kall ──────────
    const lockResult = await client.query(
      `SELECT generated_count FROM recurring_orders WHERE id = $1 FOR UPDATE`,
      [ruleId]
    );

    if (lockResult.rows[0].generated_count > 0) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(409).json({
        error: 'Denne regelen er allerede generert. Opprett en ny regel for ny periode.',
        generated_count: lockResult.rows[0].generated_count,
      });
    }

    // ── Generer alle ordrer ────────────────────────────────────────
    const year = new Date().getFullYear();
    const idBase = Date.now() + 1000;

    const createdIds = [];

    for (let i = 0; i < dates.length; i++) {
      const orderId = `PROJ-${year}-${idBase + i}`;
      const scheduledDate = dates[i];

      const customerData = {
        id: String(rule.customer_id),
        name: rule.customer_name,
        snapshot_date: new Date().toISOString(),
      };

      await client.query(
        `INSERT INTO orders (
           id, customer_id, customer_name, customer_data,
           description, service_type,
           technician_id, scheduled_date, scheduled_time,
           status, included_equipment_ids,
           service_address_street, service_address_postal_code, service_address_city
         ) VALUES (
           $1, $2::integer, $3, $4::jsonb,
           $5, $6,
           $7, $8::date, $9,
           $10, $11::jsonb,
           $12, $13, $14
         )`,
        [
          orderId,
          rule.customer_id,
          rule.customer_name,
          JSON.stringify(customerData),
          rule.description || null,
          rule.service_type || 'Generell service',
          rule.technician_id || null,
          scheduledDate,
          rule.scheduled_time || null,
          rule.technician_id ? 'scheduled' : 'pending',
          rule.equipment_ids ? JSON.stringify(rule.equipment_ids) : '[]',
          rule.service_address_street || null,
          rule.service_address_postal_code || null,
          rule.service_address_city || null,
        ]
      );

      createdIds.push(orderId);
    }

    // ── Oppdater generated_count + last_generated_at ───────────────
    await client.query(
      `UPDATE recurring_orders
       SET generated_count = $1,
           last_generated_at = NOW(),
           updated_at = NOW()
       WHERE id = $2`,
      [dates.length, ruleId]
    );

    await client.query('COMMIT');
    client.release();

    console.log(`✅ [RECURRING] Generert ${createdIds.length} ordrer for regel ${ruleId}`);
    res.status(201).json({
      created: createdIds.length,
      orderIds: createdIds,
    });

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    console.error('❌ [RECURRING] Generate transaksjon rullet tilbake:', err.message);
    res.status(500).json({ error: 'Generering feilet — ingen ordrer opprettet', details: err.message });
  }
});

module.exports = router;
