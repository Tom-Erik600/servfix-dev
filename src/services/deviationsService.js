// src/services/deviationsService.js
//
// Fase 2: Persistent deviation-tracking for avvikshåndteringsmodulen.
// Kalles KUN fra POST /:reportId/complete i routes/reports.js —
// altså når tekniker ferdigstiller rapporten, ikke ved løpende utkast-lagring.
//
// Designprinsipper:
//   - Fail-safe: feil logges, men kastes aldri videre. Rapporten er allerede lagret.
//   - Idempotens: re-complete av samme rapport gir ikke duplikat-rader.
//   - Module flag gate: for Air-Tech (og alle tenants uten flagget) er dette en no-op.
//   - Ingen HTTP: ren forretningslogikk som tar pool og data.

'use strict';

const { loadModuleFlags } = require('./moduleFlags');

// ---------------------------------------------------------------------------
// Hovedinngang
// ---------------------------------------------------------------------------

/**
 * Behandle alle sjekkpunkter i en ferdigstilt rapport for deviation-tracking.
 * Kalles ETTER at rapporten er lagret og ETTER at complete-transaksjonen er committed.
 *
 * @param {import('pg').Pool} pool        - Tenant-pool (allerede hentet)
 * @param {string}            tenantId    - Tenant-ID for modul-flag-oppslag
 * @param {object}            reportContext
 * @param {string}            reportContext.reportId       - service_reports.id (VARCHAR)
 * @param {number}            reportContext.equipmentId    - equipment.id (INTEGER) — se cast-notat under
 * @param {object}            reportContext.checklistData  - service_reports.checklist_data (JSONB → JS)
 * @param {string}            reportContext.technicianId   - session.technicianId
 * @returns {Promise<object>} summary-objekt for logging
 */
async function processReportDeviations(pool, tenantId, reportContext) {
  const { reportId, equipmentId, checklistData, technicianId } = reportContext;

  // --- Module flag gate ---
  // loadModuleFlags() fail-safer internt og returnerer defaults ved feil,
  // så vi trenger ikke eget try/catch her — defaults har enable_deviations_management: false.
  const flags = await loadModuleFlags(tenantId);
  if (!flags.enable_deviations_management) {
    return { skipped: true, reason: 'module_disabled' };
  }

  // --- Grunnleggende validering ---
  if (!reportId || !equipmentId || !checklistData) {
    console.warn('⚠️ deviationsService: mangler reportId/equipmentId/checklistData, hopper over');
    return { skipped: true, reason: 'missing_context' };
  }

  // TEKNISK GJELD: equipment_id er VARCHAR i service_reports men INTEGER i
  // deviations.equipment_id (FK til equipment.id). Vi caster her som en pragmatisk
  // løsning. Bør harmoniseres i en fremtidig migrering — enten ved å endre
  // service_reports.equipment_id til INTEGER, eller deviations.equipment_id til VARCHAR.
  const equipmentIdInt = Number(equipmentId);
  if (!Number.isInteger(equipmentIdInt) || equipmentIdInt <= 0) {
    console.warn(`⚠️ deviationsService: ugyldig equipment_id '${equipmentId}', hopper over`);
    return { skipped: true, reason: 'invalid_equipment_id' };
  }

  const items = checklistData.checklist || {};
  const summary = { created: 0, updated: 0, closed: 0, errors: 0 };

  // Last mal-info én gang for å hente labels og defaultSeverity
  const itemLabels = await loadItemLabels(pool, equipmentIdInt).catch(err => {
    console.warn('⚠️ deviationsService: kunne ikke laste mal-labels:', err.message);
    return {};
  });

  for (const [itemId, itemData] of Object.entries(items)) {
    try {
      const status = (itemData?.status || '').toLowerCase();
      const label = itemLabels[itemId]?.label || itemId;
      const rawSeverity = itemLabels[itemId]?.defaultSeverity || null;
      const severity = normalizeSeverity(rawSeverity);

      if (status === 'avvik') {
        const result = await createOrUpdateDeviation(pool, {
          equipmentId: equipmentIdInt,
          checklistItemId: itemId,
          checklistItemLabel: label,
          severity,
          comment: itemData.avvikComment || itemData.comment || null,
          outcome: normalizeOutcome(itemData.outcome),
          reportId,
          technicianId
        });
        summary[result.action]++;

      } else if (status === 'ok' || status === 'byttet') {
        const closed = await closeOpenDeviationIfAny(pool, {
          equipmentId: equipmentIdInt,
          checklistItemId: itemId,
          reportId,
          closedByUserId: technicianId
        });
        if (closed) summary.closed++;
      }
      // Andre statuser (ikke_relevant, na, tom, ukjent): ingen handling

    } catch (itemErr) {
      console.error(`❌ deviationsService: feil på item '${itemId}' (rapport ${reportId}):`, itemErr.message);
      summary.errors++;
      // Fortsett med neste item — ikke avbryt hele løkken
    }
  }

  // Stitch avvik-bilder fra denne rapporten til riktige observations
  try {
    const stitched = await linkImagesToObservations(pool, reportId);
    if (stitched > 0) {
      console.log(`🔗 deviationsService: linket ${stitched} avvik-bilde(r) til observations (rapport ${reportId})`);
    }
  } catch (err) {
    console.error('❌ deviationsService: image stitching feilet:', err.message);
    summary.errors++;
  }

  console.log(`📊 deviationsService(${tenantId}, rapport=${reportId}):`, summary);
  return summary;
}

