# Fase 3 — Avvik Admin-UI: Komplett implementasjonsplan

**Dato oppdatert:** 2026-05-29 (etter recon-sesjon)
**Status:** Klar for implementering — alle avklaringer gjort, all kode formulert
**Scope:** Admin-UI for avvikshåndtering (liste, detalj, statusoppdatering)
**Utenfor scope:** Varsling, statistikk, bulk-operasjoner, manuell opprettelse, sletting, CSV-eksport

---

## TL;DR for utførende agent

Du implementerer 6 filer i fast rekkefølge. **All kunnskap du trenger ligger i denne planen** — du skal ikke gjøre din egen recon. Fil 1 er ferdig formulert som **referanseimplementasjon** (kopier den nesten verbatim, justér kommentarer/style etter behov). Tester følger eksakt samme mønster som `tests/deviations-service.test.js`.

**Stoppregler:**
1. Hold scope stramt — bare det som er beskrevet under hver fil
2. Ingen endringer i fase 1 (DB) eller fase 2 (`deviationsService.js`, `reports.js`)
3. Ingen endringer i innstillinger-siden (toggle er midlertidig OK)
4. Ingen prod-deploys eller test-deploys — KUN dev (`servfix-dev`)
5. Ingen IAM-endringer
6. Stopp og spør hvis noe avviker fra denne planen — ikke gjett

---

## Kontekst fra forrige sesjon (les dette først)

### Hva som er ferdig
- **Fase 1**: DB-skjema (`deviations`, `deviation_observations`, `avvik_images` utvidet) — verifisert
- **Fase 2**: `deviationsService.js` med hook fra `reports.js` POST /:reportId/complete — verifisert live
- **Module flag**: `enable_deviations_management` styres fra innstillinger-toggle (lagres i GCS settings.json)

