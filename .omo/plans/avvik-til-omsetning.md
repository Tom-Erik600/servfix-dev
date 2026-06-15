# Avvik til omsetning (v1) — Arbeidsplan

## TL;DR

> **Quick Summary**: Legg et kommersielt lag oppå den eksisterende avviksmodulen. Tekniker
> markerer utfall (fikset på stedet / ønsker tilbud) på avvik; admin får en arbeidsliste
> gruppert per ordre, og kan lage ett tilbud fra flaggede avvik som gjenbruker det eksisterende
> admin-tilbudssenteret (`tilbud.html`). ALT er additivt — ingen omskriving av eksisterende logikk.
>
> **Deliverables**:
> - Migrasjon (009): `outcome`, `outcome_handled_at`, `quote_id` på `deviations` (idempotent, --dry-run).
> - Tekniker: utfallsvalg i avviksboks + validering ("ønsker tilbud" ⇒ beskrivelse påkrevd) + påminnelse.
> - Backend: `processReportDeviations` leser utfall additivt; admin worklist-GET; outcome-PUT; lag-tilbud-fra-avvik-POST.
> - Admin: arbeidsliste-visning i `avvik.html`; "Opprett tilbud" + "Se servicerapport" i `tilbud.html`.
> - Skjul gammel tilbudsknapp for tekniker via module-flag (kode beholdt).
>
> **Estimated Effort**: Large
> **Parallel Execution**: YES — 4 bølger + verifiseringsbølge
> **Critical Path**: T1 (migrasjon) → T3 (service-additiv) → T7 (lag-tilbud) → T10/T12 (admin-UI) → F1–F4 → din godkjenning

---

## Context

### Original Request
Opencode-instruks "Avvik til omsetning (v1)". Arbeidsmodus: PLAN → vent på godkjenning → BUILD →
rapporter for verifikasjon. Tom-Erik eier alle commits (ingen git add/commit/push fra agent).
Kun additive, målrettede endringer. Stopp-og-rapporter ved divergens.

### Interview Summary (read-first fullført + verifisert mot disk)
**Bekreftede beslutninger:**
- `outcome`/`outcome_handled_at`/`quote_id` = **uavhengige** kolonner (ikke integrert med `closure_mode`).
- Et avvik grupperes under ordren som **åpnet** det (`deviations.opened_in_report_id` → `service_reports.order_id`).
- Gammel tilbudsknapp i tekniker-app (`orders.js:405`) skjules via **ny module-flag** `show_manual_quote_button`; kode beholdes.
- "Opprett tilbud" i `tilbud.html` åpner den **eksisterende** rediger-modalen (`openEditModal`) tom — ingen ny modal.
- "Lag tilbud fra avvik" lager ett **pending** quote forhåndsutfylt (avvik gruppert per anlegg i `description`; `products[]` TOM), og åpner SAMME eksisterende rediger-modal.
- "Se servicerapport"-lenke primært i `tilbud.html` (`displayQuoteDetails`, betinget av `order_id`) + på ordre-kort i arbeidslista; gjenbruk `viewOrderPDFs`.
- **D3 SUPERSEDERT**: ingen per-anlegg `products[]`-linjer — avvik kun i `description` (unngår misvisende "Materialer (1 stk)").

**Verifiserte fakta (fil:linje):**
- `processReportDeviations` — `src/services/deviationsService.js:34-120`. Kalt fra `src/routes/reports.js:514` (POST `/:reportId/complete`). Gated av flag `enable_deviations_management`. Additivt hook-punkt: `createOrUpdateDeviation` params (l.78-86, 132-136) + INSERT/UPDATE (l.146-163).
- `deviations`-tabell — `scripts/migrations/2026-05-deviations-foundation.js`. Nøkkel `equipment_id`(INTEGER)+`checklist_item_id`, EXCLUDE-constraint. INGEN `order_id`. `outcome/outcome_handled_at/quote_id` finnes ikke.
- `service_reports` — `migrations/000-base-schema.sql:302-308`: `order_id` VARCHAR, `equipment_id` INTEGER, `products_used` JSONB, `additional_work` JSONB.
- Tekniker checklist — `public/app/assets/js/service.js`. Avvik-bokser: `createOkAvvik*ItemHTML` (l.2158-2322, `.avvik-container`). Serialisering: `getChecklistItemValue` (l.4174-4280, returnerer `{status, avvikComment, severity?}`). Finalisering: `finalizeAnlegg` (l.4650, ingen per-item-validering i dag).
- Admin avvik-endepunkter — `src/routes/admin/deviations.js` (GET liste, GET `/:id`, PUT `/:id`, GET `/export`). Montert i BÅDE `server.js:338` OG `src/app.js:100`.
- Quotes — tabell `migrations/000-base-schema.sql:285-297` (`id` VARCHAR, `order_id` VARCHAR, `items` JSONB={description,estimatedHours,products[]}, `total_amount`, `status`). `src/routes/quotes.js`: GET `/` (l.63), GET `/order/:orderId` (l.102), POST `/` (l.128, `items`=array av {name,quantity,price}, status default 'pending'), PUT `/:id` (l.179). Montert KUN i `server.js:328`. Middleware tillater technician ELLER admin (l.10-25).
- Admin tilbudssenter — `public/admin/tilbud.html` + `tilbud.js` (681 l). `loadData` GET `/api/quotes` (l.12-25), `renderQuotes` (l.27-66), `displayQuoteDetails` (l.91-229, Ordre-seksjon l.180-183), `openEditModal` (l.387-624, PUT `/api/quotes/:id`). Ingen opprett-knapp i dag.
- PDF — `src/services/quotePDFGenerator.js:404-451`: `description`→"Prosjektbeskrivelse"; `products[]`→"Materialer"+`• {name} ({qty} stk) — {pris} kr`.
- `viewOrderPDFs(orderId, reportIds)` — `public/admin/assets/js/rapporter.js:761` → åpner `/api/admin/reports/{reportIds[0]}/pdf`.
- Migrasjons-konvensjon — `migrations/00X-*.js` (Pool, `IF NOT EXISTS`, `--dry-run`, `--tenant=`, `pool.end()` i finally). Siste = 008. module_flags: `src/services/moduleFlags.js` `getDefaultModuleFlags()` (l.15-33) — merge-on-load gjør nye flagg tilgjengelige uten GCS-migrasjon.

### Gap-analyse (egen — Metis/Oracle-subagenter var uresponsive i sesjonen)
Adressert i guardrails, edge-cases og acceptance criteria nedenfor.

---

## Work Objectives

### Core Objective
Fange tekniker-utfall på avvik og gi admin en ordregruppert arbeidsliste + en avviksdrevet
tilbudssti, utelukkende ved additive endringer som gjenbruker eksisterende tilbuds- og rapport-infrastruktur.

### Concrete Deliverables
Se TL;DR. Hver TODO under angir nøyaktige filer + endringer.

### Definition of Done
Hele leveranse-sjekklista i instruksens Seksjon 8 er grønn, verifisert med verbatim testoutput/agent-QA.

### Must Have
- Migrasjon kjører idempotent med og uten `--dry-run`, `db`/`pool.end()` i finally.
- Tekniker kan velge utfall i avviksboks; default ingen valgt.
- "Ønsker tilbud" tvinger beskrivelse (validert).
- "Fikset på stedet" viser påminnelse om timer/produkter (kun påminnelse, intet nytt felt).
- `outcome` skrives korrekt til `deviations` ved ferdigstilling (additivt i `processReportDeviations`).
- Admin-arbeidsliste grupperer per ordre, viser tre tilstander + teller-kort.
- "Lag tilbud" lager ETT pending quote per ordre, setter `quote_id`, åpner eksisterende rediger-modal.
- "Se rapport" gjenbruker `viewOrderPDFs`. "Ikke aktuelt"/"Håndtert" oppdaterer status.
- Gammel tilbudsknapp skjult for tekniker via flag; admin-funksjonalitet intakt.
- Nye endepunkter tilgjengelige via ruter montert i BÅDE `server.js` og `src/app.js`.
- Ingen `parseInt()` på `orders.id`/`technicians.id`.

