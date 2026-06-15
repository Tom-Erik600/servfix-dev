// src/routes/admin/deviations.js
//
// Fase 3: Admin-API for avvikshåndtering.
// Tre endepunkter:
//   GET    /api/admin/deviations          - liste med filtre, paginering, sortering
//   GET    /api/admin/deviations/:id      - enkelt avvik m/ observations og bilder
//   PUT    /api/admin/deviations/:id      - oppdater status/tildeling/deadline/severity/lukking
//
// Tenant-mønster: req.adminTenantId || req.session.tenantId med 401 hvis null.
// SQL-tilpasninger fra faktisk DB-skjema:
//   - equipment.systemnavn (ikke .name)
//   - technicians-tabell (ikke users)
//   - avvik_images: image_url, uploaded_at, deviation_observation_id

'use strict';

const express = require('express');
const router = express.Router();
const db = require('../../config/database');
const adminTenant = require('../../middleware/admin-tenant');
const { normalizeSeverity } = require('../../services/deviationsService');
const { generateDeviationsCsv, generateDeviationsPdf } = require('../../services/deviationsExport');
const { loadModuleFlags } = require('../../services/moduleFlags');
const { loadTenantSettings } = require('../images');

// 🔒 Admin auth + tenant-isolasjon
router.use(adminTenant);

// ---------------------------------------------------------------------------
// Konstanter (matcher CHECK-constraints i fase 1-migrasjonen)
// ---------------------------------------------------------------------------

const VALID_STATUSES = ['open', 'assigned', 'in_progress', 'fixed_pending_verification', 'closed'];
const DEFAULT_LIST_STATUSES = ['open', 'assigned', 'in_progress', 'fixed_pending_verification'];
const VALID_SEVERITIES = ['lav', 'medium', 'høy'];
const VALID_CLOSURE_MODES = ['fixed_on_visit', 'manual_close', 'accepted_by_customer', 'legacy_migrated'];
const VALID_OUTCOMES = ['fixed_on_site', 'wants_quote', 'not_applicable'];
const VALID_SORTS = new Set(['severity_desc_opened_asc', 'opened_desc', 'deadline_asc']);

const SORT_SQL = {
  severity_desc_opened_asc: `ORDER BY CASE d.current_severity
                                       WHEN 'høy' THEN 1
                                       WHEN 'medium' THEN 2
                                       WHEN 'lav' THEN 3
                                       ELSE 4 END,
                                     d.opened_at ASC`,
  opened_desc: 'ORDER BY d.opened_at DESC',
  deadline_asc: 'ORDER BY d.deadline ASC NULLS LAST'
};

// SELECT-listen som returneres for både liste og detalj (uten observations/images)
const DEVIATION_SELECT = `
  d.id,
  d.equipment_id          AS "equipmentId",
  e.systemnavn            AS "equipmentName",
  d.checklist_item_label  AS "checklistItemLabel",
  d.status,
  d.current_severity      AS severity,
  d.current_summary       AS "currentSummary",
  d.opened_at             AS "openedAt",
  d.opened_in_report_id   AS "openedInReportId",
  d.assigned_to_user_id   AS "assignedToUserId",
  t.name                  AS "assignedToName",
  d.deadline,
  EXTRACT(DAY FROM NOW() - d.opened_at)::INT AS "daysOpen",
  (SELECT COUNT(*)::INT FROM deviation_observations WHERE deviation_id = d.id) AS "observationCount",
  (SELECT COUNT(*)::INT FROM avvik_images          WHERE deviation_id = d.id) AS "imageCount",
  d.closed_at             AS "closedAt",
  d.closure_mode          AS "closureMode",
  d.closure_comment       AS "closureComment",
  o.customer_name         AS "customerName",
  o.description           AS "orderDescription",
  o.tripletex_order_id    AS "tripletexOrderId",
  perf_t.name             AS "performedByName"
`;

// ---------------------------------------------------------------------------
// Hjelpere
// ---------------------------------------------------------------------------

function getTenantId(req) {
  return req.adminTenantId || req.session?.tenantId || null;
}

function parseList(value) {
  if (!value) return [];
  return String(value).split(',').map(s => s.trim()).filter(Boolean);
}

function clampInt(value, def, min, max) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return def;
  return Math.max(min, Math.min(max, n));
}