// ---------------------------------------------------------------------------
// Intern: opprett eller oppdater deviation
// ---------------------------------------------------------------------------

/**
 * Opprett ny deviation, eller legg til observasjon på eksisterende åpen deviation.
 * Håndterer EXCLUDE constraint-konflikt (race condition) graceful.
 *
 * @returns {{ action: 'created'|'updated', deviationId: number }}
 */
async function createOrUpdateDeviation(pool, params) {
  const {
    equipmentId, checklistItemId, checklistItemLabel,
    severity, comment, outcome, reportId, technicianId
  } = params;

  // Sjekk om det finnes en åpen deviation for denne (equipment, item)
  const existing = await pool.query(
    `SELECT id FROM deviations
     WHERE equipment_id = $1 AND checklist_item_id = $2 AND status <> 'closed'
     LIMIT 1`,
    [equipmentId, checklistItemId]
  );

  if (existing.rows.length > 0) {
    const deviationId = existing.rows[0].id;
    await addObservation(pool, deviationId, reportId, technicianId, comment, severity);
    await pool.query(
      `UPDATE deviations
       SET current_summary = $1,
           current_severity = $2,
           outcome = CASE WHEN outcome_handled_at IS NULL AND $3::varchar IS NOT NULL
                          THEN $3 ELSE outcome END
       WHERE id = $4`,
      [comment, severity, outcome, deviationId]
    );
    return { action: 'updated', deviationId };
  }

  // Ingen åpen — forsøk INSERT.
  // Race condition: en annen prosess kan opprette mellom SELECT og INSERT.
  // PostgreSQL EXCLUDE-constraint kaster error code 23P01 i så fall.
  try {
    const insertResult = await pool.query(
      `INSERT INTO deviations
         (equipment_id, checklist_item_id, checklist_item_label,
          status, current_severity, current_summary,
          opened_in_report_id, outcome)
       VALUES ($1, $2, $3, 'open', $4, $5, $6, $7)
       RETURNING id`,
      [equipmentId, checklistItemId, checklistItemLabel, severity, comment, reportId, outcome]
    );
    const deviationId = insertResult.rows[0].id;
    await addObservation(pool, deviationId, reportId, technicianId, comment, severity);
    return { action: 'created', deviationId };

  } catch (err) {
    // 23P01 = exclusion_violation (EXCLUDE USING gist)
    if (err.code === '23P01') {
      const retry = await pool.query(
        `SELECT id FROM deviations
         WHERE equipment_id = $1 AND checklist_item_id = $2 AND status <> 'closed'
         LIMIT 1`,
        [equipmentId, checklistItemId]
      );
      if (retry.rows.length > 0) {
        const deviationId = retry.rows[0].id;
        await addObservation(pool, deviationId, reportId, technicianId, comment, severity);
        await pool.query(
          `UPDATE deviations
           SET current_summary = $1,
               current_severity = $2,
               outcome = CASE WHEN outcome_handled_at IS NULL AND $3::varchar IS NOT NULL
                              THEN $3 ELSE outcome END
           WHERE id = $4`,
          [comment, severity, outcome, deviationId]
        );
        return { action: 'updated', deviationId };
      }
    }
    throw err; // Annen feil — la kaller håndtere
  }
}

// ---------------------------------------------------------------------------
// Intern: legg til observasjon
// ---------------------------------------------------------------------------

/**
 * Legg til én observasjon.
 * ON CONFLICT (service_report_id, deviation_id) gjør dette idempotent:
 * re-complete av samme rapport oppdaterer heller enn å duplisere.
 */
async function addObservation(pool, deviationId, reportId, userId, comment, severity) {
  await pool.query(
    `INSERT INTO deviation_observations
       (deviation_id, service_report_id, observed_by_user_id, comment, severity)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (service_report_id, deviation_id) DO UPDATE
       SET comment   = EXCLUDED.comment,
           severity  = EXCLUDED.severity`,
    [deviationId, reportId, userId, comment, severity]
  );
}

// ---------------------------------------------------------------------------
// Intern: lukk åpen deviation
// ---------------------------------------------------------------------------

/**
 * Lukk eventuell åpen deviation når status er 'ok' eller 'byttet'.
 * @returns {boolean} true hvis én eller flere rader ble lukket
 */