### Must NOT Have (Guardrails)
- ALDRI omskrive `processReportDeviations` — kun additivt tillegg (ny param + ny kolonne-skriving).
- ALDRI duplisere tilbudslogikk — gjenbruk POST/PUT-kontrakten og rediger-modalen.
- ALDRI per-anlegg `products[]`-linjer (D3 supersedert) — avvik kun i `description`.
- ALDRI nye kolonner/billing-notat utover de tre (`outcome`, `outcome_handled_at`, `quote_id`).
- ALDRI `parseInt()` på VARCHAR-IDer (`orders.id`, `technicians.id`).
- ALDRI røre layout/PDF utover det minimale (ikke døp om "Materialer"-header).
- ALDRI bygge noe fra "utenfor scope": Tripletex, effektrapport, AI-tekst, auto-ordre, beløpsgrenser/signatur/katalog/push.
- ALDRI montere ny rute kun ett sted — bruk eksisterende `admin/deviations.js` (montert begge steder).
- ALDRI git add/commit/push.

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** i agent-QA. Tom-Erik godkjenner til slutt (hans prosess), men
> all teknisk verifikasjon er agent-eksekvert med verbatim bevis.

### Test Decision
- **Infrastructure exists**: YES (`tests/`, f.eks. `tests/deviations-service.test.js`).
- **Automated tests**: Backend additiv = enhetstester (tests-after). Migrasjon = dry-run + verifisering.
- **Framework**: eksisterende test-runner i repo (se `package.json` scripts — bekreft i T0-sjekk under hver backend-task).

### QA Policy
Hver task har agent-eksekvert QA. Bevis i `.omo/evidence/task-{N}-{slug}.{ext}`.
- **Frontend/UI (tekniker + admin)**: Playwright — naviger, klikk, fyll, assert DOM, screenshot.
- **API/Backend**: Bash (curl) — request, assert status + JSON-felt.
- **Migrasjon/DB**: Bash (node migrasjon --dry-run; deretter ekte; verifiser kolonner via SQL).

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation — start umiddelbart):
├── 1: Migrasjon 009 — deviations + outcome/outcome_handled_at/quote_id [quick]
└── 2: moduleFlags default show_manual_quote_button [quick]

Wave 2 (Backend additiv + quote-berikelse — etter W1):
├── 3: deviationsService.js additiv outcome-lesing/-skriving (dep:1) [deep]
├── 4: admin/deviations.js GET worklist (dep:1) [unspecified-high]
├── 5: admin/deviations.js PUT outcome/handled/not_applicable (dep:1) [unspecified-high]
└── 6: quotes.js berik quote-payload med report_ids (additivt) [quick]

Wave 3 (Avviksdrevet tilbud + tekniker-UI — etter W2-backend):
├── 7: admin/deviations.js POST lag-tilbud-fra-avvik (dep:1,3) [deep]
├── 8: service.js/html tekniker utfallsvalg i avviksboks + serialisering (dep:1) [visual-engineering]
└── 9: service.js finalize-validering + fikset-påminnelse (dep:8) [unspecified-high]

Wave 4 (Admin-UI-integrasjon — etter W2/W3-endepunkter):
├── 10: avvik.html/avvik.js arbeidsliste-visning (dep:4,5,7) [visual-engineering]
├── 11: tilbud.js "Opprett tilbud" → åpne eksisterende rediger-modal tom [quick]
├── 12: tilbud.js åpne modal på avviks-quote + "Se servicerapport"-lenke (dep:6,7) [unspecified-high]
└── 13: orders.js skjul manuell tilbudsknapp via flag (dep:2) [quick]

Wave FINAL (etter ALLE tasks — 4 parallelle reviews, så din godkjenning):
├── F1: Plan-compliance (oracle)
├── F2: Kodekvalitet (unspecified-high)
├── F3: Reell manuell QA (unspecified-high + playwright)
└── F4: Scope-troskap (deep)
-> Presenter resultater -> vent på Tom-Eriks eksplisitte "okay"

