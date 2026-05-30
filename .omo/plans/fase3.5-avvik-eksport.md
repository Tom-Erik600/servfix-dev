# Fase 3.5 — Avvik Eksport (CSV + PDF)

## TL;DR

> **Quick Summary**: Legg til CSV- og PDF-eksport for avvik via ny `GET /api/admin/deviations/export` endepunkt og modal-trigger på avvik-siden. Gjenbruker eksisterende Puppeteer-mønster (`unifiedPdfGenerator.js`) og tenant-branding via `loadTenantSettings`.
>
> **Deliverables**:
> - `src/services/deviationsExport.js` — ny service med `generateDeviationsCsv` + `generateDeviationsPdf`
> - `src/routes/admin/deviations.js` — ny `GET /export` route (eksisterende endepunkter urørt)
> - `public/admin/avvik.html` — Eksporter-knapp + modal
> - `public/admin/assets/js/avvik.js` — modal-handlers + blob download
> - `tests/admin-deviations-export.test.js` — 10–15 Jest-tester (TDD)
>
> **Estimated Effort**: Medium (~4–6 timer)
> **Parallel Execution**: YES — 4 waves
> **Critical Path**: 1 → (2 ∥ 3 ∥ 5) → 4 → 6 → F1–F4 → user okay

---

## Context

### Original Request
Fase 3.5: CSV og PDF eksport av deviations. 4 filer + 1 testfil. Bruker pasted-in detaljert implementasjonsbrief med eksempel-spørringer, CSV-kolonner, PDF-layout, modal-UX og test-mønster.

### Interview Summary
**Key Discussions**:
- Skip Excel — kun CSV + PDF
- Ingen endringer i fase 1/2/eksisterende fase 3 (deviationsService.js, reports.js, eksisterende route-handlers)
- Gjenbruk Puppeteer-mønsteret — ikke installer nye PDF-libs
- Dev-deploy only — Tom-Erik håndterer test/prod
- Stopp og spør hvis uklart

**Research Findings** (3 explore-agenter + Metis-konsultasjon):
- `unifiedPdfGenerator.js` (1595 linjer) er kanonisk Puppeteer-mønster: per-request browser via `safePuppeteer`, `fetchAsBuffer` + base64 inline pattern, A4 header/footer
- Tenant-branding ligger i GCS: `tenants/{id}/assets/settings.json` med `companyInfo` + `logo`, fetched via `loadTenantSettings(tenantId)` fra `src/routes/images.js` (5-min cache)
- `avvik_images.image_url` er full public GCS URL — direkte base64-embed virker
- `puppeteer@^24.15.0` allerede installert, Cloud Run kjører med `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`, 300s timeout, 2Gi RAM, concurrency 40 — komfortabel headroom
- `adminTenant` middleware auto-protected på router-nivå — ny `/export` arver beskyttelsen
- KRITISK: route MÅ være registrert i BÅDE `src/app.js` (test) OG `server.js` `loadRoutes()` (prod) — men eksisterende `app.use('/api/admin/deviations', ...)` dekker allerede ny `/export` sub-route i begge filer

### Metis Review
**Identified Gaps** (alle addressert):
- Row cap for store eksporter → 5000 hard cap, HTTP 422 ved overflow
- Concurrency på Puppeteer → in-process mutex, HTTP 429 ved samtidig kjøring
- Cap på observasjoner/bilder per avvik i PDF → 20 obs + 6 bilder per kort med overflow-notater
- Norsk å/ø/æ encoding → UTF-8 + BOM for CSV, lang="no" + utf-8 meta for PDF
- Puppeteer browser-lifecycle → try/finally med browser.close() i finally
- GCS image timeouts → Promise.allSettled + per-image 5s timeout
- Frontend `credentials` → bruk `'include'` (matcher eksisterende avvik.js), ikke `'same-origin'` fra brief

### Locked Decisions (User Confirmed via "fortsett")
- **CSV-struktur**: én rad per avvik (flat)
- **Row cap**: 5000 (422 ved overflow)
- **PDF caps**: 20 observasjoner + 6 bilder per avvik, med "+ X ikke vist" overflow-notater

---

## Work Objectives

### Core Objective
Legge til CSV/PDF-eksport av filtrerte eller komplette deviations for tenant-admin, uten å endre noen eksisterende fase 1/2/3-kode.

### Concrete Deliverables
1. `src/services/deviationsExport.js` — exports `{ generateDeviationsCsv, generateDeviationsPdf }`
2. Ny `router.get('/export', ...)` lagt til i `src/routes/admin/deviations.js`
3. Eksporter-knapp + modal lagt til i `public/admin/avvik.html`
4. Modal-handler + blob-download lagt til i `public/admin/assets/js/avvik.js`
5. Ny test `tests/admin-deviations-export.test.js` med 10–15 grønne tester
6. Verifisert dev-deploy til `servfix-app` i `europe-north1` (project `servfix-dev`)

### Definition of Done
- [ ] `npm test -- tests/admin-deviations-export.test.js` → 10–15 PASS, 0 FAIL
- [ ] `npm test` totalt: 195+ pass (kun 3 pre-existing failures i `admin-planner-clusters.test.js`)
- [ ] `curl https://airtechdev.servfix.no/api/admin/deviations/export?format=csv` → 401 (auth required, korrekt)
- [ ] Manuell test (Playwright): klikk Eksporter → modal åpnes → CSV/PDF lastes ned med riktig filnavn
- [ ] CSV åpner i Excel uten encoding-problemer (å/ø/æ vises korrekt)
- [ ] PDF har tenant-logo, firmanavn, dato, og per-avvik kort med inlined bilder
- [ ] Eksisterende `GET /api/admin/deviations` returnerer fortsatt samme respons (regresjonstest)

### Must Have
- CSV med UTF-8 + BOM, komma-separator, RFC 4180 quote-escaping
- PDF A4 portrait med header (logo + firmanavn) og footer (Side X av Y)
- Tenant-branding fra `loadTenantSettings(tenantId)`
- Filnavn: `avvik-{tenantId}-{YYYY-MM-DD}.{csv|pdf}` via Content-Disposition
- Filter-respekt: query-params (status, severity, search, datoer) speilet fra eksisterende GET `/`
- Scope-valg: `scope=filtered` (default, bruker query-filter) eller `scope=all` (alle for tenant)
- 5000 row cap → HTTP 422 hvis overflow
- In-process mutex → HTTP 429 ved samtidig eksport
- 20 observasjoner + 6 bilder cap per PDF-kort, med "+ X ikke vist" notater
- `try/finally` med `browser.close()` for Puppeteer leak-beskyttelse