function buildExportFilter(req) {
  const scope = req.query.scope || 'filtered';
  if (!['all', 'filtered'].includes(scope)) {
    return { error: 'Ugyldig scope' };
  }

  const conditions = [];
  const params = [];
  let idx = 1;

  if (scope === 'filtered') {
    const statusList = parseList(req.query.status);
    const statuses = statusList.length > 0 ? statusList : DEFAULT_LIST_STATUSES;
    const invalidStatus = statuses.find(s => !VALID_STATUSES.includes(s));
    if (invalidStatus) {
      return { error: `Ugyldig status: '${invalidStatus}'` };
    }
    const placeholders = statuses.map(() => `$${idx++}`).join(', ');
    conditions.push(`d.status IN (${placeholders})`);
    params.push(...statuses);
  }

  return { scope, whereClause: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params };
}

router.get('/export', async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(401).json({ error: 'No tenant context' });
  if (req.query.format !== 'csv' && req.query.format !== 'pdf') return res.status(400).json({ error: 'Ugyldig format' });

  const filter = buildExportFilter(req);
  if (filter.error) return res.status(400).json({ error: filter.error });

  try {
    const pool = await db.getTenantConnection(tenantId);

    if (filter.scope === 'filtered') {
      const countSql = `SELECT COUNT(*)::INT AS total FROM deviations d ${filter.whereClause}`;
      const countResult = await pool.query(countSql, filter.params);
      const total = countResult.rows[0]?.total || 0;
      if (total > 5000) {
        return res.status(422).json({ error: `Eksporten inneholder ${total} rader` });
      }
    }

    const listSql = `
      SELECT ${DEVIATION_SELECT}
      FROM deviations d
      LEFT JOIN equipment e ON e.id = d.equipment_id
      LEFT JOIN technicians t ON t.id = d.assigned_to_user_id
      LEFT JOIN service_reports sr ON sr.id = d.opened_in_report_id
      LEFT JOIN orders o ON o.id = sr.order_id
      LEFT JOIN technicians perf_t ON perf_t.id = o.technician_id
      ${filter.whereClause}
    `;
    const rows = (await pool.query(listSql, filter.params)).rows;
    if (req.query.format === 'pdf') {
      const tenantSettings = await loadTenantSettings(tenantId);
      const pdfBuffer = await generateDeviationsPdf(rows, tenantSettings);
      const today = new Date().toISOString().slice(0, 10);
      res.status(200)
        .type('application/pdf')
        .setHeader('Content-Disposition', `attachment; filename="avvik-${tenantId}-${today}.pdf"`)
        .setHeader('Content-Length', pdfBuffer.length)
        .setHeader('Cache-Control', 'no-transform')
        .send(pdfBuffer);
      return;
    }
    const csv = generateDeviationsCsv(rows);
    const csvDate = new Date().toISOString().slice(0, 10);
    res.status(200)
      .type('text/csv; charset=utf-8')
      .setHeader('Content-Disposition', `attachment; filename="avvik-${tenantId}-${csvDate}.csv"`)
      .send(csv);
  } catch (err) {
    console.error('admin/deviations GET export:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/deviations - liste m/ filtre, paginering, sortering
// ---------------------------------------------------------------------------

router.get('/', async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) {
    return res.status(401).json({ error: 'No tenant context' });
  }

  try {
    const pool = await db.getTenantConnection(tenantId);

    // --- Parse filtre ---
    const statusList = parseList(req.query.status);
    const statuses = statusList.length > 0 ? statusList : DEFAULT_LIST_STATUSES;
    const invalidStatus = statuses.find(s => !VALID_STATUSES.includes(s));
    if (invalidStatus) {
      return res.status(400).json({ error: `Ugyldig status: '${invalidStatus}'` });
    }

    const severityList = parseList(req.query.severity);
    const invalidSeverity = severityList.find(s => !VALID_SEVERITIES.includes(s));
    if (invalidSeverity) {
      return res.status(400).json({ error: `Ugyldig severity: '${invalidSeverity}'` });
    }

    const { equipmentId, dateFrom, dateTo } = req.query;
    const limit = clampInt(req.query.limit, 50, 1, 200);
    const offset = clampInt(req.query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
    const sortKey = req.query.sort && VALID_SORTS.has(req.query.sort)
      ? req.query.sort
      : 'severity_desc_opened_asc';

    // --- Bygg WHERE dynamisk ---
    const conditions = [];
    const params = [];
    let idx = 1;

    // Status (alltid satt - enten fra query eller default)
    const statusPlaceholders = statuses.map(() => `$${idx++}`).join(', ');
    conditions.push(`d.status IN (${statusPlaceholders})`);
    params.push(...statuses);

    if (severityList.length > 0) {
      const sevPlaceholders = severityList.map(() => `$${idx++}`).join(', ');
      conditions.push(`d.current_severity IN (${sevPlaceholders})`);
      params.push(...severityList);
    }

    if (equipmentId) {
      const eqId = parseInt(equipmentId, 10);
      if (Number.isNaN(eqId)) {
        return res.status(400).json({ error: 'equipmentId må være et heltall' });
      }
      conditions.push(`d.equipment_id = $${idx++}`);
      params.push(eqId);
    }

    if (dateFrom) {
      conditions.push(`d.opened_at >= $${idx++}::timestamptz`);
      params.push(dateFrom);
    }

    if (dateTo) {
      conditions.push(`d.opened_at <= $${idx++}::timestamptz`);
      params.push(dateTo);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const orderClause = SORT_SQL[sortKey];

    // --- Total count (samme WHERE, uten LIMIT/OFFSET) ---
    const countSql = `SELECT COUNT(*)::INT AS total FROM deviations d ${whereClause}`;
    const countResult = await pool.query(countSql, params);
    const total = countResult.rows[0]?.total || 0;

    // --- Hent rader ---
    const limitParam = idx++;
    const offsetParam = idx++;
    const listSql = `
      SELECT ${DEVIATION_SELECT}
      FROM deviations d
      LEFT JOIN equipment e ON e.id = d.equipment_id
      LEFT JOIN technicians t ON t.id = d.assigned_to_user_id
      LEFT JOIN service_reports sr ON sr.id = d.opened_in_report_id
      LEFT JOIN orders o ON o.id = sr.order_id
      LEFT JOIN technicians perf_t ON perf_t.id = o.technician_id
      ${whereClause}
      ${orderClause}
      LIMIT $${limitParam} OFFSET $${offsetParam}
    `;
    const listParams = [...params, limit, offset];
    const listResult = await pool.query(listSql, listParams);

    res.json({
      total,
      limit,
      offset,
      items: listResult.rows
    });

  } catch (err) {
    console.error('admin/deviations GET list:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/deviations/worklist - kommersiell arbeidsliste gruppert per ordre
// ---------------------------------------------------------------------------

router.get('/worklist', async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) {
    return res.status(401).json({ error: 'No tenant context' });
  }

  try {
    const flags = await loadModuleFlags(tenantId);
    if (!flags.enable_deviations_management) {
      return res.json({ counters: { wants_quote: 0, fixed_on_site: 0, unassessed: 0 }, orders: [] });
    }

    const pool = await db.getTenantConnection(tenantId);

    const includeSent = req.query.includeSent === 'true';
    const dateFromRaw = req.query.dateFrom;
    const dateFrom = dateFromRaw && /^\d{4}-\d{2}-\d{2}$/.test(dateFromRaw) ? dateFromRaw : null;
    const queryParams = dateFrom ? [dateFrom] : [];
    const dateFromClause = dateFrom ? 'AND d.opened_at >= $1::timestamptz' : '';

    const sql = `
      SELECT
        d.id,
        d.equipment_id          AS "equipmentId",
        e.systemnavn            AS "equipmentName",
        d.checklist_item_label  AS label,
        d.current_summary       AS summary,
        d.outcome,
        d.current_severity      AS severity,
        d.status,
        sr.order_id             AS "orderId",
        sr.id                   AS "reportId",
        o.customer_name         AS "customerName",
        o.description           AS "orderDescription",
        o.customer_data->>'physicalAddress' AS "visitAddress",
        pc.name                 AS "contactName",
        pc.phone                AS "contactPhone",
        pc.email                AS "contactEmail",
        d.quote_id              AS "quoteId",
        (SELECT COUNT(*)::INT FROM avvik_images WHERE deviation_id = d.id) AS "imageCount",
        EXISTS (
          SELECT 1 FROM service_reports sr2
          WHERE sr2.order_id = sr.order_id
            AND (
              (sr2.products_used   IS NOT NULL AND sr2.products_used::text   NOT IN ('[]','null','{}'))
              OR (sr2.additional_work IS NOT NULL AND sr2.additional_work::text NOT IN ('[]','null','{}'))
            )
        ) AS "orderHasProducts"
      FROM deviations d
      JOIN service_reports sr ON sr.id = d.opened_in_report_id
      LEFT JOIN orders o    ON o.id = sr.order_id
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
      LEFT JOIN equipment e ON e.id = d.equipment_id
      LEFT JOIN quotes q ON q.id = d.quote_id
      WHERE d.outcome_handled_at IS NULL
        AND (d.outcome IS NOT NULL OR d.status <> 'closed')
        AND sr.order_id IS NOT NULL
        ${includeSent ? '' : 'AND (q.sent_to_customer IS NOT TRUE)'}
        ${dateFromClause}
      ORDER BY sr.order_id, d.opened_at ASC
    `;
    const rows = (await pool.query(sql, queryParams)).rows;

    const counters = { wants_quote: 0, fixed_on_site: 0, unassessed: 0 };
    const byOrder = new Map();

    for (const r of rows) {
      let state = null;
      if (r.outcome === 'wants_quote') state = 'wants_quote';
      else if (r.outcome === 'fixed_on_site') state = 'fixed_on_site';
      else if (r.outcome === null) state = 'unassessed';

      if (state) counters[state]++;

      if (!byOrder.has(r.orderId)) {
        byOrder.set(r.orderId, {
          order_id: r.orderId,
          customer_name: r.customerName,
          project_description: r.orderDescription,
          visit_address: r.visitAddress,
          contact_name: r.contactName,
          contact_phone: r.contactPhone,
          contact_email: r.contactEmail,
          quote_id: null,
          report_ids: [],
          has_products: r.orderHasProducts === true,
          deviations: [],
          stateCounts: { wants_quote: 0, fixed_on_site: 0, unassessed: 0 }
        });
      }
      const grp = byOrder.get(r.orderId);
      if (r.quoteId && !grp.quote_id) grp.quote_id = r.quoteId;
      if (r.reportId && !grp.report_ids.includes(r.reportId)) grp.report_ids.push(r.reportId);
      if (r.orderHasProducts === true) grp.has_products = true;
      if (state) grp.stateCounts[state]++;
      grp.deviations.push({
        id: r.id,
        equipmentName: r.equipmentName,
        label: r.label,
        summary: r.summary,
        outcome: r.outcome,
        severity: r.severity,
        imageCount: r.imageCount,
        quoteId: r.quoteId
      });
    }

    res.json({ counters, orders: Array.from(byOrder.values()) });

  } catch (err) {
    console.error('admin/deviations GET worklist:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/deviations/:id - enkelt avvik m/ observations og bilder
// ---------------------------------------------------------------------------

router.get('/:id', async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) {
    return res.status(401).json({ error: 'No tenant context' });
  }

  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    return res.status(400).json({ error: 'Ugyldig deviation-ID' });
  }

  try {
    const pool = await db.getTenantConnection(tenantId);

    // Hovedrad
    const headSql = `
      SELECT ${DEVIATION_SELECT}
      FROM deviations d
      LEFT JOIN equipment e ON e.id = d.equipment_id
      LEFT JOIN technicians t ON t.id = d.assigned_to_user_id
      LEFT JOIN service_reports sr ON sr.id = d.opened_in_report_id
      LEFT JOIN orders o ON o.id = sr.order_id
      LEFT JOIN technicians perf_t ON perf_t.id = o.technician_id
      WHERE d.id = $1
    `;
    const headResult = await pool.query(headSql, [id]);
    if (headResult.rows.length === 0) {
      return res.status(404).json({ error: 'Avvik ikke funnet' });
    }
    const deviation = headResult.rows[0];

    // Observations (eldst først for tidslinje)
    const obsSql = `
      SELECT
        o.id,
        o.observed_at        AS "observedAt",
        o.observed_by_user_id AS "observedByUserId",
        t.name               AS "observedByName",
        o.comment,
        o.severity,
        o.service_report_id  AS "serviceReportId"
      FROM deviation_observations o
      LEFT JOIN technicians t ON t.id = o.observed_by_user_id
      WHERE o.deviation_id = $1
      ORDER BY o.observed_at ASC
    `;
    const obsResult = await pool.query(obsSql, [id]);

    // Bilder (alle koblet til denne deviation)
    const imgSql = `
      SELECT
        id,
        image_url               AS url,
        uploaded_at             AS "uploadedAt",
        deviation_observation_id AS "observationId"
      FROM avvik_images
      WHERE deviation_id = $1
      ORDER BY uploaded_at ASC
    `;
    const imgResult = await pool.query(imgSql, [id]);

    res.json({
      ...deviation,
      observations: obsResult.rows,
      images: imgResult.rows
    });

  } catch (err) {
    console.error('admin/deviations GET :id:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/admin/deviations/:id - oppdater
// ---------------------------------------------------------------------------

router.put('/:id', async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) {
    return res.status(401).json({ error: 'No tenant context' });
  }

  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    return res.status(400).json({ error: 'Ugyldig deviation-ID' });
  }

  const {
    status,
    assignedToUserId,
    deadline,
    currentSeverity,
    closureComment,
    closureMode,
    outcome,
    markHandled
  } = req.body || {};

  // --- Valideringer ---

  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Ugyldig status: '${status}'` });
  }

  let normalizedSeverity;
  if (currentSeverity !== undefined && currentSeverity !== null) {
    // Avvis eksplisitt ugyldige verdier (specen krever 400 for ugyldig severity).
    // normalizeSeverity() faller tilbake til 'medium' for ukjente verdier,
    // så vi gjør egen validering FØR vi normaliserer.
    const rawLower = String(currentSeverity).toLowerCase().trim();
    const allowedRaw = new Set(['lav', 'medium', 'høy', 'low', 'high']);
    if (!allowedRaw.has(rawLower)) {
      return res.status(400).json({ error: `Ugyldig severity: '${currentSeverity}'` });
    }
    normalizedSeverity = normalizeSeverity(currentSeverity);
  }

  if (closureMode !== undefined && closureMode !== null && !VALID_CLOSURE_MODES.includes(closureMode)) {
    return res.status(400).json({ error: `Ugyldig closure_mode: '${closureMode}'` });
  }

  if (status === 'closed' && !closureMode) {
    return res.status(400).json({ error: 'closureMode kreves når status settes til closed' });
  }

  if (outcome !== undefined && outcome !== null && !VALID_OUTCOMES.includes(outcome)) {
    return res.status(400).json({ error: `Ugyldig outcome: '${outcome}'` });
  }

  try {
    const pool = await db.getTenantConnection(tenantId);

    // Bekreft at avviket finnes (gir riktig 404 før vi bygger UPDATE)
    const existsResult = await pool.query('SELECT id FROM deviations WHERE id = $1', [id]);
    if (existsResult.rows.length === 0) {
      return res.status(404).json({ error: 'Avvik ikke funnet' });
    }

    // --- Bygg UPDATE dynamisk ---
    const fields = [];
    const params = [];
    let idx = 1;

    if (status !== undefined) {
      fields.push(`status = $${idx++}`);
      params.push(status);

      if (status === 'closed') {
        // Sett closed_at automatisk hvis ikke allerede satt
        fields.push(`closed_at = COALESCE(closed_at, NOW())`);
      }
    }

    if (assignedToUserId !== undefined) {
      fields.push(`assigned_to_user_id = $${idx++}`);
      params.push(assignedToUserId || null);
      if (assignedToUserId) {
        fields.push(`assigned_at = COALESCE(assigned_at, NOW())`);
      }
    }

    if (deadline !== undefined) {
      fields.push(`deadline = $${idx++}::date`);
      params.push(deadline || null);
    }

    if (currentSeverity !== undefined) {
      fields.push(`current_severity = $${idx++}`);
      params.push(normalizedSeverity);
    }

    if (closureComment !== undefined) {
      fields.push(`closure_comment = $${idx++}`);
      params.push(closureComment || null);
    }

    if (closureMode !== undefined) {
      fields.push(`closure_mode = $${idx++}`);
      params.push(closureMode || null);
    }

    if (outcome !== undefined) {
      fields.push(`outcome = $${idx++}`);
      params.push(outcome || null);
    }

    if (markHandled === true || outcome === 'not_applicable') {
      fields.push(`outcome_handled_at = COALESCE(outcome_handled_at, NOW())`);
    } else if (markHandled === false) {
      fields.push(`outcome_handled_at = NULL`);
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'Ingen felter å oppdatere' });
    }

    params.push(id);
    const updateSql = `
      UPDATE deviations
      SET ${fields.join(', ')}
      WHERE id = $${idx}
      RETURNING id
    `;
    await pool.query(updateSql, params);

    // Hent oppdatert rad i samme shape som GET-detalj (uten observations/images)
    const reloadSql = `
      SELECT ${DEVIATION_SELECT}
      FROM deviations d
      LEFT JOIN equipment e ON e.id = d.equipment_id
      LEFT JOIN technicians t ON t.id = d.assigned_to_user_id
      LEFT JOIN service_reports sr ON sr.id = d.opened_in_report_id
      LEFT JOIN orders o ON o.id = sr.order_id
      LEFT JOIN technicians perf_t ON perf_t.id = o.technician_id
      WHERE d.id = $1
    `;
    const reloadResult = await pool.query(reloadSql, [id]);
    res.json(reloadResult.rows[0]);

  } catch (err) {
    console.error('admin/deviations PUT :id:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/deviations/quote-from-order/:orderId - lag tilbud fra flaggede avvik
// ---------------------------------------------------------------------------

router.post('/quote-from-order/:orderId', async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) {
    return res.status(401).json({ error: 'No tenant context' });
  }

  const orderId = req.params.orderId;
  if (!orderId) {
    return res.status(400).json({ error: 'orderId mangler' });
  }

  try {
    const flags = await loadModuleFlags(tenantId);
    if (!flags.enable_deviations_management) {
      return res.status(403).json({ error: 'Avvikshåndtering er ikke aktivert' });
    }

    const pool = await db.getTenantConnection(tenantId);
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const flagged = await client.query(
        `SELECT d.id,
                COALESCE(e.systemnavn, 'Ukjent anlegg') AS equipment_name,
                d.checklist_item_label AS label,
                d.current_summary      AS summary
         FROM deviations d
         JOIN service_reports sr ON sr.id = d.opened_in_report_id
         LEFT JOIN equipment e   ON e.id = d.equipment_id
         WHERE sr.order_id = $1
           AND d.outcome = 'wants_quote'
           AND d.outcome_handled_at IS NULL
           AND d.quote_id IS NULL
         ORDER BY equipment_name, d.opened_at ASC`,
        [orderId]
      );

      if (flagged.rows.length === 0) {
        const alreadyQuoted = await client.query(
          `SELECT 1 FROM deviations d
           JOIN service_reports sr ON sr.id = d.opened_in_report_id
           WHERE sr.order_id = $1
             AND d.outcome = 'wants_quote'
             AND d.outcome_handled_at IS NULL
             AND d.quote_id IS NOT NULL
           LIMIT 1`,
          [orderId]
        );
        await client.query('ROLLBACK');
        if (alreadyQuoted.rows.length > 0) {
          return res.status(400).json({ error: 'Ordren har allerede et tilbud', code: 'ALREADY_QUOTED' });
        }
        return res.status(400).json({ error: 'Ingen kvalifiserende avvik (ønsker tilbud) for denne ordren', code: 'NO_QUALIFYING_DEVIATIONS' });
      }

      const byEquipment = new Map();
      for (const row of flagged.rows) {
        if (!byEquipment.has(row.equipment_name)) byEquipment.set(row.equipment_name, []);
        byEquipment.get(row.equipment_name).push(row);
      }

      const descriptionBlocks = [];
      for (const [equipmentName, items] of byEquipment) {
        const lines = items.map(it => `– ${it.label}: ${it.summary || 'Ingen beskrivelse'}`).join('\n');
        descriptionBlocks.push(`Anlegg ${equipmentName}:\n${lines}`);
      }
      const description = descriptionBlocks.join('\n\n');

      const quoteId = `QUOTE-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const itemsWithMeta = { description, estimatedHours: 0, products: [] };

      await client.query(
        `INSERT INTO quotes (id, order_id, total_amount, items, status, created_at)
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
        [quoteId, orderId, 0, JSON.stringify(itemsWithMeta), 'pending']
      );

      const includedIds = flagged.rows.map(r => r.id);
      await client.query(
        `UPDATE deviations SET quote_id = $1 WHERE id = ANY($2::int[])`,
        [quoteId, includedIds]
      );

      await client.query('COMMIT');
      res.status(201).json({ quoteId, includedDeviationIds: includedIds });

    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

  } catch (err) {
    console.error('admin/deviations POST quote-from-order:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