Critical Path: 1 → 3 → 7 → 10/12 → F1–F4 → godkjenning
Max Concurrent: 4 (Wave 2)
```

### Dependency Matrix

- **1**: avh. ingen → blokkerer 3,4,5,7
- **2**: avh. ingen → blokkerer 13
- **3**: avh. 1 → blokkerer 7
- **4**: avh. 1 → blokkerer 10
- **5**: avh. 1 → blokkerer 10
- **6**: avh. ingen → blokkerer 12
- **7**: avh. 1,3 → blokkerer 10,12
- **8**: avh. 1 → blokkerer 9
- **9**: avh. 8 → blokkerer ingen
- **10**: avh. 4,5,7 → blokkerer ingen
- **11**: avh. ingen → blokkerer ingen
- **12**: avh. 6,7 → blokkerer ingen
- **13**: avh. 2 → blokkerer ingen

### Agent Dispatch Summary

- **Wave 1**: 1→`quick`, 2→`quick`
- **Wave 2**: 3→`deep`, 4→`unspecified-high`, 5→`unspecified-high`, 6→`quick`
- **Wave 3**: 7→`deep`, 8→`visual-engineering`, 9→`unspecified-high`
- **Wave 4**: 10→`visual-engineering`, 11→`quick`, 12→`unspecified-high`, 13→`quick`
- **FINAL**: F1→`oracle`, F2→`unspecified-high`, F3→`unspecified-high`, F4→`deep`

---

## TODOs

- [ ] 1. Migrasjon 009 — legg til kommersielle kolonner på `deviations`

  **What to do**:
  - Ny fil `migrations/009-add-deviations-commercial-columns.js`, kopier struktur fra `migrations/006-create-recurring-orders.js` (CLI-flagg `--dry-run`/`--tenant=`, `getBaseConfig()`, tenant-loop fra `servfix_admin`, `pool.end()` i finally, oppsummering, `process.exit`).
  - SQL (idempotent):
    ```sql
    ALTER TABLE deviations
      ADD COLUMN IF NOT EXISTS outcome            VARCHAR(20),
      ADD COLUMN IF NOT EXISTS outcome_handled_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS quote_id           VARCHAR(50);
    ```
  - Legg til CHECK-constraint idempotent (kun hvis den ikke finnes — bruk `DO $$ ... information_schema.table_constraints ...` mønster, IKKE bart `ADD CONSTRAINT`):
    `outcome IS NULL OR outcome IN ('fixed_on_site','wants_quote','not_applicable')`.
  - FK på `quote_id` er VALGFRITT og kan utelates i v1 (quotes.id er VARCHAR; unngå hard FK for å ikke blokkere sletting). Hvis FK ønskes: `REFERENCES quotes(id) ON DELETE SET NULL`, men kun idempotent. Default: ingen FK, bare kolonne.
  - VERIFY-SQL som teller at de tre kolonnene finnes.

  **Must NOT do**: Ingen DROP/destruktivt. Ingen andre kolonner. Ikke rør `deviation_observations`/`avvik_images`. Ikke endre `equipment_id`-typen.

  **Recommended Agent Profile**:
  - **Category**: `quick` — Reason: enkelt, mønster-kopi av eksisterende migrasjon.
  - **Skills**: ingen påkrevd.

  **Parallelization**: Can Run In Parallel: YES · Wave 1 (med Task 2) · Blocks: 3,4,5,7 · Blocked By: None.

  **References**:
  - `migrations/006-create-recurring-orders.js` (HELE) — kanonisk migrasjons-mønster (CLI, getBaseConfig, tenant-loop, dry-run, finally pool.end, VERIFY, oppsummering). Kopier strukturen 1:1.
  - `migrations/000-base-schema.sql:395-450` — `DO $$ IF NOT EXISTS (... table_constraints ...) THEN ALTER TABLE ... ADD CONSTRAINT` — bruk DETTE mønsteret for idempotent CHECK-constraint.
  - `scripts/migrations/2026-05-deviations-foundation.js` — bekreft eksisterende `deviations`-kolonner (så vi ikke kolliderer).
  - WHY: Migrasjonen MÅ matche repoets per-tenant dry-run-konvensjon eksakt; constraint MÅ være idempotent slik at gjenkjøring ikke feiler.

  **Acceptance Criteria** (agent-eksekvert):
  - [ ] `node migrations/009-add-deviations-commercial-columns.js --dry-run` → printer SQL, returnerer 0, gjør INGEN endring (verifiser med kolonne-spørring før/etter at intet endret).
  - [ ] `node migrations/009-add-deviations-commercial-columns.js --tenant=<testtenant>` → kolonner finnes etterpå.
  - [ ] Gjenkjøring (idempotens) → returnerer 0, ingen feil, ingen duplikat-constraint-feil.

  **QA Scenarios**:
  ```
  Scenario: Dry-run endrer ingenting
    Tool: Bash
    Steps:
      1. Kjør SQL-spørring som lister deviations-kolonner → lagre liste A.
      2. node migrations/009-add-deviations-commercial-columns.js --dry-run
      3. List kolonner igjen → liste B.
    Expected Result: A == B (ingen kolonner lagt til); stdout inneholder ALTER TABLE-SQL; exit 0.
    Evidence: .omo/evidence/task-1-dryrun.txt

  Scenario: Ekte kjøring + idempotens
    Tool: Bash
    Steps:
      1. node migrations/009-... --tenant=<test> ; verifiser outcome/outcome_handled_at/quote_id finnes.
      2. Kjør samme kommando på nytt.
    Expected Result: Første kjøring legger til 3 kolonner + CHECK; andre kjøring exit 0 uten feil.
    Evidence: .omo/evidence/task-1-apply-idempotent.txt
  ```

  **Commit (forslag til Tom-Erik)**: `feat(db): add commercial outcome columns to deviations (009)` · fil: `migrations/009-add-deviations-commercial-columns.js`

- [ ] 2. moduleFlags — ny default-flagg `show_manual_quote_button`

  **What to do**:
  - I `src/services/moduleFlags.js`, `getDefaultModuleFlags()` (l.15-33): legg til `show_manual_quote_button: true` blant flaggene (bakoverkompatibel default = synlig).
  - Ingen GCS-migrasjon nødvendig: `loadModuleFlags()` spreder defaults først (`{ ...getDefaultModuleFlags(), ...settings.module_flags }`), så nye flagg blir tilgjengelige for eksisterende tenants automatisk.
  - Dokumentér i kommentar at `false` skjuler tekniker-knappen (brukes av Task 13).

  **Must NOT do**: Ikke endre eksisterende flagg. Ikke lag GCS-migrasjon. Ikke endre `loadModuleFlags`-logikken.

  **Recommended Agent Profile**: `quick` — ett objekt-felt. Skills: ingen.

  **Parallelization**: Can Run In Parallel: YES · Wave 1 (med Task 1) · Blocks: 13 · Blocked By: None.

  **References**:
  - `src/services/moduleFlags.js:15-50` — `getDefaultModuleFlags()` + `loadModuleFlags()` merge-mønster. WHY: bekreft at merge-on-load gir flagget uten migrasjon.
  - `migrations/005-add-module-flags-defaults.js` — KUN for å bekrefte at ingen ny migrasjon trengs (motivasjon, ikke kopier).

  **Acceptance Criteria** (agent-eksekvert):
  - [ ] Node-REPL: `require('./src/services/moduleFlags').getDefaultModuleFlags().show_manual_quote_button === true`.
  - [ ] `loadModuleFlags(<tenant>)` returnerer feltet selv om tenant-settings.json ikke har det.

  **QA Scenarios**:
  ```
  Scenario: Default + merge
    Tool: Bash (node -e)
    Steps:
      1. node -e "const m=require('./src/services/moduleFlags'); console.log(m.getDefaultModuleFlags().show_manual_quote_button)"
      2. node -e "(async()=>{const m=require('./src/services/moduleFlags'); console.log((await m.loadModuleFlags('<tenant>')).show_manual_quote_button)})()"
    Expected Result: begge printer true.
    Evidence: .omo/evidence/task-2-flag-default.txt
  ```

  **Commit (forslag)**: `feat(flags): add show_manual_quote_button default` · fil: `src/services/moduleFlags.js`

- [ ] 3. `deviationsService.js` — additiv lesing/skriving av `outcome`

  **What to do**:
  - I `processReportDeviations` løkken (l.70-97): les `const outcome = normalizeOutcome(itemData.outcome)` der `normalizeOutcome` mapper kun gyldige verdier (`fixed_on_site`/`wants_quote`/`not_applicable`) ellers `null`. Send `outcome` videre KUN i avvik-grenen (l.77-86) som nytt felt i `createOrUpdateDeviation`-params.
  - I `createOrUpdateDeviation` (l.132-): legg `outcome` til i destructuring + i INSERT-kolonnelista og i UPDATE-grenen.
    - **INSERT**: sett `outcome` = mottatt verdi.
    - **UPDATE (eksisterende åpen deviation, l.146-156)**: sett `outcome = $X` KUN når `outcome_handled_at IS NULL` (ikke overstyr admin som har kvittert ut). Bruk `outcome = CASE WHEN outcome_handled_at IS NULL THEN $X ELSE outcome END`. Rør IKKE `quote_id`/`outcome_handled_at` her.
  - Alt annet i funksjonen er uendret (severity, comment, close-logikk, image-stitching).

  **Must NOT do**: IKKE omskrive funksjonen. IKKE endre severity/comment/close/stitch-logikk. IKKE sette `outcome` i `closeOpenDeviationIfAny`-grenen (status ok/byttet). IKKE rør `outcome_handled_at`/`quote_id` (eies av admin/Task 5/7).

  **Recommended Agent Profile**: `deep` — krever presis additiv kirurgi i kritisk forretningslogikk uten regresjon. Skills: ingen (ren Node/SQL).

  **Parallelization**: Can Run In Parallel: YES · Wave 2 · Blocks: 7 · Blocked By: 1.

  **References**:
  - `src/services/deviationsService.js:34-120` (processReportDeviations) + `:132-200` (createOrUpdateDeviation INSERT/UPDATE). WHY: nøyaktige additive innstikkspunkter; UPDATE-grenen må respektere admin-kvittering.
  - `src/routes/reports.js:514-522` — bekreft `checklistData`-formen som sendes inn (`itemData.outcome` kommer fra Task 8-serialisering).
  - `tests/deviations-service.test.js` (hvis finnes) — test-mønster å utvide.
  - WHY: Instruks forbyr omskriving — kun additivt tillegg.

  **Acceptance Criteria** (agent-eksekvert):
  - [ ] Ny/utvidet enhetstest: avvik-item med `outcome:'wants_quote'` → ny deviation får `outcome='wants_quote'`.
  - [ ] Enhetstest: eksisterende åpen deviation med `outcome_handled_at` satt → ny rapport med annet outcome overstyrer IKKE.
  - [ ] Enhetstest: status `ok` med `outcome` satt i data → outcome ignoreres (kun avvik-grenen skriver).
  - [ ] Verbatim testoutput vist.

  **QA Scenarios**:
  ```
  Scenario: Outcome skrives ved ferdigstilling (happy)
    Tool: Bash (test-runner) + curl
    Steps:
      1. Kjør enhetstest-suite for deviationsService → PASS.
      2. (Integrasjon) curl POST /api/reports/<id>/complete med checklist hvor item har status=avvik, outcome=wants_quote.
      3. SQL: SELECT outcome FROM deviations WHERE opened_in_report_id=<id> AND checklist_item_id=<item>.
    Expected Result: outcome = 'wants_quote'. Test-suite grønn.
    Evidence: .omo/evidence/task-3-outcome-write.txt

  Scenario: Admin-kvittering bevares (negativ/edge)
    Tool: Bash (test)
    Steps:
      1. Seed åpen deviation med outcome='fixed_on_site', outcome_handled_at=NOW().
      2. Kjør processReportDeviations med ny observasjon outcome='wants_quote'.
    Expected Result: outcome forblir 'fixed_on_site' (ikke overstyrt).
    Evidence: .omo/evidence/task-3-handled-preserved.txt
  ```

  **Commit (forslag)**: `feat(deviations): read+persist outcome additively in processReportDeviations` · fil: `src/services/deviationsService.js` (+ test)

- [ ] 4. `admin/deviations.js` — GET arbeidsliste gruppert per ordre

  **What to do**:
  - Nytt endepunkt `GET /api/admin/deviations/worklist` i `src/routes/admin/deviations.js`.
  - Query: join `deviations d` → `service_reports sr ON sr.id = d.opened_in_report_id` → `orders o ON o.id = sr.order_id` → `equipment e ON e.id = d.equipment_id`. Bruk `sr.order_id` (VARCHAR — INGEN parseInt).
  - Filter (tre tilstander, ikke ferdig håndtert): `d.outcome_handled_at IS NULL` OG (`d.outcome IS NOT NULL` ELLER (`d.status <> 'closed'` OG `d.outcome IS NULL`)) — dvs. avvik med utfall ELLER åpne avvik uten kommersiell vurdering.
  - Ekskluder rader uten ordre: `WHERE sr.order_id IS NOT NULL` (avvik uten `opened_in_report_id` faller naturlig ut).
  - Aggreger per `order_id`: kundenavn (`o.customer_name`), liste av avvik (id, anleggsnavn `e.systemnavn`, `checklist_item_label`, `current_summary`, `outcome`, `current_severity`), antall avvik per tilstand.
  - Per ordre: `report_ids` = `array_agg(DISTINCT sr.id)` (for viewOrderPDFs), og boolflagg `has_products` = finnes `service_reports.products_used`/`additional_work` ikke-tom for ordren (sub-select; for "fikset"-visning).
  - Bilder: returner per avvik `imageCount` (sub-select på `avvik_images WHERE deviation_id`) eller bilde-URLer hvis billig — minst antall.
  - Topp-tellere: returner totalsummer per tilstand (for teller-kort).
  - Respons-form (kontrakt):
    ```json
    {
      "counters": { "wants_quote": N, "fixed_on_site": N, "unassessed": N },
      "orders": [
        { "order_id": "ORD-..", "customer_name": "..", "report_ids": ["RPT-.."],
          "has_products": true,
          "deviations": [
            { "id": 12, "equipmentName": "..", "label": "..", "summary": "..",
              "outcome": "wants_quote", "severity": "høy", "imageCount": 2 }
          ],
          "stateCounts": { "wants_quote": 1, "fixed_on_site": 0, "unassessed": 0 } }
      ]
    }
    ```
  - Gate med `enable_deviations_management` (les via moduleFlags; returner tom liste hvis av).

  **Must NOT do**: INGEN parseInt på `order_id`. Ikke endre eksisterende GET-endepunkter. Ikke legg til nye kolonner. Ikke gruppér på `equipment_id` for ordre-nivå (det er per anlegg INNE i en ordre).

  **Recommended Agent Profile**: `unspecified-high` — sammensatt SQL-aggregering + kontrakt. Skills: ingen.

  **Parallelization**: Can Run In Parallel: YES · Wave 2 · Blocks: 10 · Blocked By: 1.

  **References**:
  - `src/routes/admin/deviations.js:50-69` (DEVIATION_SELECT), `:171-270` (GET liste-mønster: filter-bygging, params, respons). WHY: kopier query-/respons-stil og `db.getTenantConnection`-bruk.
  - `migrations/000-base-schema.sql:302-308` — `service_reports` kolonner (order_id, equipment_id, products_used, additional_work).
  - `scripts/migrations/2026-05-deviations-foundation.js` — `deviations`/`avvik_images`-kolonner for sub-selects.
  - `src/services/moduleFlags.js` — `loadModuleFlags` for gating.
  - WHY: deviations har ingen order_id; ordre-stien går via opened_in_report_id→service_reports (bekreftet beslutning D1).

  **Acceptance Criteria** (agent-eksekvert):
  - [ ] curl `GET /api/admin/deviations/worklist` (autentisert) → 200, JSON matcher kontrakt over.
  - [ ] Avvik gruppert korrekt per `order_id`; `counters` summerer per tilstand.
  - [ ] Avvik uten `opened_in_report_id`/ordre er IKKE med.
  - [ ] Med flag `enable_deviations_management=false` → tom `orders`-liste.

  **QA Scenarios**:
  ```
  Scenario: Gruppering per ordre (happy)
    Tool: Bash (curl) + SQL seed
    Steps:
      1. Seed: 2 avvik på samme ordre (to anlegg), 1 avvik på annen ordre, alle outcome_handled_at NULL.
      2. curl GET /api/admin/deviations/worklist -b <admin-cookie>
    Expected Result: 2 ordre-objekter; første har deviations.length==2 og report_ids ikke-tom; counters stemmer.
    Evidence: .omo/evidence/task-4-worklist.json

  Scenario: Avvik uten ordre ekskluderes (edge)
    Tool: Bash (curl) + SQL
    Steps:
      1. Seed avvik med opened_in_report_id=NULL.
      2. curl worklist.
    Expected Result: det avviket finnes ikke i responsen.
    Evidence: .omo/evidence/task-4-no-order-excluded.json
  ```

  **Commit (forslag)**: `feat(admin/deviations): add per-order worklist endpoint` · fil: `src/routes/admin/deviations.js`

- [ ] 5. `admin/deviations.js` — PUT outcome / outcome_handled_at / not_applicable

  **What to do**:
  - Utvid eksisterende `PUT /api/admin/deviations/:id` (l.350-477) ADDITIVT, eller legg et nytt fokusert endepunkt `PUT /api/admin/deviations/:id/outcome`. Anbefalt: utvid eksisterende PUT med nye valgfrie body-felt (mindre flate, samme mønster):
    - `outcome` (valider mot `fixed_on_site`/`wants_quote`/`not_applicable`/`null`) — admin-override for uavklarte.
    - `markHandled` (bool) → setter `outcome_handled_at = NOW()` (kvitter ut). `markHandled:false` → `outcome_handled_at = NULL` (angre).
    - Hvis `outcome === 'not_applicable'` → sett også `outcome_handled_at = NOW()` (ikke-aktuelt = ferdig håndtert).
  - `:id` er `deviations.id` (SERIAL/INTEGER) → eksisterende `parseInt(req.params.id,10)` (l.282-285) er korrekt (IKKE en VARCHAR-id).
  - Bygg UPDATE additivt i samme stil som eksisterende felt-bygging (l.361-425). Rør IKKE eksisterende status/assign/deadline/severity-logikk.

  **Must NOT do**: Ikke rør `quote_id` her (settes av Task 7). Ikke endre eksisterende PUT-felter. Ikke parseInt på noe VARCHAR.

  **Recommended Agent Profile**: `unspecified-high` — additiv endepunkt-utvidelse med validering. Skills: ingen.

  **Parallelization**: Can Run In Parallel: YES · Wave 2 · Blocks: 10 · Blocked By: 1.

  **References**:
  - `src/routes/admin/deviations.js:350-477` (PUT-mønster: felt-validering, dynamisk SET-bygging, params, COALESCE-mønster for assigned_at l.425). WHY: speil dette for outcome/handled additivt.
  - `:282-285` — `parseInt` på deviation-id (korrekt mønster, behold).
  - WHY: outcome er uavhengig av closure_mode (beslutning D2) — ikke bland.

  **Acceptance Criteria** (agent-eksekvert):
  - [ ] curl PUT med `{outcome:'not_applicable'}` → 200; SQL viser `outcome='not_applicable'` OG `outcome_handled_at` satt.
  - [ ] curl PUT med `{markHandled:true}` → `outcome_handled_at` satt.
  - [ ] curl PUT med ugyldig `outcome:'foo'` → 400.
  - [ ] Eksisterende PUT-felter (status/deadline) virker fortsatt (regresjon).

  **QA Scenarios**:
  ```
  Scenario: Kvitter ut + ikke aktuelt (happy)
    Tool: Bash (curl) + SQL
    Steps:
      1. Seed åpen deviation, outcome_handled_at NULL.
      2. curl PUT /api/admin/deviations/<id> {"markHandled":true} -b <admin>
      3. curl PUT /api/admin/deviations/<id2> {"outcome":"not_applicable"} -b <admin>
    Expected Result: <id> har outcome_handled_at satt; <id2> har outcome='not_applicable' + handled_at satt.
    Evidence: .omo/evidence/task-5-put-outcome.txt

  Scenario: Ugyldig outcome avvises (negativ)
    Tool: Bash (curl)
    Steps: 1. curl PUT {"outcome":"foo"}
    Expected Result: HTTP 400 med feilmelding.
    Evidence: .omo/evidence/task-5-invalid.txt
  ```

  **Commit (forslag)**: `feat(admin/deviations): admin outcome override + handled status` · fil: `src/routes/admin/deviations.js`

- [ ] 6. `quotes.js` — berik quote-payload med `report_ids` per ordre

  **What to do**:
  - I `src/routes/quotes.js`, GET `/` (l.63-99) og evt. PUT `/:id` respons (l.221-239): legg ADDITIVT til `report_ids` per quote via sub-select/LEFT JOIN LATERAL på `service_reports WHERE order_id = q.order_id` → `array_agg(id)`.
  - I `transformQuoteForFrontend` (l.28-60): inkluder `report_ids` (default `[]`) i retur-objektet.
  - Formål: `tilbud.js` "Se servicerapport"-lenke (Task 12) kan kalle `viewOrderPDFs(order_id, report_ids)`.

  **Must NOT do**: Ikke endre quote-skjema/INSERT. Ikke endre PDF/items-logikk. Rent additivt felt i respons.

  **Recommended Agent Profile**: `quick` — ett ekstra felt i query + transform. Skills: ingen.

  **Parallelization**: Can Run In Parallel: YES · Wave 2 · Blocks: 12 · Blocked By: None.

  **References**:
  - `src/routes/quotes.js:63-99` (GET-query + map), `:28-60` (transformQuoteForFrontend). WHY: additivt innstikk i eksisterende SELECT/transform.
  - `migrations/000-base-schema.sql:302-308` — `service_reports.order_id`/`id`.
  - `public/admin/assets/js/rapporter.js:761-770` — `viewOrderPDFs(orderId, reportIds)`-signatur (forbruker av feltet).

  **Acceptance Criteria** (agent-eksekvert):
  - [ ] curl `GET /api/quotes` → hver quote har `report_ids: string[]`.
  - [ ] Quote uten rapporter → `report_ids: []` (ingen crash).

  **QA Scenarios**:
  ```
  Scenario: report_ids beriket (happy)
    Tool: Bash (curl)
    Steps: 1. curl GET /api/quotes -b <admin> | jq '.[0].report_ids'
    Expected Result: array (kan være tom), ingen feil; for quote med ordre som har rapport → ikke-tom.
    Evidence: .omo/evidence/task-6-report-ids.json
  ```

  **Commit (forslag)**: `feat(quotes): expose report_ids per quote for report link` · fil: `src/routes/quotes.js`

- [ ] 7. `admin/deviations.js` — POST lag tilbud fra flaggede avvik

  **What to do**:
  - Nytt endepunkt `POST /api/admin/deviations/quote-from-order/:orderId` i `src/routes/admin/deviations.js`. `:orderId` er VARCHAR — INGEN parseInt.
  - Hent flaggede avvik for ordren: join via `service_reports.order_id = :orderId`, `d.outcome = 'wants_quote'` OG `d.outcome_handled_at IS NULL` OG `d.quote_id IS NULL` (ekskluder allerede-tilbudte).
  - Hvis ingen kvalifiserende avvik → 400 med tydelig melding.
  - Grupper avvik per anlegg (`service_reports.equipment_id` / `equipment.systemnavn`). Bygg `description` som fritekst gruppert per anlegg (D3 supersedert — INGEN products[]-linjer):
    ```
    Anlegg {systemnavn}:
    – {checklist_item_label}: {current_summary}
    – ...

    Anlegg {systemnavn2}:
    – ...
    ```
  - Opprett ETT quote ved å GJENBRUKE samme INSERT-kontrakt som `POST /api/quotes` (l.149-165): `id = QUOTE-${Date.now()}-${rand}`, `order_id = :orderId`, `items = {description, estimatedHours:0, products:[]}`, `total_amount = 0`, `status = 'pending'`. (Gjenbruk: kall intern delt funksjon ELLER repliser nøyaktig INSERT — ikke lag ny tilbudsmekanisme/PDF.)
  - Sett `quote_id` på de inkluderte avvikene (UPDATE deviations SET quote_id=$1 WHERE id = ANY($2)).
  - Respons: `{ quoteId, includedDeviationIds: [...] }` (front åpner rediger-modalen på `quoteId`, Task 12).
  - Gate med `enable_deviations_management`.

  **Must NOT do**: Ikke lag parallell tilbuds-PDF/lagring. Ikke per-anlegg products[]-linjer. Ikke parseInt på orderId. Ikke sett outcome_handled_at (det er admins separate "håndtert"-handling). Ikke inkluder avvik som allerede har quote_id.

  **Recommended Agent Profile**: `deep` — tverrgående (deviations+quotes), idempotens/edge-cases, må gjenbruke kontrakt presist. Skills: ingen.

  **Parallelization**: Can Run In Parallel: YES · Wave 3 · Blocks: 10,12 · Blocked By: 1,3.

  **References**:
  - `src/routes/quotes.js:128-176` (POST-kontrakt: quoteId-format, itemsWithMeta, INSERT-kolonner, status 'pending'). WHY: gjenbruk EKSAKT denne INSERT-formen — ikke dupliser logikk.
  - `src/routes/admin/deviations.js` — `db.getTenantConnection`, gating, parseInt-mønster (men IKKE på orderId).
  - `migrations/000-base-schema.sql:285-308` — quotes + service_reports kolonner.
  - `src/services/quotePDFGenerator.js:404-451` — bekreft at tom `products[]` + fritekst `description` rendrer rent ("Prosjektbeskrivelse", ingen "Materialer"-blokk). WHY: validerer D3-beslutningen.
  - WHY: instruks krever ETT tilbud per ordre, gjenbruk, sett quote_id.

  **Acceptance Criteria** (agent-eksekvert):
  - [ ] curl POST quote-from-order → 201/200, returnerer `quoteId`; quote finnes med `status='pending'`, `order_id` korrekt, `items.products=[]`, `description` gruppert per anlegg.
  - [ ] Inkluderte avvik har `quote_id` satt.
  - [ ] Andre kall for samme ordre (uten nye wants_quote) → 400 (ingen kvalifiserende avvik) — idempotens-vern.
  - [ ] Ordre uten wants_quote-avvik → 400.

  **QA Scenarios**:
  ```
  Scenario: Ett tilbud per ordre, quote_id satt (happy)
    Tool: Bash (curl) + SQL
    Steps:
      1. Seed 2 wants_quote-avvik (2 anlegg) på ordre X, quote_id NULL.
      2. curl POST /api/admin/deviations/quote-from-order/X -b <admin>
      3. SQL: SELECT status, items FROM quotes WHERE id=<quoteId>; SELECT quote_id FROM deviations WHERE id IN (...).
    Expected Result: ett quote status=pending, description har begge anleggs-overskrifter, products tom; begge avvik har quote_id=<quoteId>.
    Evidence: .omo/evidence/task-7-quote-from-avvik.txt

  Scenario: Allerede tilbudt ekskluderes (edge)
    Tool: Bash (curl)
    Steps:
      1. Sett quote_id på avvikene fra forrige.
      2. curl POST quote-from-order/X igjen.
    Expected Result: HTTP 400 "ingen kvalifiserende avvik".
    Evidence: .omo/evidence/task-7-already-quoted.txt
  ```

  **Commit (forslag)**: `feat(admin/deviations): create quote from flagged deviations (reuse quote insert)` · fil: `src/routes/admin/deviations.js`

- [ ] 8. `service.js`/`service.html` — tekniker utfallsvalg i avviksboks + serialisering

  **What to do**:
  - I HVER avvik-render-funksjon som har en `.avvik-container` (`createOkAvvikItemHTML` l.2158, `createOkAvvikImageItemHTML` l.2180, `createOkAvvikSeverityItemHTML` l.2217, `createOkAvvikCommentItemHTML` l.2253, `createOkByttetAvvikItemHTML` l.2283): legg til ETT utfallsvalg UNDER bildefeltet i avviks-containeren — to tydelige knapper/radio: "Fikset på stedet" (`fixed_on_site`) og "Ønsker tilbud" (`wants_quote`). Default: ingen valgt. Bruk en delt hjelpefunksjon `outcomeChoiceHTML(item.id)` for å unngå duplisering på tvers av de fem malene.
  - I `getChecklistItemValue` (l.4184-4280): i HVER avvik-gren (`ok_avvik`, `ok_avvik_comment`, `ok_avvik_image`, `ok_avvik_severity`, `ok_byttet_avvik`) — når `status === 'avvik'`, les valgt utfall og legg `result.outcome = <valgt|null>`. Følg SAMME mønster som `result.severity`/`result.avvikComment`.
  - Gjenoppretting ved lasting (`populateChecklistItems`-stien rundt l.3224-3367): sett valgt utfall-knapp aktiv fra lagret `result.outcome` (speil severity-gjenoppretting l.3352-3367).
  - Følg `state` (IKKE `pageState`) og `?orderId=&equipmentId=` (uendret).

  **Must NOT do**: Ikke bygg nytt timer/produkt-felt. Ikke endre severity/comment/bilde-felt. Ikke rør layout utover utfallsvalget. Ikke endre URL-param-konvensjon.

  **Recommended Agent Profile**: `visual-engineering` — UI i fem maler + state-serialisering, må matche eksisterende mønster nøyaktig. Skills: ingen (vanilla JS).

  **Parallelization**: Can Run In Parallel: YES · Wave 3 · Blocks: 9 · Blocked By: 1 (konseptuelt; frontend-data uavhengig, men outcome-feltet leses av Task 3).

  **References**:
  - `public/app/assets/js/service.js:2158-2322` (de fem avvik-render-funksjonene, `.avvik-container`-struktur). WHY: utfallsvalg legges i samme container, etter bildefelt.
  - `:4184-4280` (getChecklistItemValue avvik-grener, `result.severity`-mønster l.4261-4280). WHY: speil severity for outcome.
  - `:3352-3367` (severity-gjenoppretting). WHY: speil for outcome.
  - WHY: instruks krever SAMME mønster som severity lagres/leses i dag.

  **Acceptance Criteria** (agent-eksekvert, Playwright):
  - [ ] Sett et punkt til "Avvik" → avviksboks viser to utfallsknapper, ingen aktiv som default.
  - [ ] Velg "Ønsker tilbud" → knapp aktiv; lagre rapport → reload → valget gjenopprettet.
  - [ ] Lagret checklist-data inneholder `outcome:'wants_quote'` på riktig item (verifiser via API/DOM).

  **QA Scenarios**:
  ```
  Scenario: Velg og lagre utfall (happy)
    Tool: Playwright
    Steps:
      1. Åpne /app/service.html?orderId=<o>&equipmentId=<e>.
      2. Klikk "Avvik" på et ok_avvik_severity-punkt; vent på .avvik-container.
      3. Klikk "Ønsker tilbud"; fyll beskrivelse; klikk lagre.
      4. Reload; verifiser "Ønsker tilbud" er aktiv.
    Expected Result: valg aktivt etter reload; ingen konsollfeil.
    Evidence: .omo/evidence/task-8-outcome-ui.png

  Scenario: Default ingen valgt (edge)
    Tool: Playwright
    Steps: 1. Sett punkt til Avvik. 2. Inspiser utfallsknapper.
    Expected Result: ingen knapp har aktiv-klasse før klikk.
    Evidence: .omo/evidence/task-8-default-none.png
  ```

  **Commit (forslag)**: `feat(service): technician outcome choice in deviation box` · filer: `public/app/assets/js/service.js`, `public/app/service.html` (kun hvis container-markup trengs)

- [ ] 9. `service.js` — finalize-validering + "fikset"-påminnelse

  **What to do**:
  - I `finalizeAnlegg` (l.4650), FØR `saveChecklist`/`/complete`: legg en pre-valideringsløkke over avvik-items. For hvert item med `status==='avvik'` og `outcome==='wants_quote'` og tom beskrivelse → blokker ferdigstilling, vis `showToast(...)` og scroll/fokus til punktet. Returner uten å fullføre.
  - "Fikset på stedet": når et avvik har `outcome==='fixed_on_site'`, vis en diskré påminnelse (toast eller inline-hint) om å registrere timer/produkter, med lenke/scroll til eksisterende `product-lines-container` (l.3024) / `additional-work-lines-container` (l.3039). KUN påminnelse — ingen nytt felt, ikke-blokkerende.
  - Gjenbruk eksisterende `collectChecklistData`/`getChecklistItemValue` for å lese outcome+beskrivelse (ikke ny parsing).

  **Must NOT do**: Ikke blokker på `fixed_on_site` (kun påminnelse). Ikke bygg nytt timer/produkt-felt. Ikke endre `/complete`-kallet. Ikke valider andre item-typer.

  **Recommended Agent Profile**: `unspecified-high` — validering + UX-hint i kritisk ferdigstillings-sti. Skills: ingen.

  **Parallelization**: Can Run In Parallel: NO (samme funksjon som kan berøres av 8) · Wave 3 (etter 8) · Blocks: ingen · Blocked By: 8.

  **References**:
  - `public/app/assets/js/service.js:4650-4685` (finalizeAnlegg). WHY: innstikkspunkt for pre-validering.
  - `:4088-4146` (collectChecklistData) + `:4184-4280` (getChecklistItemValue). WHY: gjenbruk for å lese outcome/beskrivelse.
  - `:3024, 3039` (product-lines-container/additional-work-lines-container). WHY: scroll-mål for påminnelse.

  **Acceptance Criteria** (agent-eksekvert, Playwright):
  - [ ] "Ønsker tilbud" + tom beskrivelse → ferdigstilling blokkeres med toast; rapport IKKE completed.
  - [ ] "Ønsker tilbud" + utfylt beskrivelse → ferdigstilling går gjennom.
  - [ ] "Fikset på stedet" → påminnelse vises; ferdigstilling IKKE blokkert.

  **QA Scenarios**:
  ```
  Scenario: Ønsker tilbud tvinger beskrivelse (negativ)
    Tool: Playwright
    Steps:
      1. Sett punkt til Avvik, velg "Ønsker tilbud", la beskrivelse stå tom.
      2. Klikk Ferdigstill.
    Expected Result: toast vises, modal/side forblir (ikke navigert til orders.html), rapport-status ikke 'completed'.
    Evidence: .omo/evidence/task-9-block-empty.png

  Scenario: Fikset viser påminnelse (happy)
    Tool: Playwright
    Steps: 1. Velg "Fikset på stedet". 2. Klikk Ferdigstill.
    Expected Result: diskré påminnelse om timer/produkter vises; ferdigstilling fortsetter.
    Evidence: .omo/evidence/task-9-fixed-reminder.png
  ```

  **Commit (forslag)**: `feat(service): require description for wants_quote + fixed reminder` · fil: `public/app/assets/js/service.js`

- [ ] 10. `avvik.html`/`avvik.js` — admin arbeidsliste-visning

  **What to do**:
  - I `public/admin/avvik.html`: legg til en view-toggle (to knapper/faner) øverst i hero-seksjonen: "Avviksliste" (eksisterende tabell) og "Arbeidsliste" (ny). Behold eksisterende tabell uendret; ny visning er en separat container som skjules/vises.
  - I `public/admin/assets/js/avvik.js`: legg til `loadWorklist()` (GET `/api/admin/deviations/worklist`), `renderWorklist(data)` og toggle-håndtering. Følg eksisterende `state`/fetch/render-mønster (l.87-181, `updateDeviation` l.122-143).
  - Teller-kort øverst i arbeidslista fra `data.counters` (tre tilstander: ønsker tilbud / fikset på stedet / uvurdert).
  - Per ordre-kort: kundenavn, anlegg+avvik-liste, og betinget av tilstand knapper:
    - "Lag tilbud" → POST `/api/admin/deviations/quote-from-order/:orderId` (Task 7) → ved suksess naviger til `tilbud.html` og åpne rediger-modal på `quoteId` (Task 12 håndterer modal-åpning; her: `window.location = '/admin/tilbud.html?openQuote=<quoteId>'`).
    - "Se rapport" → `window.viewOrderPDFs(order.order_id, order.report_ids)` (gjenbruk; krever at rapporter.js' funksjon er tilgjengelig — last `rapporter.js` eller repliser den lille funksjonen hvis ikke tilgjengelig på siden).
    - "Ikke aktuelt" → PUT `/api/admin/deviations/:id` `{outcome:'not_applicable'}` (per avvik) (Task 5).
    - "Håndtert" → PUT `/api/admin/deviations/:id` `{markHandled:true}` (per avvik eller per ordre-batch).
  - Etter en handling: re-fetch worklist.
  - "Fikset"-visning: hvis `order.has_products` true, vis indikator om at timer/produkter er registrert.

  **Must NOT do**: Ikke endre eksisterende avviksliste-tabell/detaljpanel. Ikke bygg ny tilbuds-UI (åpne eksisterende tilbud.html). Ikke parseInt på order_id.

  **Recommended Agent Profile**: `visual-engineering` — sammensatt admin-UI som speiler eksisterende mønster. Skills: ingen.

  **Parallelization**: Can Run In Parallel: YES · Wave 4 · Blocks: ingen · Blocked By: 4,5,7.

  **References**:
  - `public/admin/avvik.html:233-329` (hero, filtre, tabell, detaljpanel) — sted for view-toggle + ny container.
  - `public/admin/assets/js/avvik.js:87-181` (loadDeviations/buildQueryString/renderTable), `:122-143` (updateDeviation PUT). WHY: kopier fetch/render/PUT-stil.
  - `public/admin/assets/js/rapporter.js:761-770` (viewOrderPDFs). WHY: gjenbruk for "Se rapport".
  - Kontrakt fra Task 4 (worklist-respons) + Task 5/7-endepunkter.

  **Acceptance Criteria** (agent-eksekvert, Playwright):
  - [ ] Toggle til "Arbeidsliste" → teller-kort + ordre-kort vises fra worklist-API.
  - [ ] "Lag tilbud" på et ordre-kort → navigerer til tilbud.html med quoten åpen.
  - [ ] "Se rapport" → åpner PDF (ny fane / `/api/admin/reports/<id>/pdf`).
  - [ ] "Ikke aktuelt"/"Håndtert" → avviket forsvinner fra lista etter re-fetch.
  - [ ] Eksisterende avviksliste-tabell uendret (regresjon).

  **QA Scenarios**:
  ```
  Scenario: Arbeidsliste + handlinger (happy)
    Tool: Playwright
    Steps:
      1. Seed wants_quote-avvik på ordre X.
      2. Åpne /admin/avvik.html, klikk "Arbeidsliste".
      3. Verifiser teller-kort og ordre-kort for X.
      4. Klikk "Håndtert" på avviket; vent re-fetch.
    Expected Result: kort vises korrekt; etter "Håndtert" forsvinner avviket; tellere oppdateres.
    Evidence: .omo/evidence/task-10-worklist-ui.png

  Scenario: Se rapport (happy)
    Tool: Playwright
    Steps: 1. Klikk "Se rapport" på ordre-kort.
    Expected Result: PDF-fane/-respons åpnes mot /api/admin/reports/<id>/pdf.
    Evidence: .omo/evidence/task-10-se-rapport.png
  ```

  **Commit (forslag)**: `feat(admin/avvik): per-order worklist view with actions` · filer: `public/admin/avvik.html`, `public/admin/assets/js/avvik.js`

- [ ] 11. `tilbud.js` — "Opprett tilbud"-knapp åpner eksisterende rediger-modal tom

  **What to do**:
  - I `public/admin/tilbud.html`: legg en "Opprett tilbud"-knapp i kort-headeren (l.33-44, ved status-filter).
  - I `public/admin/assets/js/tilbud.js`: knappen kaller `openEditModal({})` (eller en tynn `openCreateModal()` som kaller eksisterende `openEditModal` med et tomt quote-objekt). GJENBRUK den eksisterende modalen (l.387-624) med blanke felter. Lagre-knappen i modalen må håndtere "ny" vs "rediger": hvis quoten ikke har `id`, POST `/api/quotes` (krever `orderId` — modalen må derfor ha et ordre-/kundevalg ELLER opprettelse skjer kun fra avvik/ordre-kontekst).
  - **Avklaring i build**: eksisterende modal har ikke ordre-/kundevalg. For "fritt-grunnlag"-opprettelse trengs et ordre-valg. Minimal tilnærming: legg ETT ordre-velger-felt (select av ordre) i modalen KUN når den åpnes i opprett-modus. Hold det minimalt; ikke bygg ny modal.

  **Must NOT do**: Ikke lag ny modal/skjema. Ikke duplisér lagre-logikk (utvid eksisterende `saveBtn.onclick` til å POSTe når id mangler). Ikke endre rediger-flyten for eksisterende tilbud.

  **Recommended Agent Profile**: `quick` — gjenbruk av eksisterende modal + én inngang. Skills: ingen.

  **Parallelization**: Can Run In Parallel: YES · Wave 4 · Blocks: ingen · Blocked By: None (men koordiner med Task 12 som også rører tilbud.js).

  **References**:
  - `public/admin/tilbud.html:33-44` (kort-header for knapp), `:88-105` (edit-modal markup).
  - `public/admin/assets/js/tilbud.js:387-624` (openEditModal + saveBtn.onclick PUT-logikk). WHY: gjenbruk; utvid save til POST når id mangler.
  - `src/routes/quotes.js:128-176` (POST-kontrakt: krever orderId). WHY: opprett-modus må sende orderId.

  **Acceptance Criteria** (agent-eksekvert, Playwright):
  - [ ] "Opprett tilbud" åpner SAMME modal med blanke felter.
  - [ ] Lagre i opprett-modus med valgt ordre → nytt pending quote vises i lista.
  - [ ] Rediger eksisterende tilbud uendret (regresjon).

  **QA Scenarios**:
  ```
  Scenario: Opprett via eksisterende modal (happy)
    Tool: Playwright
    Steps:
      1. Åpne /admin/tilbud.html, klikk "Opprett tilbud".
      2. Verifiser at det er edit-quote-modal (samme DOM-id) med tomme felter.
      3. Velg ordre, fyll beskrivelse, lagre.
    Expected Result: nytt quote i lista med status "Venter".
    Evidence: .omo/evidence/task-11-create-quote.png
  ```

  **Commit (forslag)**: `feat(admin/tilbud): create-quote entry reusing edit modal` · filer: `public/admin/tilbud.html`, `public/admin/assets/js/tilbud.js`

- [ ] 12. `tilbud.js` — åpne modal på avviks-quote + "Se servicerapport"-lenke

  **What to do**:
  - **Auto-åpne**: ved last, les `?openQuote=<id>` (fra Task 10-navigasjon). Hvis satt: etter `loadData()`, velg quoten og kall `openEditModal(quote)` automatisk slik admin priser den ferdig-forhåndsutfylte avviks-quoten.
  - **"Se servicerapport"-lenke**: i `displayQuoteDetails` (l.91-229), i Ordre-seksjonen (l.180-183): hvis `quote.order_id` finnes OG `quote.report_ids?.length` (fra Task 6) → vis en "Se servicerapport"-knapp/lenke som kaller `viewOrderPDFs(quote.order_id, quote.report_ids)`. Betinget rendering på `order_id` (bekreftet krav).
  - Gjør `viewOrderPDFs` tilgjengelig på tilbud.html (last `rapporter.js` eller inkluder den lille funksjonen — gjenbruk, ikke omskriv).

  **Must NOT do**: Ikke endre quote-prising/PDF-generering. Ikke duplisér viewOrderPDFs-logikk (gjenbruk). Vis lenken KUN når order_id finnes.

  **Recommended Agent Profile**: `unspecified-high` — integrasjon (deeplink + betinget lenke + gjenbrukt funksjon). Skills: ingen.

  **Parallelization**: Can Run In Parallel: YES · Wave 4 · Blocks: ingen · Blocked By: 6,7 (koordiner filberøring med Task 11).

  **References**:
  - `public/admin/assets/js/tilbud.js:12-25` (loadData), `:77-89` (selectQuote), `:91-229` (displayQuoteDetails, Ordre-seksjon l.180-183), `:387` (openEditModal). WHY: deeplink + lenke-innstikk.
  - `public/admin/assets/js/rapporter.js:761-770` (viewOrderPDFs). WHY: gjenbruk.
  - Task 6 (`report_ids` i quote-payload), Task 7 (`quoteId`-respons).

  **Acceptance Criteria** (agent-eksekvert, Playwright):
  - [ ] Naviger til `tilbud.html?openQuote=<id>` → rediger-modal åpnes automatisk på den quoten.
  - [ ] Quote med `order_id` + report_ids → "Se servicerapport"-lenke vises og åpner PDF.
  - [ ] Quote uten `order_id` → ingen lenke.

  **QA Scenarios**:
  ```
  Scenario: Deeplink åpner modal (happy)
    Tool: Playwright
    Steps: 1. Lag avviks-quote (Task 7). 2. Gå til /admin/tilbud.html?openQuote=<id>.
    Expected Result: edit-modal åpen på <id> med forhåndsutfylt description per anlegg.
    Evidence: .omo/evidence/task-12-deeplink.png

  Scenario: Se servicerapport betinget (happy + edge)
    Tool: Playwright
    Steps: 1. Velg quote med order_id → klikk "Se servicerapport". 2. Velg quote uten order_id.
    Expected Result: (1) PDF åpnes; (2) lenken vises ikke.
    Evidence: .omo/evidence/task-12-se-servicerapport.png
  ```

  **Commit (forslag)**: `feat(admin/tilbud): open prefilled avvik-quote + service report link` · fil: `public/admin/assets/js/tilbud.js`

- [ ] 13. `orders.js` — skjul manuell tilbudsknapp for tekniker via flag

  **What to do**:
  - I `public/app/assets/js/orders.js`: last module-flagget `show_manual_quote_button` (følg eksisterende `hmsSettings`-mønster l.16-28 via `/api/images/app-settings`, ELLER `/api/admin/module-flags`/eksisterende flag-kilde for tekniker-app — bruk samme kilde som andre tekniker-flagg).
  - **BINDENDE STOPP-BETINGELSE (flag-kilde):** Planen VET IKKE sikkert om tekniker-appen henter `module_flags` fra `/api/images/app-settings` eller et annet endepunkt. Ved START av denne tasken: bekreft den faktiske flag-kilden ved å lese koden/responsen. Hvis kilden IKKE er entydig bekreftet → **STOPP og rapporter** (supersede planen åpent) FØR du endrer render. IKKE gjett — en betinget render som leser feil flag-kilde vil vise knappen likevel og gi falsk "ferdig".
  - Ved render av "Opprett tilbud"-knappen (l.405): vis den KUN hvis `show_manual_quote_button !== false`. Behold all knapp-/handler-kode (`handleCreateQuote` osv.) intakt — kun betinget rendering.

  **Must NOT do**: Ikke slett tilbudsknapp-koden eller handlerne. Ikke endre admin-tilbudsflyt. Ikke ny flag-kilde hvis en allerede finnes for tekniker-flagg.

  **Recommended Agent Profile**: `quick` — én betinget rendering + flag-innlasting. Skills: ingen.

  **Parallelization**: Can Run In Parallel: YES · Wave 4 · Blocks: ingen · Blocked By: 2.

  **References**:
  - `public/app/assets/js/orders.js:16-28` (hmsSettings-innlasting via /api/images/app-settings), `:405` (create-quote-btn render), `:609` (handler). WHY: speil hmsSettings-mønsteret for det nye flagget; betinget rendering på l.405.
  - `src/services/moduleFlags.js` (Task 2-flagget). WHY: kilde for default.
  - Verifiser i build at `/api/images/app-settings` eksponerer module_flags (ellers bruk korrekt endepunkt).

  **Acceptance Criteria** (agent-eksekvert, Playwright):
  - [ ] Med `show_manual_quote_button=false` → knappen er FAKTISK FRAVÆRENDE i tekniker-ordrevisningens DOM ved kjøretid (Playwright asserterer at selektoren `[data-action="create-quote"]` / `.create-quote-btn` ikke finnes) — IKKE bare at koden er betinget.
  - [ ] Med default (true) → knappen vises som før.
  - [ ] `handleCreateQuote`/handler-kode finnes fortsatt (grep).
  - [ ] Flag-kilden er bekreftet (jf. stopp-betingelse) — bevis hvilket endepunkt som faktisk leverte flagget.

  **QA Scenarios**:
  ```
  Scenario: Skjult ved flag false (happy)
    Tool: Playwright + flag-oppsett
    Steps:
      1. Sett tenant show_manual_quote_button=false.
      2. Åpne /app/orders.html?id=<o>.
    Expected Result: ingen "+ Opprett tilbud"-knapp i equipment-lista.
    Evidence: .omo/evidence/task-13-hidden.png

  Scenario: Synlig ved default (regresjon)
    Tool: Playwright
    Steps: 1. Default-tenant. 2. Åpne orders.html.
    Expected Result: knappen vises (uendret oppførsel).
    Evidence: .omo/evidence/task-13-visible.png
  ```

  **Commit (forslag)**: `feat(orders): gate manual quote button behind show_manual_quote_button` · fil: `public/app/assets/js/orders.js`

---

## Final Verification Wave (MANDATORY — etter ALLE implementasjonstasks)

> 4 review-agenter i PARALLELL. ALLE må APPROVE. Ikke kryss av F1–F4 før Tom-Eriks eksplisitte "okay".
> Avvis → fiks → re-kjør → presenter på nytt.
>
> **BINDENDE AVSLUTNINGSPORT:** Etter at ALLE fire (F1–F4) har gitt APPROVE, presenter resultatene
> SAMLET til Tom-Erik med **verbatim bevis** fra `.omo/evidence/` (seed-SQL, curl-/API-utdrag,
> Playwright-screenshots, test-/migrasjonsoutput — ikke parafrasert, ikke "det virker"). Vent på
> Tom-Eriks eksplisitte "okay". INGENTING markeres ferdig, og F1–F4 krysses IKKE av, før den
> godkjenningen foreligger. Tom-Erik eier alle commits — ingen git add/commit/push fra agenten.

- [ ] F1. **Plan-compliance** — `oracle`
  Les planen. For hver "Must Have": verifiser at den finnes (les fil / curl / kjør). For hver
  "Must NOT Have": søk etter forbudt mønster (parseInt på VARCHAR-id, products[]-linjer i avviks-quote,
  omskrevet processReportDeviations, ny rute kun ett sted) — avvis med fil:linje om funnet. Sjekk
  bevisfiler i `.omo/evidence/`.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Kodekvalitet** — `unspecified-high`
  Kjør repoets test-/lint-kommandoer + relevante enhetstester. Gjennomgå endrede filer for `as any`-ekvivalenter,
  tomme catch, console.log i prod-sti, utkommentert kode, ubrukte imports, AI-slop (over-kommentering,
  generiske navn). Bekreft kun additive diffs i `deviationsService.js`/`quotes.js`.
  Output: `Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Reell manuell QA** — `unspecified-high` (+ `playwright`)
  Fra ren tilstand: kjør HVER QA-scenario fra HVER task. Bevis i `.omo/evidence/final-qa/`.

  **BINDENDE BETINGELSE F3.a — Teknisk vs. kommersiell status MÅ bevises (kjernekonsept):**
  Task 4s "uvurdert"-filter er planens mest sammensatte SQL og utgjør hele skillet mellom teknisk
  og kommersiell status. F3 MÅ bruke konkret seed-data og bevise BEGGE:
  - Et **teknisk lukket** avvik (`status='closed'`, `outcome IS NULL`, `outcome_handled_at IS NULL`)
    dukker IKKE opp i arbeidslista.
  - Et **åpent** avvik uten kommersiell vurdering (`status <> 'closed'`, `outcome IS NULL`,
    `outcome_handled_at IS NULL`) GJØR det (tilstand "uvurdert").
  - Et avvik med `outcome_handled_at` satt dukker IKKE opp (ferdig håndtert).
  Hvis filteret bommer på noen av disse → **REJECT** (kjernekonseptet er brutt). Vis seed-SQL +
  worklist-respons verbatim som bevis.

  **BINDENDE BETINGELSE F3.b — Hele ende-til-ende-kjeden MÅ verifiseres samlet:**
  Task 3 (leser `outcome`) bygges i Wave 2, men `outcome` produseres først av Task 8 i Wave 3 —
  leseren før skriveren. Enhetstester dekker delene isolert; den EKTE kjeden kan først testes etter
  ALLE implementasjonstasks. F3 MÅ kjøres til slutt og bevise hele flyten i ett sammenhengende løp:
  tekniker setter "ønsker tilbud" → ferdigstill rapport → avvik i admin-arbeidsliste → "Lag tilbud"
  → rediger-modal åpnes på pending quote → "Se servicerapport" åpner PDF.
  Ryker ETT ledd i kjeden → **REJECT** (ikke delvis pass). Lagre stegvis bevis (screenshots + API-/SQL-utdrag).

  Test også edge-cases: avvik uten `opened_in_report_id`, allerede satt `quote_id`, admin-kvittert avvik.
  Output: `Tech-vs-commercial [PASS/FAIL] | E2E-chain [PASS/FAIL] | Scenarios [N/N] | Edge [N] | VERDICT`