### Must NOT Have (Guardrails)
- INGEN endringer i `src/services/deviationsService.js`
- INGEN endringer i `src/services/reports.js`
- INGEN endringer i eksisterende route-handlers i `src/routes/admin/deviations.js` (kun NY `/export` route, eksisterende `GET /`, `PATCH /:id/status` osv. urørt)
- INGEN endringer i `src/routes/images.js` (kun `require()` av `loadTenantSettings`)
- INGEN endringer i `src/app.js` eller `server.js` (ny route dekkes av eksisterende `app.use('/api/admin/deviations', ...)`)
- INGEN ekstrahering av delt filter-helper (`buildDeviationFilters`) — dupliser WHERE-SQL i export-handler
- INGEN nye npm-pakker (puppeteer allerede installert)
- INGEN Excel-eksport
- INGEN client-side PDF-generering
- INGEN endringer i orders.js eller customers.js (separat oppgave)
- INGEN prod-deploy
- INGEN IAM-endringer
- INGEN eksterne URL-referanser i PDF HTML (ingen CDN fonts, eksterne ikoner, eksterne bilder)
- INGEN charts/grafer/farge-badges i PDF utover det brief spesifiserer
- INGEN delegering til sub-agenter under implementasjon (Tom-Erik utfører selv, fase 3-konvensjon)
- INGEN `imageCount` kolonne i CSV (brief har den ikke; kun de 13 brief-spesifiserte kolonnene)

### Spec Framework Integration
Ingen SDD-rammeverk detektert (`openspec/`, `.specify/` finnes ikke i repo). Hoppes over.

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES — Jest med mocked DB (`tests/admin-deviations.test.js` er kanonisk mønster, 23 tester passing)
- **Automated tests**: TDD (RED → GREEN → REFACTOR)
- **Framework**: Jest
- **Mocks**: `jest.mock('puppeteer')`, mock `loadTenantSettings`, mock `db.getTenantConnection`

### QA Policy
Every task MUST include agent-executed QA scenarios.
- **Frontend/UI**: Playwright skill — naviger til avvik-side, klikk Eksporter, fyll modal, assert blob/download
- **API/Backend**: Bash (curl) mot deployet endepunkt + node REPL for service-unit
- **CLI/CI**: Bash kjører `npm test -- <fil>`, validerer output

Evidence saved to `.omo/evidence/task-{N}-{scenario-slug}.{ext}`.

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start umiddelbart — TDD foundation):
└── Task 1: Skriv test-skall med RED-assertions [quick]

Wave 2 (Etter Wave 1 — services + frontend HTML parallelt):
├── Task 2: Implementer service generateDeviationsCsv() [quick]
├── Task 3: Implementer service generateDeviationsPdf() [unspecified-high]
└── Task 5: Frontend Eksporter-knapp + modal i avvik.html [visual-engineering]

Wave 3 (Etter Wave 2 — route binder services sammen):
└── Task 4: Implementer GET /export route med mutex + 5000 cap [unspecified-high]

Wave 4 (Etter Wave 3 — JS-handler binder modal til endpoint):
└── Task 6: Frontend modal-handler + blob download i avvik.js [quick]

Wave FINAL (etter ALLE tasks):
├── F1: Plan compliance audit (oracle)
├── F2: Code quality review (unspecified-high)
├── F3: Real manual QA + dev deploy verify (unspecified-high + playwright)
└── F4: Scope fidelity check (deep)
→ Present results → Get explicit user okay

Critical Path: 1 → (2 + 3) → 4 → 6 → F1–F4
Parallel Speedup: ~35% vs sekvensielt (Wave 2 har 3 parallelle tasks)
Max Concurrent: 3 (Wave 2)
```

### Dependency Matrix
- **1 (tests-RED)**: blocked by None — blocks 2, 3, 4, 5
- **2 (CSV service)**: blocked by 1 — blocks 4, F1, F2
- **3 (PDF service)**: blocked by 1 — blocks 4, F1, F2
- **4 (route)**: blocked by 1, 2, 3 — blocks 6, F1, F2, F3
- **5 (HTML modal)**: blocked by 1 — blocks 6, F3
- **6 (JS handler)**: blocked by 4, 5 — blocks F3
- **F1–F4**: blocked by ALL of 1–6

### Agent Dispatch Summary
- **Wave 1 (1)**: T1 → `quick`
- **Wave 2 (3)**: T2 → `quick`, T3 → `unspecified-high`, T5 → `visual-engineering`
- **Wave 3 (1)**: T4 → `unspecified-high`
- **Wave 4 (1)**: T6 → `quick`
- **FINAL (4)**: F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high` + `playwright` skill, F4 → `deep`

---

## TODOs