### Hvor du jobber
- **Workspace:** `C:\apps\servfix-dev` (NB: ikke `E:\` som spec sa — det var feil)
- **Git branch:** main, 1 commit ahead av origin/main (deploy-fix fra forrige sesjon)
- **Dev-miljø:** GCP-prosjekt `servfix-dev`, Cloud Run-tjeneste `servfix-app`, URL `airtechdev.servfix.no`

### Tenant-mønster (NON-NEGOTIABLE — bruk dette eksakt)

```javascript
function getTenantId(req) {
  return req.adminTenantId || req.session?.tenantId || null;
}

// Første linjer i hver route-handler:
const tenantId = getTenantId(req);
if (!tenantId) {
  return res.status(401).json({ error: 'No tenant context' });
}
```

**Begrunnelse**: Defense-in-depth. `req.adminTenantId` settes av `admin-tenant.js` middleware. `req.session.tenantId` er backup. Eksplisitt 401 hvis null — aldri fall gjennom uten tenant-isolasjon.

**MERK**: `orders.js` og `customers.js` bruker bare `req.session.tenantId` direkte. Dette er **teknisk gjeld** og **skal IKKE fikses** som del av denne oppgaven. Notér det, men ikke endre disse filene.

### Schema-tilpasninger fra original spec (alle 4 bekreftet i recon)

Original spec antok generisk skjema. Faktisk DB-skjema avviker. Bruk disse korrigerte mappingene:

| Spec antok | Faktisk skjema | Du bruker |
|------------|---------------|-----------|
| `equipment.name` | `equipment.systemnavn` | `e.systemnavn AS "equipmentName"` |
| `users`-tabell | `technicians`-tabell finnes | `LEFT JOIN technicians t ON t.id = d.assigned_to_user_id` |
| `users.name` for `assignedToName`/`observedByName` | `technicians.name` | `t.name AS "assignedToName"` osv. |
| `avvik_images.url` | `avvik_images.image_url` | `image_url AS url` |
| `avvik_images.observationId` | `avvik_images.deviation_observation_id` | `deviation_observation_id AS "observationId"` |
| `avvik_images.uploadedAt` | `avvik_images.uploaded_at` | `uploaded_at AS "uploadedAt"` |

**API-respons-shape (JSON-feltene) holdes UENDRET** — bare SQL-mappingen tilpasses. Frontend skal ikke trenge spesialhåndtering.

**Tilleggsmerknad om `observedByUserId`**: Feltet `deviation_observations.observed_by_user_id` lagrer faktisk *tekniker-ID-en* (se `deviationsService.js` linje 215: `[deviationId, reportId, userId, comment, severity]` der `userId === technicianId`). Feltnavnet er litt misvisende men beholdes for konsistens med spec.

### Verifiserte mønstre

- **Admin route-mønster**: `src/routes/admin/orders.js` — `router.use(adminTenant)`, `db.getTenantConnection(...)`, parameterisert SQL
- **Admin auth-middleware**: `src/middleware/admin-tenant.js` — krever `req.session.isAdmin`, validerer tenant-tilgang, setter `req.adminTenantId = req.session.selectedTenantId`
- **Frontend mønster**: `public/admin/rapporter.html` + `assets/js/rapporter.js` — `<header class="app-header">` lastes dynamisk av `main.js`, `<script src="/admin/assets/js/main.js">` håndterer auth/401-redirect/header-injection
- **Test-mønster**: `tests/deviations-service.test.js` — `jest.mock` for moduleFlags, `makePool(queryMap)`-hjelper, ingen live DB

### Pakker tilgjengelig (verifisert i package.json)
- `jest` 30.3.0, `supertest` 7.2.2 (devDependencies)
- `express` 4.18, `pg` 8.11 (deps)
- Test-kommando: `npm test` (kjører `jest tests/ --testPathIgnorePatterns=tenant-security`)

---

## Implementerings-rekkefølge (følg denne nøyaktig)

1. **Fil 1** — `src/routes/admin/deviations.js` (referanseimplementasjon under, kopier verbatim)
2. **Fil 6** — `tests/admin-deviations.test.js` (skriv parallelt)
3. **Fil 2** — `src/app.js` (legg til én linje)
4. **Kjør test** — `npm test -- tests/admin-deviations.test.js` — alle skal være grønne
5. **Fil 5** — `public/admin/shared/header.html` (legg til én nav-lenke)
6. **Fil 3** — `public/admin/avvik.html` (ny side)
7. **Fil 4** — `public/admin/assets/js/avvik.js` (ny side-logikk)
8. **Kjør full test** — `npm test` — sjekk null regresjon
9. **Dev-deploy** — `gcloud run deploy` mot `servfix-dev` (kommando lengre ned)
10. **Smoke test** i nettleser på `airtechdev.servfix.no/admin/avvik.html`
11. **Statusrapport** til `.omo/reports/fase3-avvik-admin-status.md`

---

## Fil 1: `src/routes/admin/deviations.js` (REFERANSEIMPLEMENTASJON)

**Status**: Komplett — kopier som den er. Verifisert mot:
- Fase 1-migrasjonen (`scripts/migrations/2026-05-deviations-foundation.js`)
- `normalizeSeverity`-eksport fra `src/services/deviationsService.js` linje 350-357
- Admin-mønster fra `src/routes/admin/orders.js`
- Tenant-middleware fra `src/middleware/admin-tenant.js`

```javascript
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

// 🔒 Admin auth + tenant-isolasjon
router.use(adminTenant);

// ---------------------------------------------------------------------------
// Konstanter (matcher CHECK-constraints i fase 1-migrasjonen)
// ---------------------------------------------------------------------------

const VALID_STATUSES = ['open', 'assigned', 'in_progress', 'fixed_pending_verification', 'closed'];
const DEFAULT_LIST_STATUSES = ['open', 'assigned', 'in_progress', 'fixed_pending_verification'];
const VALID_SEVERITIES = ['lav', 'medium', 'høy'];
const VALID_CLOSURE_MODES = ['fixed_on_visit', 'manual_close', 'accepted_by_customer', 'legacy_migrated'];
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
  d.closure_comment       AS "closureComment"
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
    closureMode
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
      WHERE d.id = $1
    `;
    const reloadResult = await pool.query(reloadSql, [id]);
    res.json(reloadResult.rows[0]);

  } catch (err) {
    console.error('admin/deviations PUT :id:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
```

---

## Fil 2: `src/app.js` (én linje endring)

**Plassering**: I admin-rute-blokken (rundt linje 99-106), legg til **én linje** i alfabetisk rekkefølge sammen med andre admin-ruter:

```javascript
// Other admin API routes, now protected by their own middleware
app.use('/api/admin/customers', require('./routes/admin/customers'));
app.use('/api/admin/deviations', require('./routes/admin/deviations'));   // ← NY LINJE
app.use('/api/admin/technicians', require('./routes/admin/technicians'));
app.use('/api/admin/orders', require('./routes/admin/orders'));
// ... resten uendret
```

Plasser den **etter `customers` og før `technicians`** alfabetisk. Ikke endre noe annet i `app.js`.

---

## Fil 3: `public/admin/avvik.html` (ny fil)

**Mønster**: Følg `public/admin/rapporter.html`. Bruk samme struktur:
- `<header class="app-header">` (innhold lastes av `main.js`)
- `<main class="main-content">` med hero, filter-bar, tabell, paginering
- Modal/slide-in panel for detalj
- Mini-dialog modals for handlinger
- Last `<script src="/admin/assets/js/main.js">` FØRST (for header + 401-håndtering), deretter `<script src="/admin/assets/js/avvik.js">`

**Skal inneholde:**

1. **Filter-bar:**
   - Status multi-select: Åpen, Tildelt, Under arbeid, Venter verifikasjon, Lukket
   - Alvorlighetsgrad multi-select: Lav, Medium, Høy
   - Utstyr dropdown (populeres fra observations i lista)
   - Dato fra / Dato til
   - Søk-knapp + Reset-knapp

2. **Resultattabell:**
   - Kolonner: Utstyr, Sjekkpunkt, Status (badge), Alvorlighet (badge), Åpnet, Dager åpen, Observasjoner, Tildelt, Deadline
   - `<tbody id="deviations-table-body">`

3. **Paginering**:
   - "Side X av Y", forrige/neste-knapper
   - `<div id="deviations-pagination">`

4. **Detalj-panel** (slide-in fra høyre eller modal):
   - All info fra GET /:id
   - Tidslinje av observasjoner
   - Bildegalleri (klikkbare for full størrelse modal)
   - Action-knapper: Tildel, Sett deadline, Endre alvorlighet, Lukk avvik

5. **Mini-dialog modals**:
   - "Tildel" — tekniker-dropdown
   - "Sett deadline" — `<input type="date">`
   - "Endre alvorlighet" — dropdown lav/medium/høy
   - "Lukk avvik" — closure_mode dropdown + closure_comment textarea

**Status-farger** (CSS — gjenbruk fra `admin.css` hvis mulig, ikke introduser nye fargevariabler):
- `open` → rød badge
- `assigned`, `in_progress` → gul/oransje badge
- `fixed_pending_verification` → blå badge
- `closed` → grå badge

**Severity-farger**:
- `høy` → rød
- `medium` → gul/oransje
- `lav` → grønn

---

## Fil 4: `public/admin/assets/js/avvik.js` (ny fil)

**Mønster**: Følg `public/admin/assets/js/rapporter.js`. Vanilla JS — ingen biblioteker.

**Bruk denne hovedstrukturen:**

```javascript
document.addEventListener('DOMContentLoaded', async function() {
    const state = {
        items: [],
        total: 0,
        currentDetail: null,
        technicians: [],
        pagination: { limit: 50, offset: 0 },
        filters: {
            status: ['open', 'assigned', 'in_progress', 'fixed_pending_verification'],
            severity: [],
            equipmentId: null,
            dateFrom: null,
            dateTo: null,
            sort: 'severity_desc_opened_asc'
        }
    };

    const elements = {
        tableBody: document.getElementById('deviations-table-body'),
        pagination: document.getElementById('deviations-pagination'),
        // ... filter-inputs, dialog-modals
    };

    await initialize();

    async function initialize() {
        await loadTechnicians();
        setupEventListeners();
        await loadDeviations();
    }

    async function loadTechnicians() {
        const res = await fetch('/api/admin/technicians', { credentials: 'include' });
        if (res.ok) state.technicians = await res.json();
    }

    async function loadDeviations() {
        const params = buildQueryString(state.filters, state.pagination);
        const res = await fetch(`/api/admin/deviations?${params}`, { credentials: 'include' });
        if (!res.ok) {
            return showError('Kunne ikke laste avvik');
        }
        const data = await res.json();
        state.items = data.items;
        state.total = data.total;
        renderTable();
        renderPagination();
    }

    async function loadDetail(id) {
        const res = await fetch(`/api/admin/deviations/${id}`, { credentials: 'include' });
        if (res.status === 404) return showError('Avvik ikke funnet');
        if (!res.ok) return showError('Noe gikk galt');
        state.currentDetail = await res.json();
        renderDetailPanel();
    }

    async function updateDeviation(id, patch) {
        const res = await fetch(`/api/admin/deviations/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(patch)
        });
        if (res.status === 400) {
            const { error } = await res.json();
            return showError(error || 'Ugyldig forespørsel');
        }
        if (res.status === 404) return showError('Avvik ikke funnet');
        if (!res.ok) return showError('Noe gikk galt');
        await loadDetail(id);
        await loadDeviations();
    }

    // ... handler-funksjoner, render-funksjoner
});

