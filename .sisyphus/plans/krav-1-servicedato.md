# Krav #1 – Servicedato

## TL;DR

> **Quick Summary**: Fiks servicedato i hele rapportflyten – PDF skal vise `scheduled_date` istedenfor `completed_at`, datoen skal være redigerbar i rapport-editoren, og rapport-køen skal sortere/vise planlagt dato.
>
> **Deliverables**:
> - PDF-rapporten viser korrekt servicedato (`scheduled_date`)
> - "Servicedato"-felt i "Rediger PDF rapport"-modalen i rapporter.html
> - "Service"-kolonnen i rapport-køen viser `scheduled_date`
>
> **Estimated Effort**: Short
> **Parallel Execution**: YES – 2 waves
> **Critical Path**: Task 1 (PDF-generator) → Task 4 (PDF-mal) → Task 6 (QA)

---

## Context

### Original Request
Servicedato er i dag dato PDF genereres, men den bør være den datoen som planleggeren er satt til og bør kunne redigeres i rapporter.html under rediger PDF rapport.

### Interview Summary
- **Scope**: Alle tre deler – PDF-dato, redigerbart felt i rediger-modal, Service-kolonne i kø
- **Kilde**: `orders.scheduled_date` er fasit; hentes allerede i `fetchReportData()` som `service_date` men rendres ikke

### Research Findings
- `unifiedPdfGenerator.js` linje ~1158 og ~1182: bruker `completed_at || created_at` som dato i PDF-header og metadata-tabell
- `service_date = scheduled_date` hentes allerede i SQL-spørringen i `fetchReportData()` – bare ikke brukt i HTML-malen
- Rapport-kø-spørring bruker `MAX(sr.created_at)` som `last_service_date` – bør bruke `o.scheduled_date`
- Rediger-modal i `rapporter.js`: felter som `agreement_number`, `visit_number`, `contact_person` finnes – servicedato mangler
- `PUT /api/admin/reports/:reportId/update-content` lagrer metadata i `orders.customer_data` og regenererer PDF
- `orders.customer_data` er JSONB – servicedato kan lagres som `service_date` der (ingen ny DB-kolonne nødvendig)

---

## Work Objectives

### Core Objective
Sørge for at servicedato konsekvent reflekterer `orders.scheduled_date` gjennom hele rapportflyten: PDF-visning, rediger-modal og rapport-kø.

### Concrete Deliverables
- `src/services/unifiedPdfGenerator.js`: bruker `service_date` (= `scheduled_date`) i PDF HTML
- `src/routes/admin/reports.js`: `edit-data`-endepunkt eksponerer `serviceDate`, `update-content` lagrer overstyrt dato
- `public/admin/assets/js/rapporter.js`: redigerbart servicedato-felt i edit-modal
- `src/routes/admin/reports.js`: rapport-kø-spørring bruker `o.scheduled_date` istedenfor `MAX(sr.created_at)`

### Definition of Done
- [ ] PDF viser "Servicedato: DD.MM.YYYY" basert på `scheduled_date`
- [ ] Rediger-modal har et datovelger-felt for servicedato som er forhåndsutfylt
- [ ] Lagring via "Rediger PDF rapport" regenererer PDF med oppdatert dato
- [ ] "Service"-kolonnen i rapport-køen viser `scheduled_date` formatert
- [ ] Eksisterende PDF-generering for nye rapporter er ikke brutt

### Must Have
- Bakoverkompatibilitet: eksisterende PDF-er som mangler `service_date` i `customer_data` faller tilbake til `scheduled_date` fra ordre
- Datoformat konsistent: `DD.MM.YYYY` i PDF og UI

### Must NOT Have (Guardrails)
- Ikke endre `completed_at`-feltet eller semantikken rundt det
- Ikke innføre ny DB-kolonne for servicedato – bruk `customer_data.service_date` for overstyring
- Ikke endre PDF-layout utover å legge til/korrigere servicedato-feltet
- Ikke røre checklist-data, avvik-bilder eller andre deler av PDF-generatoren

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: YES (se package.json / eksisterende testfiler)
- **Automated tests**: Tests-after
- **Framework**: Eksisterende testoppsett