- [ ] 1. Skriv test-skall med RED-assertions (TDD setup)

  **What to do**:
  - Opprett `tests/admin-deviations-export.test.js` etter mønster fra `tests/admin-deviations.test.js`
  - Mock `puppeteer` med `jest.mock('puppeteer', () => ({ launch: jest.fn() }))` + page mock
  - Mock `src/routes/images.js` sin `loadTenantSettings` til å returnere `{ companyInfo: {name: 'TestCorp', ...}, logo: {url: 'https://example.com/logo.png'} }`
  - Mock `db.getTenantConnection` til å returnere fast dataset (3-5 avvik med observasjoner og bilder)
  - Skriv test-skall (alle skal feile inntil tasks 2-4 er implementert) — minimum 10 tester, maks 15:
    1. CSV: returnerer text/csv med BOM (`\uFEFF`) og UTF-8
    2. CSV: header-rad har EKSAKT 13 brief-kolonner i riktig rekkefølge
    3. CSV: escaper internal commas/newlines med double-quote wrap
    4. CSV: escaper internal double-quotes til `""` (RFC 4180)
    5. CSV: null-felter blir tom string (ikke "null")
    6. CSV: `daysOpen` regnes ut fra openedAt og closedAt (eller now)
    7. PDF: returnerer application/pdf med Content-Disposition attachment
    8. PDF: filnavn matcher `avvik-{tenantId}-{YYYY-MM-DD}.pdf`
    9. Route: 400 hvis format=xlsx eller mangler
    10. Route: 422 hvis count > 5000
    11. Route: 429 hvis mutex låst (samtidig request)
    12. Route: scope=filtered respekterer query params (status filter)
    13. Route: scope=all returnerer alle for tenant uavhengig av query
    14. Route: 401 hvis ingen tenantId i session
    15. Negativ: invalid scope=foobar → 400

  **Must NOT do**:
  - INGEN endring i `tests/admin-deviations.test.js` (eksisterende fase 3 tester)
  - INGEN nye npm-pakker
  - INGEN test-helper extraction til ny fil — alt i én test-fil

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Skriving av Jest test-skeleton etter eksisterende mønster, ingen design-arbeid
  - **Skills**: ingen
    - Reason: Eksisterende `tests/admin-deviations.test.js` er all nødvendig dokumentasjon
  - **Skills Evaluated but Omitted**: `playwright` (ikke browser-test her — kun unit/integration)

  **Parallelization**:
  - **Can Run In Parallel**: NO (foundation som blokkerer alle andre tasks)
  - **Parallel Group**: Wave 1
  - **Blocks**: 2, 3, 4
  - **Blocked By**: None — kan starte umiddelbart

  **References**:

  **Pattern References**:
  - `tests/admin-deviations.test.js:1-100` — canonical Jest setup, mocks, supertest pattern
  - `tests/admin-deviations.test.js` describe-blokker — struktur for happy/negative paths
  - `src/routes/admin/deviations.js:1-50` — header/imports som ny test må mocke

  **API/Type References**:
  - Brief CSV-kolonner (canonical, 13 stk): `id, equipmentName, checklistItemLabel, status, severity, openedAt, daysOpen, assignedToName, deadline, observationCount, closedAt, closureMode, closureComment`

  **WHY Each Reference Matters**:
  - `tests/admin-deviations.test.js` viser hvordan `db.getTenantConnection` mockes til å returnere fast resultat-sett — gjenbruk samme mock-stil for konsistens
  - Brief-kolonnene må matche eksakt i header-assert (test 2) for å oppdage feil tidlig

  **Acceptance Criteria**:
  - [ ] Fil `tests/admin-deviations-export.test.js` opprettet
  - [ ] `npm test -- tests/admin-deviations-export.test.js` kjører uten syntax-feil
  - [ ] Alle 10-15 tester FAILER med "module not found" eller "function not implemented" (RED-state)
  - [ ] Ingen import-feil i andre testfiler (`npm test` totaltall = 195+3-failures = 198 fortsatt før implementasjon)

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: RED-state verifikasjon
    Tool: Bash
    Preconditions: Test-fil opprettet, men deviationsExport.js og /export route finnes ikke ennå
    Steps:
      1. Kjør: npm test -- tests/admin-deviations-export.test.js 2>&1 | tee .omo/evidence/task-1-red-state.txt
      2. Verifiser at output inneholder "FAIL tests/admin-deviations-export.test.js"
      3. Verifiser at testantall er mellom 10 og 15 ("Tests: X failed, X total" hvor X=10-15)
    Expected Result: Alle tester feiler med spesifikke errors (module not found / 404 from supertest)
    Failure Indicators: Test-fil kjører ikke (syntax error), antall < 10 eller > 15
    Evidence: .omo/evidence/task-1-red-state.txt

  Scenario: Regresjonstest av eksisterende fase 3
    Tool: Bash
    Preconditions: Ny test-fil eksisterer, men implementerer ikke noe
    Steps:
      1. Kjør: npm test -- tests/admin-deviations.test.js 2>&1 | tee .omo/evidence/task-1-regression.txt
      2. Verifiser at output inneholder "Tests: 23 passed"
    Expected Result: Eksisterende 23 fase 3-tester fortsatt grønne
    Evidence: .omo/evidence/task-1-regression.txt
  ```

  **Commit**: YES (groups with itself only)
  - Message: `test(deviations): add export endpoint test skeleton (RED)`
  - Files: `tests/admin-deviations-export.test.js`
  - Pre-commit: ingen (RED-tester skal feile)

- [ ] 2. Implementer `generateDeviationsCsv()` service

  **What to do**:
  - Opprett `src/services/deviationsExport.js`
  - Export `generateDeviationsCsv(deviations, tenantSettings)` som ren funksjon
  - Generer header-rad med EKSAKT 13 brief-kolonner i riktig rekkefølge
  - For hver avvik: ekstraher feltverdier, beregn `daysOpen = Math.floor((closedAt ? closedAt - openedAt : Date.now() - openedAt) / 86400000)`
  - Escape per RFC 4180: hvis verdi inneholder `,`, `\n`, `\r` eller `"` → wrap i `"..."` og dobbel internal quotes til `""`
  - Null/undefined → tom string `""` (IKKE "null")
  - Datofelter: `YYYY-MM-DD` (ISO uten klokkeslett)
  - Returner string med `\uFEFF` (BOM) prefix + `\r\n`-separerte linjer
  - Kjør de 6 CSV-relaterte testene (1-6) til alle er GREEN

  **Must NOT do**:
  - INGEN bruk av ekstern CSV-bibliotek (skriv funksjonen for hånd, ~30 linjer)
  - INGEN Excel-spesifikk formatering utover BOM
  - INGEN imageCount-kolonne (kun de 13 brief-kolonnene)
  - INGEN endring i andre filer enn `src/services/deviationsExport.js`

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Ren funksjon, ingen IO, tydelig spec, ~50 linjer kode
  - **Skills**: ingen
    - Reason: Standard string-manipulasjon

  **Parallelization**:
  - **Can Run In Parallel**: YES — kan kjøres parallelt med Task 3 og Task 5
  - **Parallel Group**: Wave 2 (med Task 3, Task 5)
  - **Blocks**: 4, F1, F2
  - **Blocked By**: 1 (trenger test-skall for å verifisere GREEN)

  **References**:

  **Pattern References**:
  - `src/services/unifiedPdfGenerator.js:fetchAsBuffer` (linje 351-362) — referanse for ren stateless funksjon-stil

  **External References**:
  - RFC 4180 quote-escaping: https://datatracker.ietf.org/doc/html/rfc4180#section-2

  **WHY Each Reference Matters**:
  - RFC 4180 er kanonisk CSV-spec — Excel og LibreOffice følger den. Egen escape-logikk uten lib er trivielt med riktig spec.

  **Acceptance Criteria**:

  **TDD GREEN-state**:
  - [ ] CSV-testene (test 1-6 fra task 1) alle PASS
  - [ ] `npm test -- tests/admin-deviations-export.test.js -t csv` → alle CSV-tester PASS
  - [ ] Andre tester (PDF, route) fortsatt FAIL (forventet, ikke implementert ennå)
  - [ ] Eksisterende `npm test` totaltall (fase 1/2/3): uendret

  **QA Scenarios**:

  ```
  Scenario: CSV-formatering med edge cases
    Tool: Bash (node REPL)
    Preconditions: src/services/deviationsExport.js implementert med generateDeviationsCsv
    Steps:
      1. Kjør: node -e "const {generateDeviationsCsv} = require('./src/services/deviationsExport'); const csv = generateDeviationsCsv([{id:'a',equipmentName:'Pumpe \"A\", main',checklistItemLabel:'Test\nmulti',status:'open',severity:'critical',openedAt:new Date('2026-05-01'),daysOpen:28,assignedToName:'Ola',deadline:null,observationCount:3,closedAt:null,closureMode:null,closureComment:''}], {}); console.log(JSON.stringify(csv));" > .omo/evidence/task-2-csv-edge.txt
      2. Verifiser at output starter med `\uFEFF`
      3. Verifiser at "Pumpe ""A"", main" er korrekt escapet (dobbel quotes + wrap)
      4. Verifiser at "Test\nmulti" er wrapped i quotes
      5. Verifiser at null-felter er tomme strings (ikke "null")
    Expected Result: CSV-output følger RFC 4180 for alle edge cases
    Evidence: .omo/evidence/task-2-csv-edge.txt

  Scenario: Norsk encoding (å/ø/æ)
    Tool: Bash (node REPL)
    Preconditions: Service implementert
    Steps:
      1. Kjør node-test med data { equipmentName: 'Båt på øy' }, skriv resultatet til en fil med fs.writeFileSync(path, csv, 'utf8')
      2. Les filen tilbake og verifiser at å/ø/æ ikke er korrumpert
    Expected Result: Norsk tekst overlever UTF-8 round-trip
    Evidence: .omo/evidence/task-2-csv-norsk.txt
  ```

  **Commit**: YES (groups med Task 3 hvis begge ferdige samtidig, ellers solo)
  - Message: `feat(deviations): add generateDeviationsCsv service`
  - Files: `src/services/deviationsExport.js`
  - Pre-commit: `npm test -- tests/admin-deviations-export.test.js -t csv`