// Hjelpefunksjoner
function formatDaysOpen(days) {
    if (days === 0) return 'I dag';
    if (days === 1) return '1 dag';
    return `${days} dager`;
}

function getStatusBadgeClass(status) {
    return {
        open: 'badge-red',
        assigned: 'badge-yellow',
        in_progress: 'badge-yellow',
        fixed_pending_verification: 'badge-blue',
        closed: 'badge-gray'
    }[status] || 'badge-gray';
}

function getSeverityBadgeClass(severity) {
    return {
        'høy': 'badge-red',
        'medium': 'badge-yellow',
        'lav': 'badge-green'
    }[severity] || 'badge-gray';
}

function formatStatusLabel(status) {
    return {
        open: 'Åpen',
        assigned: 'Tildelt',
        in_progress: 'Under arbeid',
        fixed_pending_verification: 'Venter verifikasjon',
        closed: 'Lukket'
    }[status] || status;
}
```

**Action-handlere skal kalle**:
- Tildel: `updateDeviation(id, { status: 'assigned', assignedToUserId: '...' })`
- Sett deadline: `updateDeviation(id, { deadline: 'YYYY-MM-DD' })`
- Endre alvorlighet: `updateDeviation(id, { currentSeverity: 'høy' })`
- Lukk: `updateDeviation(id, { status: 'closed', closureMode: 'manual_close', closureComment: '...' })`

**Feilhåndtering**:
- 401 → håndteres allerede av `main.js` (redirect til login)
- 400 → vis valideringsmelding i UI
- 404 → vis "Avvik ikke funnet"
- 500 → vis "Noe gikk galt, prøv igjen"

---

## Fil 5: `public/admin/shared/header.html` (én linje endring)

Eksisterende `<nav class="main-nav">` (linje 4-11):

```html
<nav class="main-nav">
    <a href="/admin/dashboard.html">Dashboard</a>
    <a href="/admin/planlegger.html">Planlegg</a>
    <a href="/admin/kunder.html">Kundeinfo</a>
    <a href="/admin/rapporter.html">Rapporter</a>
    <a href="/admin/avvik.html">Avvik</a>            <!-- ← NY LINJE -->
    <a href="/admin/tilbud.html">Tilbud</a>
    <a href="/admin/hms.html">HMS</a>