- [ ] F4. **Scope-troskap** — `deep`
  For hver task: les "Hva skal gjøres" vs faktisk diff (git diff). Verifiser 1:1 — alt i spec bygget,
  ingenting utover. Sjekk "Må IKKE gjøre". Flagg kontaminering (task som rører annen tasks filer) og
  uforklarte endringer. Bekreft INGEN scope-out-bygging (Tripletex, effektrapport, AI, auto-ordre, layout).
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N] | Unaccounted [CLEAN/N] | VERDICT`

---

## Commit Strategy

> Tom-Erik eier ALLE commits (`git add -p`). Agenten committer ALDRI. Hver task angir foreslått
> commit-melding + filer som forslag til Tom-Erik, men utfører ingen git-operasjon.

## Success Criteria

### Verification Commands (forslag — agent kjører og viser verbatim output)
```bash
node migrations/009-add-deviations-commercial-columns.js --dry-run   # viser SQL, ingen endring
node migrations/009-add-deviations-commercial-columns.js --tenant=airtechdev   # kjør én tenant
# verifiser kolonner:
# SELECT column_name FROM information_schema.columns WHERE table_name='deviations' AND column_name IN ('outcome','outcome_handled_at','quote_id');
```

### Final Checklist (instruks Seksjon 8 — alle må være grønne)
- [ ] Migrasjon idempotent (--dry-run og ekte).
- [ ] Tekniker utfallsvalg, default ingen valgt.
- [ ] "Ønsker tilbud" tvinger beskrivelse (test).
- [ ] "Fikset på stedet" viser påminnelse.
- [ ] `outcome` skrives ved ferdigstilling.
- [ ] Arbeidsliste grupperer per ordre, tre tilstander.
- [ ] "Lag tilbud" = ETT tilbud per ordre, setter `quote_id`.
- [ ] "Se rapport" åpner riktig PDF (viewOrderPDFs).
- [ ] "Ikke aktuelt"/"Håndtert" oppdaterer status.
- [ ] Gammel tilbudsknapp skjult for tekniker, intakt for admin.
- [ ] Ny funksjonalitet via ruter montert i app.js OG server.js.
- [ ] Ingen parseInt på VARCHAR-IDer.
- [ ] Verbatim testoutput levert.

---

## v2-kandidater (utsatt fra v1)

- **Manuell fritt-grunnlag-tilbud** (opprinnelig Task 11): krever egen opprett-sti i tilbud.html
  med ordrevelger (populert via ny GET /api/admin/orders-henting) + gjenbruk av POST /api/quotes.
  Utsatt fordi tilbud.html-konteksten ikke har klientside ordreliste; den avviksdrevne stien dekker
  hovedbehovet i v1. 'Opprett tilbud'-knappen ble fjernet for ikke å villede.
- Per opprinnelig instruks Seksjon 3: Tripletex, effektrapport, AI-tilbudstekst, auto-ordre fra
  akseptert tilbud, beløpsgrenser/signatur/produktkatalog/push.