- [ ] 3. Implementer `generateDeviationsPdf()` service med Puppeteer

  **What to do**:
  - I `src/services/deviationsExport.js`: legg til `async generateDeviationsPdf(deviations, tenantSettings)`
  - Browser-lifecycle: bruk `safePuppeteer` (`src/utils/safePuppeteer.js`) for trygg launch med fallback
  - `try { ... } finally { await browser.close(); }` — leak-beskyttelse
  - Hjelper `inlineImagesForPdf(images)`:
    - Kopier `fetchAsBuffer(url)` mønster fra `unifiedPdfGenerator.js:351-362` (fetch, til Buffer, til `data:image/...;base64,...`)
    - Bruk `Promise.allSettled` med per-image 5s timeout (Promise.race med setTimeout)
    - Filtrer fra URLs som starter med `data:` (allerede inline)
    - Ved feil: behold placeholder `<div class="img-fallback">(bilde finnes)</div>` (per brief)
  - Inline logo via samme `fetchAsBuffer` for `tenantSettings.logo?.url`
  - Bygg HTML inline (ingen template-filer):
    - `<html lang="no"><head><meta charset="utf-8"><style>...</style></head>`
    - Header: logo (max-height: 60px) + firmanavn + genereringsdato (norsk DD.MM.YYYY) + filter-beskrivelse
    - Sammendrag-block: totalt antall, oppdelt på status og severity
    - Per-avvik kort: id, utstyr, status, severity, åpnet, deadline, tildelt, observasjoner (max 20, "+ X observasjoner ikke vist" hvis flere), bilder (max 6, `max-width: 120px; max-height: 120px`, "+ X bilder ikke vist")
    - Ingen eksterne URL-referanser (ingen CDN fonts, ingen eksterne ikoner)
  - PDF-options: `format: 'A4'`, `landscape: false`, `printBackground: true`
  - Header/footer template: footer med "Side <span class="pageNumber"></span> av <span class="totalPages"></span>"
  - Returner Buffer (PDF binary)
  - Kjør PDF-tester (7, 8) til GREEN

  **Must NOT do**:
  - INGEN endring i `src/services/unifiedPdfGenerator.js` (kopier mønsteret, ikke importer)
  - INGEN ny npm-pakke
  - INGEN eksterne URL-er i HTML
  - INGEN charts, grafer, fargede statusbadges utover det brief spesifiserer
  - INGEN browser-instans som lever utover én request (per-request lifecycle)
  - INGEN bruk av singleton PDF generator class

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Puppeteer + HTML-generering + asynkron image-inlining er ikke triviell, men ikke arkitekturarbeid
  - **Skills**: ingen
    - Reason: Eksisterende `unifiedPdfGenerator.js` viser hele mønsteret

  **Parallelization**:
  - **Can Run In Parallel**: YES (kan utvikles parallelt med Task 2 og Task 5)
  - **Parallel Group**: Wave 2 (med Task 2, Task 5)
  - **Blocks**: 4, F1, F2
  - **Blocked By**: 1

  **References**:

  **Pattern References**:
  - `src/services/unifiedPdfGenerator.js:fetchAsBuffer` (linje 351-362) — fetch + Buffer + base64 inline
  - `src/services/unifiedPdfGenerator.js:inlineAllImages` (linje 364-392) — itereringsmønster med fallback
  - `src/services/unifiedPdfGenerator.js:generatePDF` (linje 1324-1375) — A4 + header/footer template
  - `src/services/sjaPdfGenerator.js` (hele filen) — per-request browser lifecycle med try/finally

  **API/Type References**:
  - `src/utils/safePuppeteer.js` — `safeLaunch()` returnerer Browser eller throw

  **External References**:
  - Puppeteer page.pdf options: https://pptr.dev/api/puppeteer.pdfoptions
  - data: URL spec for base64-bilder

  **WHY Each Reference Matters**:
  - `unifiedPdfGenerator.fetchAsBuffer` har allerede error-handling for ikke-eksisterende GCS-objekter — copy exact
  - `sjaPdfGenerator` er per-request mønsteret vi vil ha (ikke singleton fra unified)

  **Acceptance Criteria**:

  **TDD GREEN-state**:
  - [ ] PDF-tester (7, 8) PASS
  - [ ] `npm test -- tests/admin-deviations-export.test.js -t pdf` → alle PDF-tester PASS
  - [ ] Mock av puppeteer brukes (ingen ekte browser i tester)

  **QA Scenarios**:

  ```
  Scenario: Faktisk PDF-generering med mock-data
    Tool: Bash (node REPL — krever ekte puppeteer her, ikke jest mock)
    Preconditions: Service implementert, puppeteer installert (allerede true)
    Steps:
      1. Skriv et lite script `.omo/evidence/task-3-pdf-gen.js` som kaller generateDeviationsPdf med 3 mock-avvik (ett med 25 observasjoner for å teste overflow-cap, ett med 8 bilder for å teste image-cap, ett uten bilder)
      2. Skriv resultatet til `.omo/evidence/task-3-output.pdf`
      3. Kjør: node .omo/evidence/task-3-pdf-gen.js
      4. Verifiser: filen eksisterer og er > 5 KB
      5. Åpne PDF i pdftotext: `pdftotext .omo/evidence/task-3-output.pdf - | head -50` (eller manuell visuell sjekk hvis pdftotext mangler)
      6. Verifiser at "+ 5 observasjoner ikke vist" finnes for avvik med 25 obs
      7. Verifiser at "+ 2 bilder ikke vist" finnes for avvik med 8 bilder
    Expected Result: Generert PDF med riktige caps og overflow-tekster
    Evidence: .omo/evidence/task-3-output.pdf, .omo/evidence/task-3-pdftotext.txt

  Scenario: Browser lukkes ved exception
    Tool: Bash (node REPL)
    Preconditions: Service implementert
    Steps:
      1. Skriv test-script som thrower fra page.pdf() (mock puppeteer page.pdf til å throwe)
      2. Verifiser at browser.close() ble kalt (sjekk via spy)
    Expected Result: try/finally garantererer browser-cleanup
    Evidence: .omo/evidence/task-3-finally-block.txt
  ```

  **Commit**: YES
  - Message: `feat(deviations): add generateDeviationsPdf with Puppeteer`
  - Files: `src/services/deviationsExport.js`
  - Pre-commit: `npm test -- tests/admin-deviations-export.test.js -t pdf`