</nav>
```

Plasser etter "Rapporter" og før "Tilbud". Ikke endre noe annet i header.

---

## Fil 6: `tests/admin-deviations.test.js` (ny fil)

**Mønster**: Bruk eksakt samme struktur som `tests/deviations-service.test.js`:
- `jest.mock('@google-cloud/storage', ...)` for å unngå gRPC ved import
- `jest.mock('../src/services/deviationsService', ...)` for `normalizeSeverity`-spy
- `jest.mock('../src/config/database', ...)` for å bypasse DB-tilkobling
- `jest.mock('../src/middleware/admin-tenant', ...)` for å sette `req.adminTenantId`
- `makePool(queryMap)`-hjelper for mocket DB-respons
- `supertest` for HTTP-tester

**Strukturen:**

```javascript
'use strict';

// --- Mocks ---
jest.mock('@google-cloud/storage', () => ({
  Storage: jest.fn().mockImplementation(() => ({
    bucket: jest.fn().mockReturnValue({
      file: jest.fn().mockReturnValue({ download: jest.fn().mockResolvedValue(['{}']) })
    })
  }))
}));

// Mock database.getTenantConnection per test
const mockPool = { query: jest.fn() };
jest.mock('../src/config/database', () => ({
  getTenantConnection: jest.fn(async () => mockPool),
  getPool: jest.fn(async () => mockPool),
  closeAll: jest.fn()
}));