async function closeOpenDeviationIfAny(pool, params) {
  const { equipmentId, checklistItemId, reportId, closedByUserId } = params;

  const result = await pool.query(
    `UPDATE deviations
     SET status         = 'closed',
         closure_mode   = 'fixed_on_visit',
         closed_at      = NOW(),
         verified_at    = NOW(),
         verified_by    = $1,
         closure_comment = 'Auto-lukket: status OK ved besøk (rapport ' || $2 || ')'
     WHERE equipment_id      = $3
       AND checklist_item_id = $4
       AND status            <> 'closed'
     RETURNING id`,
    [closedByUserId, reportId, equipmentId, checklistItemId]
  );

  return result.rows.length > 0;
}

// ---------------------------------------------------------------------------
// Intern: stitch avvik-bilder til observations
// ---------------------------------------------------------------------------

/**
 * Etter at deviation/observation-rader er opprettet, koble avvik_images
 * fra denne rapporten til riktig observation.
 *
 * Matcher på: same service_report_id + checklist_item_id på tvers av
 * avvik_images og deviations. Filtrerer på image_type = 'avvik' for å
 * unngå at OK-bilder lenkes til observations.
 *
 * @returns {number} antall oppdaterte bilder
 */
async function linkImagesToObservations(pool, reportId) {
  const result = await pool.query(
    `UPDATE avvik_images ai
     SET deviation_observation_id = obs.id,
         deviation_id             = obs.deviation_id
     FROM deviation_observations obs
     JOIN deviations dev ON dev.id = obs.deviation_id
     WHERE obs.service_report_id    = $1
       AND ai.service_report_id     = obs.service_report_id
       AND ai.checklist_item_id     = dev.checklist_item_id
       AND ai.image_type            = 'avvik'
       AND ai.deviation_observation_id IS NULL
     RETURNING ai.id`,
    [reportId]
  );
  return result.rows.length;
}

// ---------------------------------------------------------------------------
// Intern: last item-labels fra checklist_template
// ---------------------------------------------------------------------------

/**
 * Last labels og defaultSeverity fra checklist_template for et equipment.
 *
 * Template-link: equipment.systemtype → checklist_templates.equipment_type
 * (bekreftet i forundersøkelse — det finnes ingen equipment.checklist_template_id).
 *
 * Template-struktur: template_data.checklistItems[] med { id, label/name, defaultSeverity }
 *
 * @returns {Object.<string, {label: string, defaultSeverity: string|null}>}
 */
async function loadItemLabels(pool, equipmentId) {
  const result = await pool.query(
    `SELECT ct.template_data
     FROM equipment e
     JOIN checklist_templates ct ON ct.equipment_type = e.systemtype
     WHERE e.id = $1
     LIMIT 1`,
    [equipmentId]
  );

  if (result.rows.length === 0) {
    return {};
  }

  const templateData = result.rows[0].template_data;
  // Støtter begge kjente nøkkel-navn i template_data
  const items = templateData?.checklistItems || templateData?.items || [];
  const labels = {};

  for (const item of items) {
    if (item.id) {
      labels[item.id] = {
        label: item.label || item.name || item.id,
        defaultSeverity: item.defaultSeverity || null
      };
    }
  }
  return labels;
}

// ---------------------------------------------------------------------------
// Intern: normaliser severity mot CHECK-constraint
// ---------------------------------------------------------------------------

/**
 * Severity CHECK i fase 1-migreringen tillater kun: 'lav', 'medium', 'høy'.
 * Hvis template_data inneholder engelske verdier (f.eks. 'high', 'low') eller
 * ukjente verdier, faller vi tilbake til 'medium' og logger en advarsel.
 */
const VALID_SEVERITIES = new Set(['lav', 'medium', 'høy']);

function normalizeSeverity(raw) {
  if (!raw) return 'medium';
  const lower = raw.toLowerCase().trim();
  if (VALID_SEVERITIES.has(lower)) return lower;
  // Vanlige engelske aliases
  if (lower === 'high' || lower === 'høy') return 'høy';
  if (lower === 'low' || lower === 'lav') return 'lav';
  console.warn(`⚠️ deviationsService: ukjent severity-verdi '${raw}', faller tilbake til 'medium'`);
  return 'medium';
}

const VALID_OUTCOMES = new Set(['fixed_on_site', 'wants_quote', 'not_applicable']);

function normalizeOutcome(raw) {
  if (!raw) return null;
  const lower = String(raw).toLowerCase().trim();
  return VALID_OUTCOMES.has(lower) ? lower : null;
}

// ---------------------------------------------------------------------------
// Eksporter
// ---------------------------------------------------------------------------

module.exports = {
  processReportDeviations,
  // Eksportert for unit-testing og fremtidig backfill-bruk
  createOrUpdateDeviation,
  closeOpenDeviationIfAny,
  linkImagesToObservations,
  normalizeSeverity,
  normalizeOutcome,
};