- [ ] 4. Implementer `GET /export` route med mutex + 5000 cap

  **What to do**:
  - I `src/routes/admin/deviations.js`: legg til NY `router.get('/export', async (req, res) => {...})` ETTER eksisterende endepunkter — IKKE rør eksisterende handlers
  - Modul-toppnivå: `let exportInProgress = false;` (in-process mutex)
  - Handler-flyt:
    1. Sjekk `req.adminTenantId || req.session?.tenantId` — 401 hvis mangler
    2. Valider `req.query.format` ∈ {'csv', 'pdf'} — 400 hvis ikke
    3. Valider `req.query.scope` ∈ {'filtered', 'all'} (default 'filtered') — 400 hvis ikke
    4. Hvis `exportInProgress` → returner 429 `{ error: "Eksport pågår. Vent litt og prøv igjen." }`
    5. Sett `exportInProgress = true`, wrap resten i `try/finally` med `exportInProgress = false`
    6. Bygg WHERE-clause — DUPLISER ~30 linjer SQL-bygging fra eksisterende GET `/` handler (status filter, severity, search, date range). KOMMENTAR i koden: `// DUPLIKERT fra GET / handler — fase 3.5 brief krever ingen refactor av eksisterende kode`
    7. Hvis `scope=all`: ignorer query-filters, kun WHERE tenant_id
    8. COUNT query først → hvis > 5000 returner 422 `{ error: "For mange avvik (${count}). Bruk filtre for å innskrenke utvalget." }`
    9. SELECT med joins (utstyr, checklist_item, assigned_to user, observations, images)
    10. Hent `tenantSettings` via `loadTenantSettings(tenantId)` (cached)
    11. Hvis format='csv': kall `generateDeviationsCsv(rows, tenantSettings)` → set headers (`Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="avvik-${tenantId}-${YYYY-MM-DD}.csv"`) → res.send(csv)
    12. Hvis format='pdf': kall `await generateDeviationsPdf(rows, tenantSettings)` → set headers (`application/pdf`, `Content-Disposition: attachment; filename="..."`)→ res.send(buffer)
  - Importer på toppen: `const { generateDeviationsCsv, generateDeviationsPdf } = require('../../services/deviationsExport'); const { loadTenantSettings } = require('../images');`
  - Kjør alle test-suite (1-15) til alle GREEN

  **Must NOT do**:
  - INGEN endring i eksisterende GET `/`, PATCH `/:id/status`, POST `/:id/observations`, eller andre eksisterende handlers (kun NY route lagt til)
  - INGEN ekstrahering av `buildDeviationFilters` helper — dupliser SQL
  - INGEN endring i `src/app.js` eller `server.js` (eksisterende `app.use('/api/admin/deviations', ...)` dekker ny sub-route)
  - INGEN endring i `src/routes/images.js` (kun require)
  - INGEN endring i `src/services/deviationsService.js` eller `reports.js`
  - INGEN fjerning av `try/finally` rundt mutex — selv ved throw må flagget resettes

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Multi-step route med flere valideringer + mutex + duplisert SQL — krever nøye refleksjon, men ikke arkitekturarbeid

  **Parallelization**:
  - **Can Run In Parallel**: NO (avhenger av services fra task 2 og 3)
  - **Parallel Group**: Wave 3 (solo)
  - **Blocks**: 6, F1, F2, F3
  - **Blocked By**: 1, 2, 3

  **References**:

  **Pattern References**:
  - `src/routes/admin/deviations.js:GET /` handler — WHERE-clause SQL pattern, parameteriserte queries, joins
  - `src/routes/admin/deviations.js:24` — `adminTenant` middleware mount (arves av ny route)
  - `tests/admin-deviations.test.js` — supertest-mønster for hvordan handler-typer testes

  **API/Type References**:
  - `src/services/deviationsExport.js` — `generateDeviationsCsv`, `generateDeviationsPdf` (fra task 2, 3)
  - `src/routes/images.js:1313` — `module.exports.loadTenantSettings` (verifisert safe å requirere)

  **WHY Each Reference Matters**:
  - Eksisterende GET `/` har allerede den eksakte WHERE-bygging-logikken vi trenger — dupliseres med kommentar som forklarer hvorfor (constraint, ikke laziness)

  **Acceptance Criteria**:

  **TDD GREEN-state**:
  - [ ] ALLE 10-15 tester PASS: `npm test -- tests/admin-deviations-export.test.js`
  - [ ] `npm test -- tests/admin-deviations.test.js` — 23 eksisterende fase 3-tester FORTSATT GREEN (regresjon)
  - [ ] `npm test` totalt: 195+ pass (kun 3 pre-existing fails)
  - [ ] `git diff src/routes/admin/deviations.js` viser KUN nye linjer (ingen endringer i eksisterende handlers)

  **QA Scenarios**:

  ```
  Scenario: Mutex blokkerer samtidig eksport
    Tool: Bash (curl med samtidig requests)
    Preconditions: Lokal server kjører (npm run dev), gyldig session-cookie
    Steps:
      1. Start to curl-requests samtidig:
         curl -b cookie.txt "http://localhost:8080/api/admin/deviations/export?format=pdf" -o pdf1.pdf &
         curl -b cookie.txt "http://localhost:8080/api/admin/deviations/export?format=pdf" -o pdf2.pdf &
         wait
      2. Sjekk: en av request-ene fikk 429
    Expected Result: Den andre request returnerer 429 med norsk error-melding
    Evidence: .omo/evidence/task-4-mutex.txt

  Scenario: 5000-row cap
    Tool: Bash (node REPL)
    Preconditions: Mock DB med 5001 rader
    Steps:
      1. Kjør test via jest med mocked count=5001
      2. Verifiser HTTP 422 og error-melding inneholder "5001"
    Expected Result: 422 med korrekt count i melding
    Evidence: .omo/evidence/task-4-cap.txt

  Scenario: Format validation
    Tool: Bash (curl)
    Preconditions: Server kjører
    Steps:
      1. curl -i "http://localhost:8080/api/admin/deviations/export?format=xlsx"
      2. Verifiser HTTP 400 (etter auth) eller 401
    Expected Result: 400 hvis autentisert med invalid format
    Evidence: .omo/evidence/task-4-format-validation.txt

  Scenario: Diff-verifisering — ingen eksisterende kode rørt
    Tool: Bash (git)
    Preconditions: Task 4 ferdig committet
    Steps:
      1. git log --oneline -1 -- src/routes/admin/deviations.js (siste commit på fila)
      2. git show HEAD:src/routes/admin/deviations.js > /tmp/new.js
      3. git show HEAD~1:src/routes/admin/deviations.js > /tmp/old.js
      4. diff /tmp/old.js /tmp/new.js > .omo/evidence/task-4-diff.txt
      5. Verifiser at diff KUN viser additions, ingen deletions/modifications i eksisterende handlers
    Expected Result: Diff er rent additive
    Evidence: .omo/evidence/task-4-diff.txt
  ```

  **Commit**: YES
  - Message: `feat(deviations): add GET /export route with mutex and row cap`
  - Files: `src/routes/admin/deviations.js`
  - Pre-commit: `npm test -- tests/admin-deviations-export.test.js` (alle 10-15 PASS)