// Mock admin-tenant middleware - sett req.adminTenantId direkte
jest.mock('../src/middleware/admin-tenant', () => (req, res, next) => {
  req.session = req.session || {};
  req.session.isAdmin = true;
  req.session.tenantId = 'airtechdev';
  req.adminTenantId = 'airtechdev';
  next();
});

const express = require('express');
const request = require('supertest');
const deviationsRouter = require('../src/routes/admin/deviations');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/deviations', deviationsRouter);
  return app;
}

function setQueryResponses(responses) {
  // responses: array av { rows: [...] } i samme rekkefølge som pool.query kalles
  mockPool.query.mockReset();
  responses.forEach(r => mockPool.query.mockResolvedValueOnce(r));
}

// ---------------------------------------------------------------------------
// Test-grupper
// ---------------------------------------------------------------------------

describe('GET /api/admin/deviations', () => {
  test('returnerer liste med default-filtre', async () => {
    setQueryResponses([
      { rows: [{ total: 2 }] },
      { rows: [
        { id: 1, equipmentId: 5, equipmentName: 'Pool A', status: 'open' },
        { id: 2, equipmentId: 6, equipmentName: 'Pool B', status: 'assigned' }
      ]}
    ]);

    const res = await request(makeApp()).get('/api/admin/deviations');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 2, limit: 50, offset: 0 });
    expect(res.body.items).toHaveLength(2);
  });

  test('filtrerer på status (komma-separert)', async () => {
    setQueryResponses([{ rows: [{ total: 0 }] }, { rows: [] }]);
    const res = await request(makeApp()).get('/api/admin/deviations?status=open,assigned');
    expect(res.status).toBe(200);
    expect(mockPool.query).toHaveBeenCalledTimes(2);
    const [countSql, countParams] = mockPool.query.mock.calls[0];
    expect(countParams).toEqual(['open', 'assigned']);
  });

  test('avviser ugyldig status (400)', async () => {
    const res = await request(makeApp()).get('/api/admin/deviations?status=invalid');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Ugyldig status/);
  });

  test('filtrerer på severity', async () => {
    setQueryResponses([{ rows: [{ total: 0 }] }, { rows: [] }]);
    const res = await request(makeApp()).get('/api/admin/deviations?severity=høy,medium');
    expect(res.status).toBe(200);
  });

  test('avviser ugyldig severity (400)', async () => {
    const res = await request(makeApp()).get('/api/admin/deviations?severity=critical');
    expect(res.status).toBe(400);
  });

  test('filtrerer på equipmentId', async () => {
    setQueryResponses([{ rows: [{ total: 0 }] }, { rows: [] }]);
    const res = await request(makeApp()).get('/api/admin/deviations?equipmentId=42');
    expect(res.status).toBe(200);
  });

  test('avviser ikke-numerisk equipmentId (400)', async () => {
    const res = await request(makeApp()).get('/api/admin/deviations?equipmentId=abc');
    expect(res.status).toBe(400);
  });

  test('respekterer limit og offset', async () => {
    setQueryResponses([{ rows: [{ total: 100 }] }, { rows: [] }]);
    const res = await request(makeApp()).get('/api/admin/deviations?limit=20&offset=40');
    expect(res.body).toMatchObject({ total: 100, limit: 20, offset: 40 });
  });

  test('clamper limit til max 200', async () => {
    setQueryResponses([{ rows: [{ total: 0 }] }, { rows: [] }]);
    const res = await request(makeApp()).get('/api/admin/deviations?limit=500');
    expect(res.body.limit).toBe(200);
  });

  test('sorterer etter severity DESC, opened_at ASC som default', async () => {
    setQueryResponses([{ rows: [{ total: 0 }] }, { rows: [] }]);
    await request(makeApp()).get('/api/admin/deviations');
    const [listSql] = mockPool.query.mock.calls[1];
    expect(listSql).toContain('CASE d.current_severity');
    expect(listSql).toContain("WHEN 'høy' THEN 1");
  });
});