### QA Policy
Alle oppgaver har agent-kjørte QA-scenarioer. Bevis lagres i `.sisyphus/evidence/`.

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start umiddelbart – uavhengige endringer):
├── Task 1: PDF-generator – bruk service_date i HTML-mal        [quick]
├── Task 2: Rapport-kø-spørring – bruk scheduled_date           [quick]
└── Task 3: edit-data endepunkt – eksponer serviceDate          [quick]

Wave 2 (Etter Wave 1 – frontend + lagring):
├── Task 4: rapporter.js – servicedato-felt i rediger-modal     [quick]
└── Task 5: update-content – lagre og bruk overstyrt dato       [quick]

Wave FINAL:
└── Task F1: QA – verifiser alle tre delene end-to-end          [unspecified-high]
```

**Critical Path**: Task 1 → Task 4 → Task 5 → F1
**Parallel Speedup**: ~50% raskere enn sekvensielt

---

## TODOs

- [ ] 1. PDF-generator: bruk `service_date` som servicedato i HTML-malen

  **What to do**:
  - Finn de to stedene i `src/services/unifiedPdfGenerator.js` (~linje 1158 og ~1182) der `completed_at || created_at` brukes som dato i PDF-headeren og metadata-tabellen
  - Bytt ut med `report.service_date || report.scheduled_date` (service_date hentes allerede i fetchReportData() som `o.scheduled_date AS service_date`)
  - Legg til et nytt synlig felt "Servicedato" i PDF-metadata-tabellen med DD.MM.YYYY-formatering
  - Sørg for at fallback-logikken er: `customer_data.service_date` (overstyrt) → `service_date` fra DB (= scheduled_date) → tom streng
  - Formater dato konsistent: `new Date(dateStr).toLocaleDateString('nb-NO')` eller eksisterende formateringsfunksjon i filen

  **Must NOT do**:
  - Ikke endre `completed_at`-feltet eller fjerne det fra andre steder
  - Ikke endre PDF-layout, fonter, farger eller andre felter
  - Ikke røre checklist-data, avvik-bilder, produkter eller andre seksjoner

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (med Task 2 og Task 3)
  - **Blocks**: Task 4, Task 5
  - **Blocked By**: None

  **References**:
  - `src/services/unifiedPdfGenerator.js` ~linje 1158 og ~1182 – eksakte steder der dato settes i PDF HTML
  - `src/services/unifiedPdfGenerator.js` – `fetchReportData()` – se at `o.scheduled_date AS service_date` allerede er med i SELECT
  - `src/services/unifiedPdfGenerator.js` – `generateHTML()` – her bygges PDF-malen; legg til servicedato-felt
  - Eksisterende datoformatering i samme fil – bruk samme mønster

  **Acceptance Criteria**:
  - [ ] `grep -n "completed_at\|created_at" src/services/unifiedPdfGenerator.js` – ingen treff i dato-visning-kontekst
  - [ ] PDF-preview inneholder teksten "Servicedato" med en dato

  ```
  Scenario: PDF viser scheduled_date som servicedato
    Tool: Bash (curl)
    Preconditions: En ordre med kjent scheduled_date eksisterer og har en service_report
    Steps:
      1. GET /api/orders/service-report/{reportId}/preview
      2. Assert response body inneholder "Servicedato" og datoen formatert DD.MM.YYYY
    Expected Result: HTML-body inneholder f.eks. "Servicedato</td><td>15.03.2026"
    Evidence: .sisyphus/evidence/task-1-pdf-date.txt

  Scenario: Fallback naar service_date mangler i customer_data
    Tool: Bash (node inline script)
    Preconditions: Ordre uten customer_data.service_date
    Steps:
      1. Kall generateHTML direkte med testdata der customer_data.service_date er undefined
      2. Assert output inneholder scheduled_date fra ordre
    Expected Result: Dato vises korrekt uten feilmelding
    Evidence: .sisyphus/evidence/task-1-fallback.txt
  ```

  **Commit**: YES (Wave 1 samlet)
  - Message: `fix(pdf): use scheduled_date as service date in PDF report`
  - Files: `src/services/unifiedPdfGenerator.js`

- [ ] 2. Rapport-kø-spørring: bruk `scheduled_date` istedenfor `MAX(sr.created_at)`

  **What to do**:
  - Finn rapport-kø-spørringen i `src/routes/admin/reports.js` der `MAX(sr.created_at) AS last_service_date` brukes
  - Bytt ut med `o.scheduled_date AS last_service_date` (eller et egnet alias)
  - Sørg for at frontend-kolonnen "Service" i rapporter.js fortsatt mottar feltet med riktig navn
  - Verifiser at eksisterende sortering på kolonnen fortsatt fungerer

  **Must NOT do**:
  - Ikke endre andre deler av kø-spørringen (filtrering, paginering, JOIN-er)
  - Ikke rename feltet i API-responsen hvis frontend allerede bruker `last_service_date`

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (med Task 1 og Task 3)
  - **Blocks**: F1
  - **Blocked By**: None

  **References**:
  - `src/routes/admin/reports.js` – finn SQL-spørringen med `MAX(sr.created_at)` og `last_service_date`
  - `public/admin/assets/js/rapporter.js` – finn hvor `last_service_date` brukes i tabellraden for å verifisere feltnavn

  **Acceptance Criteria**:
  - [ ] `grep -n "MAX(sr.created_at)" src/routes/admin/reports.js` – ingen treff
  - [ ] GET /api/admin/reports/queue returnerer `last_service_date` = `scheduled_date` for en testordre

  ```
  Scenario: Ko-kolonne viser scheduled_date
    Tool: Bash (curl)
    Steps:
      1. GET /api/admin/reports/queue (med Authorization-header)
      2. Finn en rad med kjent scheduled_date
      3. Assert at last_service_date i JSON matcher scheduled_date
    Expected Result: last_service_date === orders.scheduled_date for raden
    Evidence: .sisyphus/evidence/task-2-queue-date.json
  ```

  **Commit**: YES (Wave 1 samlet)
  - Message: `fix(reports): use scheduled_date in report queue service date column`
  - Files: `src/routes/admin/reports.js`

- [ ] 3. `edit-data`-endepunkt: eksponer `serviceDate` i respons

  **What to do**:
  - Finn `GET /api/admin/reports/:reportId/edit-data` i `src/routes/admin/reports.js`
  - Legg til `serviceDate` i responsobjektet: bruk `customer_data.service_date` (overstyrt) med fallback til `order.scheduled_date`
  - Formater som ISO-datostreng (YYYY-MM-DD) slik at HTML `<input type="date">` kan bruke det direkte

  **Must NOT do**:
  - Ikke endre andre felt i edit-data-responsen
  - Ikke bryte eksisterende konsumenter av dette endepunktet

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (med Task 1 og Task 2)
  - **Blocks**: Task 4, Task 5
  - **Blocked By**: None

  **References**:
  - `src/routes/admin/reports.js` – `GET /:reportId/edit-data` – se eksisterende responsobjekt
  - Eksisterende felt som `scheduledDate`, `customer_data` i samme respons – følg samme mønster

  **Acceptance Criteria**:
  - [ ] GET /api/admin/reports/:reportId/edit-data returnerer `serviceDate` som `YYYY-MM-DD`-streng

  ```
  Scenario: edit-data har serviceDate
    Tool: Bash (curl)
    Steps:
      1. GET /api/admin/reports/{reportId}/edit-data
      2. Assert JSON.serviceDate er en gyldig dato-streng (YYYY-MM-DD)
      3. Assert verdien matcher scheduled_date for ordren
    Expected Result: { "serviceDate": "2026-03-15", ... }
    Evidence: .sisyphus/evidence/task-3-editdata.json
  ```

  **Commit**: YES (Wave 1 samlet)
  - Message: `feat(reports): expose serviceDate in edit-data endpoint`
  - Files: `src/routes/admin/reports.js`

- [ ] 4. `rapporter.js`: legg til redigerbart servicedato-felt i rediger-modalen

  **What to do**:
  - Finn edit-modalen i `public/admin/rapporter.html` – legg til `<input type="date" id="edit-service-date">` med tilhørende label "Servicedato"
  - Plasser feltet logisk nær andre metadata-felt (avtalenummer, besøksnr, kontaktperson)
  - I `public/admin/assets/js/rapporter.js`:
    - I `populateEditModal(data)`: sett `document.getElementById('edit-service-date').value = data.serviceDate`
    - I `collectEditData()` eller tilsvarende funksjon: hent verdien og inkluder som `metadata.service_date`
  - Sørg for at feltet vises i modal-en og er klikkbart

  **Must NOT do**:
  - Ikke endre eksisterende felt i modalen (agreement_number, visit_number, contact_person osv.)
  - Ikke endre modal-layout utover å legge til det nye feltet

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (med Task 5)
  - **Blocks**: Task 5, F1
  - **Blocked By**: Task 1, Task 3

  **References**:
  - `public/admin/rapporter.html` – finn eksisterende metadata-felt i edit-modalen for å matche mønster
  - `public/admin/assets/js/rapporter.js` – `populateEditModal()` og `collectEditData()` / `saveEditedReport()` – følg eksakt samme mønster som `edit-agreement-number` og `edit-visit-number`

  **Acceptance Criteria**:
  - [ ] Edit-modal har et "Servicedato"-felt som vises når man klikker "Rediger PDF rapport"
  - [ ] Feltet er forhåndsutfylt med `serviceDate` fra edit-data-responsen

  ```
  Scenario: Servicedato-felt vises i rediger-modal
    Tool: Bash (curl)
    Steps:
      1. GET /api/admin/reports/{reportId}/edit-data
      2. Assert serviceDate-feltet eksisterer i respons og er gyldig dato
      3. (Visuell bekreftelse overlates til F1)
    Expected Result: serviceDate er tilgjengelig for modal-populering
    Evidence: .sisyphus/evidence/task-4-modal-data.json
  ```

  **Commit**: YES (Wave 2 samlet)
  - Message: `feat(reports): add editable service date field in report edit modal`
  - Files: `public/admin/rapporter.html`, `public/admin/assets/js/rapporter.js`

- [ ] 5. `update-content`: lagre overstyrt servicedato og bruk i PDF-regenerering

  **What to do**:
  - Finn `PUT /api/admin/reports/:reportId/update-content` i `src/routes/admin/reports.js`
  - Ta imot `metadata.service_date` fra request body
  - Lagre til `orders.customer_data.service_date` (merge inn i eksisterende JSONB-objekt, samme mønster som `agreement_number` og `visit_number`)
  - `unifiedPdfGenerator.js` vil automatisk bruke `customer_data.service_date` via fallback-logikken fra Task 1

  **Must NOT do**:
  - Ikke endre andre deler av `update-content`-logikken
  - Ikke legge til ny DB-kolonne – bruk `customer_data` JSONB

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (med Task 4)
  - **Blocks**: F1
  - **Blocked By**: Task 1, Task 3

  **References**:
  - `src/routes/admin/reports.js` – `PUT /:reportId/update-content` – se hvordan `agreement_number` og `visit_number` merges inn i `customer_data`
  - `src/services/unifiedPdfGenerator.js` – bekreft at `customer_data.service_date` vil bli plukket opp av fallback-logikken fra Task 1

  **Acceptance Criteria**:
  - [ ] PUT /api/admin/reports/:reportId/update-content med `metadata.service_date` returnerer 200
  - [ ] Etter lagring: GET edit-data returnerer oppdatert serviceDate
  - [ ] Regenerert PDF viser den nye datoen

  ```
  Scenario: Lagring av ny servicedato regenererer PDF korrekt
    Tool: Bash (curl)
    Steps:
      1. PUT /api/admin/reports/{reportId}/update-content med body { "metadata": { "service_date": "2026-06-01" } }
      2. Assert 200 OK
      3. GET /api/orders/service-report/{reportId}/preview
      4. Assert HTML inneholder "01.06.2026" som servicedato
    Expected Result: PDF reflekterer den overstyrte datoen
    Evidence: .sisyphus/evidence/task-5-update-and-preview.txt

  Scenario: service_date mangler i body – fallback til scheduled_date
    Tool: Bash (curl)
    Steps:
      1. PUT update-content uten service_date i metadata
      2. Preview PDF
      3. Assert scheduled_date vises, ingen feil
    Expected Result: Fallback fungerer, ingen 500-feil
    Evidence: .sisyphus/evidence/task-5-fallback.txt
  ```

  **Commit**: YES (Wave 2 samlet)
  - Message: `feat(reports): persist overridden service date in customer_data`
  - Files: `src/routes/admin/reports.js`

---

## Final Verification Wave

- [ ] F1. **End-to-end QA** — `unspecified-high`

  Verifiser alle tre delene av krav #1:

  1. Opprett eller finn en ordre med kjent `scheduled_date`.
  2. Generer/preview PDF – assert at "Servicedato" viser `scheduled_date` formatert som DD.MM.YYYY.
  3. Åpne "Rediger PDF rapport" for samme ordre – assert at servicedato-feltet er forhåndsutfylt med `scheduled_date`.
  4. Endre datoen, lagre – assert at regenerert PDF viser ny dato.
  5. Sjekk rapport-køen – assert at "Service"-kolonnen viser `scheduled_date` (ikke `created_at`).
  6. Verifiser at en gammel rapport uten `customer_data.service_date` fortsatt viser korrekt dato (fallback til `scheduled_date`).

  ```
  Scenario: PDF viser scheduled_date
    Tool: Bash (curl + node preview-kall eller direkte filsjekk)
    Steps:
      1. Hent en ordre med kjent scheduled_date: GET /api/admin/orders?status=scheduled
      2. Trigger preview: GET /api/orders/service-report/:reportId/preview
      3. Assert HTML-innhold inneholder scheduled_date formatert DD.MM.YYYY
    Evidence: .sisyphus/evidence/f1-pdf-date.txt

  Scenario: Rediger-modal forhåndsutfylt
    Tool: Bash (curl)
    Steps:
      1. GET /api/admin/reports/:reportId/edit-data
      2. Assert JSON-respons inneholder felt serviceDate med korrekt verdi
    Evidence: .sisyphus/evidence/f1-editdata-response.json

  Scenario: Lagring oppdaterer PDF-dato
    Tool: Bash (curl)
    Steps:
      1. PUT /api/admin/reports/:reportId/update-content med ny serviceDate
      2. Assert 200 OK
      3. Hent oppdatert preview og assert ny dato vises
    Evidence: .sisyphus/evidence/f1-update-response.json

  Scenario: Rapport-ko viser scheduled_date
    Tool: Bash (curl)
    Steps:
      1. GET /api/admin/reports/queue
      2. Assert last_service_date-feltet matcher scheduled_date for testordren
    Evidence: .sisyphus/evidence/f1-queue-response.json
  ```

  Output: `PDF-dato [PASS/FAIL] | Rediger-modal [PASS/FAIL] | Lagring [PASS/FAIL] | Ko-kolonne [PASS/FAIL] | VERDICT`

---

## Commit Strategy

- **Wave 1**: `fix(reports): use scheduled_date as service date in PDF and queue`
- **Wave 2**: `feat(reports): add editable service date field in report edit modal`

---

## Success Criteria

### Verification Commands
```bash
# Preview PDF og sjekk dato
curl http://localhost:3000/api/orders/service-report/{reportId}/preview | grep -i "servicedato"

# edit-data eksponerer serviceDate
curl http://localhost:3000/api/admin/reports/{reportId}/edit-data | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); console.log(JSON.parse(d).serviceDate)"

# Ko-respons har riktig dato
curl http://localhost:3000/api/admin/reports/queue | node -e "..."
```

### Final Checklist
- [ ] PDF: "Servicedato" viser `scheduled_date` (ikke `completed_at`)
- [ ] Rediger-modal: servicedato-felt finnes og er forhåndsutfylt
- [ ] Lagring: endret dato regenererer PDF korrekt
- [ ] Rapport-kø: "Service"-kolonne viser `scheduled_date`
- [ ] Fallback: ordre uten overstyrt dato bruker `scheduled_date` fra ordre