- [ ] 5. Frontend — Eksporter-knapp + modal i avvik.html

  **What to do**:
  - I `public/admin/avvik.html`: legg til `<button id="avvikExportBtn" class="btn btn-secondary">Eksporter</button>` i toolbar (samme stil som eksisterende knapper)
  - Legg til skjult modal `<div id="avvikExportModal" class="modal hidden">...</div>` med:
    - Tittel: "Eksporter avvik"
    - Radio: Format (CSV / PDF), default CSV
    - Radio: Omfang (Filtrert / Alle), default Filtrert
    - Info-tekst: "Filtrert bruker aktive filtre i listevisningen. Alle inkluderer hele tenant."
    - Error-region: `<div class="avvik-error hidden" id="avvikExportError"></div>` (matcher eksisterende error-mønster)
    - Knapper: "Avbryt" (lukk modal) + "Last ned" (trigger fetch)
  - CSS: bruk eksisterende `.modal` / `.modal-backdrop` / `.hidden` klasser (ingen nye stylesheets)
  - INGEN nye spinners eller progress bars utover eksisterende loading-mønster

  **Must NOT do**:
  - INGEN nye CSS-filer
  - INGEN endring i andre HTML-filer
  - INGEN ny eksterne dependencies (jQuery, Bootstrap modal etc — bruk eksisterende vanilla pattern)
  - INGEN endring i eksisterende toolbar-knapper

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: HTML + UX-konsistens med eksisterende admin-design
  - **Skills**: ingen
    - Reason: Eksisterende HTML er all nødvendig referanse

  **Parallelization**:
  - **Can Run In Parallel**: YES (kan startes parallelt med Task 2 og Task 3 — trenger kun endpoint-kontrakt fra tester)
  - **Parallel Group**: Wave 2 (med Task 2, Task 3)
  - **Blocks**: 6, F3
  - **Blocked By**: 1 (kjenne kontrakt fra tester)

  **References**:

  **Pattern References**:
  - `public/admin/avvik.html` — eksisterende toolbar struktur, modal-mønster hvis finnes
  - Andre admin-sider med modaler — søk etter `class="modal"` i `public/admin/`
  - Eksisterende `<button class="btn btn-secondary">` for stil-konsistens

  **WHY Each Reference Matters**:
  - Visuell konsistens er kritisk for admin-UX; ingen nye paradigmer

  **Acceptance Criteria**:
  - [ ] `public/admin/avvik.html` har `#avvikExportBtn` synlig i toolbar
  - [ ] `#avvikExportModal` finnes i DOM, men `class="modal hidden"` (skjult ved page load)
  - [ ] Modal har radio-knapper for format og omfang
  - [ ] HTML validerer (ingen unclosed tags) — sjekkes via simpel browser-load

  **QA Scenarios**:

  ```
  Scenario: Knappen vises i toolbar
    Tool: Playwright skill
    Preconditions: Dev-server kjører, logget inn som admin
    Steps:
      1. await page.goto('http://localhost:8080/admin/avvik')
      2. const btn = await page.locator('#avvikExportBtn')
      3. await expect(btn).toBeVisible()
      4. await expect(btn).toHaveText('Eksporter')
      5. await page.screenshot({ path: '.omo/evidence/task-5-button.png' })
    Expected Result: Eksporter-knapp synlig
    Evidence: .omo/evidence/task-5-button.png

  Scenario: Modal er skjult ved page load
    Tool: Playwright skill
    Preconditions: Page lastet
    Steps:
      1. const modal = page.locator('#avvikExportModal')
      2. await expect(modal).toHaveClass(/hidden/)
    Expected Result: Modal har `hidden` class, ikke synlig
    Evidence: .omo/evidence/task-5-modal-hidden.txt
  ```

  **Commit**: YES
  - Message: `feat(avvik-ui): add Eksporter button and export modal`
  - Files: `public/admin/avvik.html`
  - Pre-commit: ingen (HTML-endringer verifiseres via Playwright i F3)