describe('GET /api/admin/deviations/:id', () => {
  test('returnerer enkelt-deviation med observasjoner og bilder', async () => {
    setQueryResponses([
      { rows: [{ id: 1, status: 'open', equipmentName: 'Pool A' }] },
      { rows: [{ id: 10, comment: 'Lekkasje' }] },
      { rows: [{ id: 'img1', url: 'https://...' }] }
    ]);
    const res = await request(makeApp()).get('/api/admin/deviations/1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('observations');
    expect(res.body).toHaveProperty('images');
    expect(res.body.observations).toHaveLength(1);
    expect(res.body.images).toHaveLength(1);
  });

  test('returnerer 404 hvis ID ikke finnes', async () => {
    setQueryResponses([{ rows: [] }]);
    const res = await request(makeApp()).get('/api/admin/deviations/9999');
    expect(res.status).toBe(404);
  });

  test('avviser ikke-numerisk ID (400)', async () => {
    const res = await request(makeApp()).get('/api/admin/deviations/abc');
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/admin/deviations/:id', () => {
  test('oppdaterer assignedToUserId', async () => {
    setQueryResponses([
      { rows: [{ id: 1 }] },          // exists check
      { rows: [{ id: 1 }] },          // UPDATE
      { rows: [{ id: 1, assignedToUserId: 'tech-1', assignedToName: 'Kari' }] }  // reload
    ]);
    const res = await request(makeApp())
      .put('/api/admin/deviations/1')
      .send({ assignedToUserId: 'tech-1' });
    expect(res.status).toBe(200);
    expect(res.body.assignedToUserId).toBe('tech-1');
  });

  test('oppdaterer deadline', async () => {
    setQueryResponses([
      { rows: [{ id: 1 }] },
      { rows: [{ id: 1 }] },
      { rows: [{ id: 1, deadline: '2026-06-15' }] }
    ]);
    const res = await request(makeApp())
      .put('/api/admin/deviations/1')
      .send({ deadline: '2026-06-15' });
    expect(res.status).toBe(200);
  });

  test('lukker avvik med closure_mode og setter closed_at automatisk', async () => {
    setQueryResponses([
      { rows: [{ id: 1 }] },
      { rows: [{ id: 1 }] },
      { rows: [{ id: 1, status: 'closed', closureMode: 'manual_close' }] }
    ]);
    const res = await request(makeApp())
      .put('/api/admin/deviations/1')
      .send({ status: 'closed', closureMode: 'manual_close', closureComment: 'Fikset' });
    expect(res.status).toBe(200);
    const [updateSql] = mockPool.query.mock.calls[1];
    expect(updateSql).toContain('closed_at = COALESCE(closed_at, NOW())');
  });

  test('avviser status=closed uten closureMode (400)', async () => {
    const res = await request(makeApp())
      .put('/api/admin/deviations/1')
      .send({ status: 'closed' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/closureMode/);
  });

  test('normaliserer severity (case-insensitive: HIGH → høy)', async () => {
    setQueryResponses([
      { rows: [{ id: 1 }] },
      { rows: [{ id: 1 }] },
      { rows: [{ id: 1, severity: 'høy' }] }
    ]);
    const res = await request(makeApp())
      .put('/api/admin/deviations/1')
      .send({ currentSeverity: 'HIGH' });
    expect(res.status).toBe(200);
    // Params til UPDATE skal inneholde 'høy' (normalisert)
    const [, updateParams] = mockPool.query.mock.calls[1];
    expect(updateParams).toContain('høy');
  });

  test('avviser ugyldig severity (400)', async () => {
    const res = await request(makeApp())
      .put('/api/admin/deviations/1')
      .send({ currentSeverity: 'kritisk' });
    expect(res.status).toBe(400);
  });

  test('avviser ugyldig status (400)', async () => {
    const res = await request(makeApp())
      .put('/api/admin/deviations/1')
      .send({ status: 'frozen' });
    expect(res.status).toBe(400);
  });

  test('avviser ugyldig closure_mode (400)', async () => {
    const res = await request(makeApp())
      .put('/api/admin/deviations/1')
      .send({ status: 'closed', closureMode: 'invalid_mode' });
    expect(res.status).toBe(400);
  });

  test('returnerer 404 hvis ID ikke finnes', async () => {
    setQueryResponses([{ rows: [] }]);
    const res = await request(makeApp())
      .put('/api/admin/deviations/9999')
      .send({ status: 'assigned' });
    expect(res.status).toBe(404);
  });

  test('avviser tom body (400)', async () => {
    setQueryResponses([{ rows: [{ id: 1 }] }]);
    const res = await request(makeApp())
      .put('/api/admin/deviations/1')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Ingen felter/);
  });
});
```

**Forventet antall tester**: 18 (>= 15 fra spec). Alle skal være grønne.

---

## Deploy-kommando (kun dev)

Etter alle 6 filer er ferdige og tester passerer:

```powershell
gcloud config set project servfix-dev
gcloud run deploy servfix-app `
  --source . `
  --platform managed `
  --region europe-north1 `
  --allow-unauthenticated `
  --set-cloudsql-instances servfix-dev:europe-north1:servfix-dev-db `
  --set-env-vars="NODE_ENV=development,CLOUD_SQL_CONNECTION_NAME=servfix-dev:europe-north1:servfix-dev-db,DB_USER=postgres,DB_NAME=servfix_admin,DEFAULT_TENANT_ID=airtech,GCS_BUCKET_NAME=servfix-files-dev,GOOGLE_CLOUD_PROJECT_ID=servfix-dev,BASE_URL=https://api-test.tripletex.tech/v2,SMTP_HOST=smtp.gmail.com,SMTP_PORT=587,SMTP_USER=servfixadm@gmail.com,SMTP_FROM=servfixadm@gmail.com" `
  --update-secrets="DB_PASSWORD=db-password:latest,SESSION_SECRET=session-secret:latest,CONSUMER_TOKEN=tripletex-consumer-token:latest,EMPLOYEE_TOKEN=tripletex-employee-token:latest,SMTP_PASS=smtp-password:latest" `
  --min-instances=0 `
  --max-instances=3 `
  --memory=2Gi `
  --concurrency=40 `
  --cpu=1 `
  --timeout=300
```

**Kjør fra**: `C:\apps\servfix-dev`

**Bare dev-deploy.** Test og prod gjøres av Tom-Erik etter review.

---

## Smoke test etter deploy

1. Åpne `https://airtechdev.servfix.no/admin/avvik.html`
2. Sjekk at siden laster, header inkluderer "Avvik" nav-lenke (aktiv)
3. Hvis dev-DB har avvik: verifiser visning. Hvis ikke: registrer ett testavvik via service-flyten i tekniker-appen først
4. Filtrer på status — sjekk at lista oppdateres
5. Filtrer på severity — sjekk filtrering
6. Klikk en rad — detaljpanel åpnes med observations + bilder
7. Tildel til en tekniker — bekreft at lista oppdateres
8. Endre alvorlighet — bekreft endring
9. Lukk avvik med closure_comment — bekreft status=closed og closed_at satt

**Regresjon**: Verifiser at `rapporter.html`, `kunder.html`, `planlegger.html` fortsatt laster og fungerer.

---

## Statusrapport

Lever til `.omo/reports/fase3-avvik-admin-status.md` (≤ 1 side):

1. **Filer levert**: liste over alle 6 filer + kort beskrivelse
2. **Tester**: antall + status (X/Y passerer)
3. **Deploy-status**: dev-revisjon-navn, Ready-status, URL
4. **Smoke test**: ble alle 9 stegene gjennomført? Resultater?
5. **Avvik fra spesifikasjon**: dokumentér de 4 schema-tilpasningene + andre justeringer med begrunnelsen "spec-en antok generisk skjema; tilpasset til faktisk DB-skjema"
6. **Klart for test-promote**: ja/nei, begrunnelse

---

## Sjekkliste

- [ ] Fil 1: `src/routes/admin/deviations.js` opprettet (kopiert fra referanseimplementasjon)
- [ ] Fil 2: `src/app.js` oppdatert med én linje
- [ ] Fil 3: `public/admin/avvik.html` opprettet
- [ ] Fil 4: `public/admin/assets/js/avvik.js` opprettet
- [ ] Fil 5: `public/admin/shared/header.html` oppdatert med "Avvik" nav-lenke
- [ ] Fil 6: `tests/admin-deviations.test.js` opprettet med ≥ 15 tester
- [ ] `npm test -- tests/admin-deviations.test.js` — alle grønne
- [ ] `npm test` (full suite) — null regresjon
- [ ] Dev-deploy fullført, revisjon Ready
- [ ] Smoke test 9/9 gjennomført
- [ ] Statusrapport levert
- [ ] **Ingen endringer i fase 1 eller fase 2-kode**
- [ ] **Ingen endringer i innstillinger-siden**
- [ ] **Ingen test- eller prod-deploys**
- [ ] **Ingen IAM-endringer**
- [ ] **Ikke fikset inkonsistensen i `orders.js`/`customers.js` (teknisk gjeld, separat oppgave)**

---

## Spørsmål til Tom-Erik underveis (stopp og spør hvis)

- En kolonne i DB-skjemaet ikke matcher referanseimplementasjonen
- Tester feiler av grunner som krever endringer i fase 1/2 (skal IKKE gjøres uten avklaring)
- Deploy feiler
- Smoke test avdekker uventede problemer

---

## Det vi gjør IKKE i denne oppgaven

- Endre fase 1 (DB-skjema)
- Endre fase 2 (`deviationsService.js`, `reports.js`)
- Endre innstillinger-siden
- Implementere varsling (e-post, push)
- Implementere bulk-operasjoner
- Implementere statistikk-dashboard
- Implementere manuell opprettelse av avvik
- Implementere sletting av avvik
- Implementere CSV/PDF-eksport (fase 3.5 senere)
- Implementere audit log (fase 3.5 senere)
- Test-deploy eller prod-deploy
- Refaktorere eksisterende admin-kode (orders.js, customers.js — teknisk gjeld)
- Bytte ut tenant-flag-system med admin-styrt feature gating (fase 5+)