- [ ] 6. Frontend — modal-handler + blob download i avvik.js

  **What to do**:
  - I `public/admin/assets/js/avvik.js`: legg til:
    - `document.getElementById('avvikExportBtn').addEventListener('click', openExportModal)`
    - `openExportModal()`: fjerner `.hidden` fra modalen
    - `closeExportModal()`: legger til `.hidden`, resetter error-state
    - Avbryt-knapp → `closeExportModal()`
    - Last ned-knapp → `triggerExport()`
  - `triggerExport()`:
    - Les radio-values: format ('csv'|'pdf'), scope ('filtered'|'all')
    - Bygg URL: `/api/admin/deviations/export?format=${format}&scope=${scope}`
    - Hvis `scope=filtered`: legg på aktive query-params fra eksisterende filter-state (status, severity, search, dato)
    - `fetch(url, { credentials: 'include' })` — IKKE `'same-origin'` (matcher eksisterende avvik.js convention)
    - Hvis `!res.ok`:
      - 422 → vis error "For mange avvik..." (les body.error)
      - 429 → vis error "Eksport pågår..."
      - 400 → vis error "Ugyldig format"
      - 401 → redirect til login
      - Annet → generisk error
    - Hvis ok:
      - `const blob = await res.blob()`
      - `const url = URL.createObjectURL(blob)`
      - Hent filnavn fra Content-Disposition header (parse `filename="..."`); fallback til `avvik-export.${format}`
      - Lag `<a download="${filename}" href="${url}">` skjult, `.click()`, fjern
      - `setTimeout(() => URL.revokeObjectURL(url), 10000)` — leak-cleanup
      - `closeExportModal()`
  - Error-display: bruk `#avvikExportError` element, fjern `.hidden`, sett `.textContent`

  **Must NOT do**:
  - INGEN endring i eksisterende avvik.js-funksjoner (kun nye funksjoner lagt til)
  - INGEN `credentials: 'same-origin'` (brief tar feil; bruk `'include'` som matcher resten av avvik.js)
  - INGEN window.location-redirect for nedlasting (bruk blob + anchor click; Content-Disposition behaviour varierer)
  - INGEN progress bar eller spinner utover eksisterende mønster
  - INGEN nye npm-pakker eller CDN-scripts

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Vanilla JS event handlers + fetch, standardmønster
  - **Skills**: ingen

  **Parallelization**:
  - **Can Run In Parallel**: NO (avhenger av Task 4 endpoint og Task 5 HTML-elementer)
  - **Parallel Group**: Wave 4 (solo)
  - **Blocks**: F3
  - **Blocked By**: 4, 5

  **References**:

  **Pattern References**:
  - `public/admin/assets/js/avvik.js` — eksisterende fetch-kall med `credentials: 'include'`
  - `public/admin/assets/js/avvik.js` — eksisterende filter-state lesing (status, severity, search, datoer)

  **API/Type References**:
  - `/api/admin/deviations/export?format=...&scope=...&<filter_params>` — fra task 4
  - Content-Disposition header parsing: `filename="avvik-<tenant>-<dato>.csv"`

  **WHY Each Reference Matters**:
  - Eksisterende `credentials: 'include'` er den faktiske konvensjonen i fila; brief sa `'same-origin'` men det vil bryte session-cookie-flyt

  **Acceptance Criteria**:
  - [ ] Klikk på Eksporter-knapp åpner modalen (`.hidden` class fjernes)
  - [ ] Avbryt-knapp lukker modalen
  - [ ] Last ned-knapp trigger fetch med riktige query-params
  - [ ] Blob konverteres til download via anchor click
  - [ ] URL.revokeObjectURL kalles etter 10s

  **QA Scenarios**:

  ```
  Scenario: End-to-end CSV-download (lokalt)
    Tool: Playwright skill
    Preconditions: Dev-server kjører, logget inn, finnes avvik for tenant
    Steps:
      1. await page.goto('http://localhost:8080/admin/avvik')
      2. await page.click('#avvikExportBtn')
      3. await expect(page.locator('#avvikExportModal')).not.toHaveClass(/hidden/)
      4. await page.click('input[name="exportFormat"][value="csv"]')
      5. const [download] = await Promise.all([page.waitForEvent('download'), page.click('#avvikExportSubmit')])
      6. await download.saveAs('.omo/evidence/task-6-download.csv')
      7. const content = await fs.readFile('.omo/evidence/task-6-download.csv', 'utf8')
      8. expect(content.charCodeAt(0)).toBe(0xFEFF)  // BOM
      9. expect(content.includes('id,equipmentName,checklistItemLabel')).toBe(true)
    Expected Result: CSV lastes ned med BOM og brief-kolonner
    Evidence: .omo/evidence/task-6-download.csv

  Scenario: Error-håndtering for 429 (mock)
    Tool: Playwright skill
    Preconditions: Mock /api/admin/deviations/export til å returnere 429
    Steps:
      1. await page.route('**/api/admin/deviations/export*', route => route.fulfill({ status: 429, body: '{"error":"Eksport pågår."}' }))
      2. Klikk Eksporter → Last ned
      3. await expect(page.locator('#avvikExportError')).toBeVisible()
      4. await expect(page.locator('#avvikExportError')).toContainText('Eksport pågår')
    Expected Result: Error vises i modal, modal forblir åpen
    Evidence: .omo/evidence/task-6-429-error.png
  ```

  **Commit**: YES
  - Message: `feat(avvik-ui): wire export modal to /export endpoint with blob download`
  - Files: `public/admin/assets/js/avvik.js`
  - Pre-commit: `npm test` (kjør hele suite — INGEN regresjon)

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review-agenter kjører i PARALLEL. ALL must APPROVE. Presenter konsolidert resultat til bruker og hent eksplisitt "okay" før arbeidet markeres ferdig.
>
> **Aldri marker F1–F4 som sjekket før bruker har sagt okay.**

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Les planen end-to-end. For hver "Must Have": verifiser implementasjonen finnes (les fil, curl endepunkt, kjør kommando). For hver "Must NOT Have": søk codebase for forbudte mønstre — avvis med file:line hvis funnet. Spesielt: bekreft at `deviationsService.js`, `reports.js`, eksisterende handlers i `deviations.js`, `images.js`, `app.js`, `server.js` har 0 endringer (`git diff --stat`). Sjekk evidence-filer i `.omo/evidence/`.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [6/6] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Kjør `npm test` (forventer 195+ pass, 3 pre-existing failures i admin-planner-clusters), kjør eslint hvis konfigurert. Gjennomgå endrede filer for: `as any`/`@ts-ignore`, tomme catches, `console.log` i prod-kode, kommentert-ut kode, ubrukte imports. Sjekk AI-slop: overdrevne kommentarer, over-abstraksjon, generiske navn (data/result/item/temp). Verifiser Puppeteer browser.close() i finally-block.
  Output: `Build [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA + Dev Deploy Verify** — `unspecified-high` (+ `playwright` skill)
  Først: bekreft dev-deploy til `servfix-app` i `europe-north1` (sjekk Cloud Run revisjon-nummer økt). curl `https://airtechdev.servfix.no/api/admin/deviations/export?format=csv` → 401. Deretter med Playwright: logg inn som admin, naviger til /admin/avvik, klikk Eksporter, velg CSV → verifiser nedlasting + UTF-8 + BOM + korrekt header-rad. Repeat for PDF → verifiser logo, firmanavn, dato, per-avvik kort. Test edge cases: scope=all med 0 avvik, scope=filtered med aktive filter, overflow (mock >5000 → 422).
  Output: `Deploy [OK/FAIL] | CSV scenarios [N/N] | PDF scenarios [N/N] | Edge cases [N/N] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For hver task: les "What to do", les faktisk diff (`git log --stat`, `git diff main..HEAD`). Verifiser 1:1 — alt i spec er bygget (ingen mangler), ingenting utover spec er bygget (ingen creep). Sjekk "Must NOT do"-compliance. Spesielt: ingen `buildDeviationFilters` helper, ingen endringer i `deviationsService.js`/`reports.js`/eksisterende handlers, ingen nye npm-pakker (verifiser `package.json` diff).
  Output: `Tasks [6/6 compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **Task 1**: `test(deviations): add export endpoint test skeleton (RED)` — `tests/admin-deviations-export.test.js`, pre-commit: `npm test -- tests/admin-deviations-export.test.js` (skal feile RED-tester)
- **Task 2**: `feat(deviations): add generateDeviationsCsv service` — `src/services/deviationsExport.js`, pre-commit: `npm test -- tests/admin-deviations-export.test.js -t csv`
- **Task 3**: `feat(deviations): add generateDeviationsPdf with Puppeteer` — `src/services/deviationsExport.js`, pre-commit: `npm test -- tests/admin-deviations-export.test.js -t pdf`
- **Task 4**: `feat(deviations): add GET /export route with mutex and row cap` — `src/routes/admin/deviations.js`, pre-commit: `npm test -- tests/admin-deviations-export.test.js`
- **Task 5**: `feat(avvik-ui): add Eksporter button and export modal` — `public/admin/avvik.html`, pre-commit: HTML-validering via Playwright
- **Task 6**: `feat(avvik-ui): wire export modal to /export endpoint with blob download` — `public/admin/assets/js/avvik.js`, pre-commit: `npm test`
- **Final commit (etter F1–F4 + user okay)**: `chore(release): fase 3.5 avvik eksport (CSV+PDF)` — tom-commit eller deploy-tag

---

## Success Criteria

### Verification Commands
```bash
# Tester
npm test -- tests/admin-deviations-export.test.js  # forventet: 10-15 PASS

# Regresjon
npm test  # forventet: 195+ PASS (3 pre-existing fails i admin-planner-clusters)

# Dev-deploy verifikasjon
gcloud run services describe servfix-app --project servfix-dev --region europe-north1 --format="value(status.latestReadyRevisionName)"
# forventet: ny revisjon-tag (>00263)

# Endpoint live
curl -i https://airtechdev.servfix.no/api/admin/deviations/export?format=csv
# forventet: HTTP/2 401 (auth required, korrekt)

# Format validation
curl -i "https://airtechdev.servfix.no/api/admin/deviations/export?format=xlsx"
# forventet: HTTP/2 400 (etter auth) eller 401 før auth
```

### Final Checklist
- [ ] Alle "Must Have" til stede (verifisert av F1)
- [ ] Alle "Must NOT Have" fraværende (verifisert av F1 + F4)
- [ ] Alle tester PASS (verifisert av F2)
- [ ] Dev-deploy ny revisjon synlig (verifisert av F3)
- [ ] CSV + PDF manuelt verifisert via Playwright (F3)
- [ ] Status-rapport `.omo/reports/fase3.5-avvik-eksport-status.md` skrevet
- [ ] Bruker har sagt eksplisitt "okay" til F1–F4-resultater
