# Legg til Tekniker-kolonne i dashboard-tabeller

## TL;DR

> **Quick Summary**: Legg til en "Tekniker"-kolonne i alle tre tabeller på dashboard.html slik at admin ser hvem som er tildelt hvert oppdrag. Data er allerede hentet fra API.
>
> **Deliverables**:
> - `dashboard.html` — 3 tabeller får ny `<col>`, `<th>Tekniker</th>` og oppdatert colspan
> - `dashboard.js` — 3 populate-funksjoner renderer tekniker-navn i `<td>`
> - `admin.css` — ny `.col-tekniker` bredderegel
>
> **Estimated Effort**: Quick
> **Parallel Execution**: YES — 2 waves (Wave 1: 3 parallelle filer, Wave FINAL: 3 parallelle reviews)
> **Critical Path**: Task 1+2+3 (parallelt) → F1+F2+F3 (parallelt)

---

## Context

### Original Request
Bruker observerte at tekniker ikke er synlig i dashboard-oversikten og ønsker å se hvilke teknikere som skal ha service.

### Interview Summary
**Key Discussions**:
- Kolonne-posisjon: Etter Kunde (Ordrenr | Kunde | **Tekniker** | Beskrivelse | Anleggstype | Dato | Status | [Slett])
- Fallback: `—` (tankestrek) når ingen tekniker er tildelt

**Research Findings**:
- `technicianMap` er allerede bygget og sendt inn til alle tre `populate*`-funksjoner — ingen backend-endringer nødvendig
- Korrekt felt for oppslag: `order.technician_id ?? order.technicianId` (defensivt mot mixed casing)
- `colspan="7"` finnes på 4 steder: linje 334, 423, 511 i dashboard.js + linje 659 i showErrorState()
- Eksisterende kolonne-klasser i admin.css har eksplisitte bredder — `.col-tekniker` må legges til

### Metis Review
**Identified Gaps** (addressed):
- Kolonne-posisjon ikke spesifisert → avklart: etter Kunde
- Fallback-tekst ikke spesifisert → avklart: `—`
- CSS-kolonne-bredde ikke planlagt → inkludert i oppgave 1
- Mixed camelCase/snake_case felt → defensivt oppslag `order.technician_id ?? order.technicianId`
- colspan på 4 steder, ikke 3 → alle 4 er nå eksplisitt listet

---

## Work Objectives

### Core Objective
Legg til Tekniker-kolonne i de tre dashboard-tabellene ved å bruke data som allerede er tilgjengelig i klienten.

### Concrete Deliverables
- `public/admin/assets/css/admin.css` — `.col-tekniker { width: 14%; }`
- `public/admin/dashboard.html` — `<col>`, `<th>` og colspan oppdatert i alle 3 tabeller
- `public/admin/assets/js/dashboard.js` — tekniker-`<td>` i alle 3 populate-funksjoner + colspan i showErrorState()

### Definition of Done
- [ ] Alle tre tabeller viser "Tekniker" som kolonneoverskrift
- [ ] Ordre med tildelt tekniker viser tekniker-navn i kolonnen
- [ ] Ordre uten tekniker viser `—`
- [ ] Ingen tabell har visuelt brutt layout (colspan matcher antall kolonner)

### Must Have
- Tekniker-kolonne synlig i alle tre tabeller (dagens, ukens, uferdige)
- Korrekt fallback `—` for ordre uten tekniker
- Alle colspan oppdatert til 8 (4 steder)
- CSS-bredderegel for `.col-tekniker`

### Must NOT Have (Guardrails)
- **IKKE** sortering eller filtrering på tekniker-kolonnen
- **IKKE** endre ordredetalj-modal — tekniker vises allerede der
- **IKKE** endre funksjonsignaturer til `populate*`-funksjonene
- **IKKE** backend-endringer
- **IKKE** refaktorere mixed camelCase/snake_case felt i resten av filen
- **IKKE** legg til tooltip eller ekstra kontaktinfo på tekniker-cellen
- **IKKE** endre eksisterende kolonner eller rekkefølge

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: Usikkert / ikke relevant for denne endringen
- **Automated tests**: None — rent UI-change
- **Agent-Executed QA**: Playwright browser-verifisering

### QA Policy
Playwright åpner dashboard, verifiserer kolonneoverskrift, radinnhold og layout.

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — alle tre filer er uavhengige):
├── Task 1: admin.css — legg til .col-tekniker bredderegel [quick]
├── Task 2: dashboard.html — legg til <col> og <th> i alle 3 tabeller [quick]
└── Task 3: dashboard.js — legg til <td> i alle 3 populate-funksjoner + colspan [quick]

Wave FINAL (etter Wave 1):
├── Task F1: Plan Compliance Audit (oracle)
├── Task F2: Browser QA med Playwright (unspecified-high + playwright)
└── Task F3: Scope Fidelity Check (oracle)
```

### Dependency Matrix

- **1**: ingen → F1, F2, F3
- **2**: ingen → F1, F2, F3
- **3**: ingen → F1, F2, F3
- **F1**: 1, 2, 3
- **F2**: 1, 2, 3
- **F3**: 1, 2, 3

### Agent Dispatch Summary

- **Wave 1**: 3 tasks — T1 → `quick`, T2 → `quick`, T3 → `quick`
- **Wave FINAL**: 3 tasks — F1 → `oracle`, F2 → `unspecified-high`, F3 → `oracle`

---

## TODOs

- [x] 1. admin.css: Legg til `.col-tekniker` bredderegel og juster eksisterende kolonner

  **What to do**:
  - Les `public/admin/assets/css/admin.css` linje 403-409 for å se eksisterende kolonne-bredder
  - Legg til ny regel etter `.col-dato`-linjen (linje 407):
    ```css
    .dashboard-table .col-tekniker { width: 14%; }
    ```
  - Juster eksisterende regler slik at total bredde ikke overskrider 100%:
    - `.col-beskrivelse`: endre fra `24%` til `20%`
    - `.col-anleggstype`: endre fra `20%` til `16%`
  - Ikke endre andre regler

  **Must NOT do**:
  - IKKE endre andre CSS-regler enn de tre nevnte
  - IKKE legge til hover-effekter, farger eller annet styling på kolonnen

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Enkelt CSS-tillegg, ingen logikk
  - **Skills**: ingen

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (med Task 2 og Task 3)
  - **Blocks**: F1, F2, F3
  - **Blocked By**: None

  **References**:
  - `public/admin/assets/css/admin.css:403-409` — eksisterende kolonne-bredde-regler, følg samme format

  **Acceptance Criteria**:
  - [ ] `.col-tekniker`-regel finnes i admin.css
  - [ ] `.col-beskrivelse` er satt til `20%`
  - [ ] `.col-anleggstype` er satt til `16%`

  **QA Scenarios**:
  ```
  Scenario: CSS-regel eksisterer
    Tool: Bash (grep)
    Steps:
      1. grep "col-tekniker" public/admin/assets/css/admin.css
    Expected Result: Linjen `.dashboard-table .col-tekniker { width: 14%; }` finnes
    Failure Indicators: Ingen treff
    Evidence: .omo/evidence/task-1-css-grep.txt
  ```

  **Commit**: NO (grupperes med Task 2 og 3)

---

- [x] 2. dashboard.html: Legg til `<col class="col-tekniker">` og `<th>Tekniker</th>` i alle tre tabeller

  **What to do**:
  - Les `public/admin/dashboard.html` — finn de tre tabellene: `#dagens-oppdrag`, `#ukens-oppdrag`, `#uferdige-oppdrag`
  - I **hver** av de tre tabellenes `<colgroup>` — legg til etter `<col class="col-kunde">`:
    ```html
    <col class="col-tekniker">
    ```
  - I **hver** av de tre tabellenes `<thead><tr>` — legg til etter `<th>Kunde</th>`:
    ```html
    <th>Tekniker</th>
    ```
  - Ikke endre noe annet i HTML-filen

  **Must NOT do**:
  - IKKE endre eksisterende `<th>`-rekkefølge
  - IKKE endre modaler eller annet innhold i filen

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Ren HTML-tekstendring, tre identiske steder
  - **Skills**: ingen

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (med Task 1 og Task 3)
  - **Blocks**: F1, F2, F3
  - **Blocked By**: None

  **References**:
  - `public/admin/dashboard.html:51-72` — første tabell (dagens-oppdrag), følg samme mønster for de to andre

  **Acceptance Criteria**:
  - [ ] `<col class="col-tekniker">` finnes 3 ganger i filen
  - [ ] `<th>Tekniker</th>` finnes 3 ganger i filen, alltid etter `<th>Kunde</th>`

  **QA Scenarios**:
  ```
  Scenario: col og th er lagt til korrekt antall ganger
    Tool: Bash (grep)
    Steps:
      1. grep -c "col-tekniker" public/admin/dashboard.html
      2. grep -c "Tekniker" public/admin/dashboard.html
    Expected Result: Begge gir output "3"
    Failure Indicators: Lavere eller høyere enn 3
    Evidence: .omo/evidence/task-2-html-grep.txt
  ```

  **Commit**: NO (grupperes med Task 1 og 3)

---

- [x] 3. dashboard.js: Legg til tekniker-`<td>` i alle tre populate-funksjoner og oppdater colspan

  **What to do**:
  - Les `public/admin/assets/js/dashboard.js`

  **I `populateTodaysTable()` (linje ~364-385)**:
  - Legg til før `<td>${customerName}</td>`-linjen:
    ```js
    const technicianName = technicianMap.get(order.technician_id ?? order.technicianId) || '—';
    ```
  - Legg til `<td>${technicianName}</td>` rett etter `<td>${customerName}</td>` i template-strengen
  - Oppdater `colspan="7"` → `colspan="8"` i empty-state (linje ~334)

  **I `populateWeeklyTable()` (linje ~454-475)**:
  - Samme endringer: legg til `technicianName`-variabel og `<td>` etter `customerName`
  - Oppdater `colspan="7"` → `colspan="8"` i empty-state (linje ~423)

  **I `populateUnfinishedTable()` (linje ~527-546)**:
  - Samme endringer: legg til `technicianName`-variabel og `<td>` etter `customerName`
  - Oppdater `colspan="7"` → `colspan="8"` i empty-state (linje ~511)

  **I `showErrorState()` (linje ~659)**:
  - Oppdater `colspan="7"` → `colspan="8"` i feilmeldings-raden

  **Must NOT do**:
  - IKKE endre funksjonsignaturer
  - IKKE endre `openOrderModal()` eller modalinnhold
  - IKKE refaktorere felt-navngiving andre steder i filen
  - IKKE flytte eller endre eksisterende `<td>`-elementer

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Repetitiv, veldefinert JS-tekstendring på 4 kjente steder
  - **Skills**: ingen

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (med Task 1 og Task 2)
  - **Blocks**: F1, F2, F3
  - **Blocked By**: None

  **References**:
  - `public/admin/assets/js/dashboard.js:364-385` — rad-rendering i `populateTodaysTable()`
  - `public/admin/assets/js/dashboard.js:454-475` — rad-rendering i `populateWeeklyTable()`
  - `public/admin/assets/js/dashboard.js:527-546` — rad-rendering i `populateUnfinishedTable()`
  - `public/admin/assets/js/dashboard.js:68-83` — technicianMap bygges her (Map<id, name>)

  **Acceptance Criteria**:
  - [ ] `technicianName` er definert i alle tre populate-funksjoner
  - [ ] `<td>${technicianName}</td>` finnes 3 ganger i filen
  - [ ] `colspan="8"` finnes 4 ganger (3 empty-states + 1 error-state)
  - [ ] `colspan="7"` finnes 0 ganger etter endringen

  **QA Scenarios**:
  ```
  Scenario: colspan er oppdatert alle steder
    Tool: Bash (grep)
    Steps:
      1. grep -c 'colspan="7"' public/admin/assets/js/dashboard.js
      2. grep -c 'colspan="8"' public/admin/assets/js/dashboard.js
    Expected Result: Første gir "0", andre gir "4"
    Failure Indicators: colspan="7" fortsatt tilstede
    Evidence: .omo/evidence/task-3-colspan-grep.txt

  Scenario: Tekniker vises korrekt i browser
    Tool: Playwright
    Preconditions: Innlogget som admin, minst ett oppdrag med og ett uten tekniker
    Steps:
      1. Naviger til /admin/dashboard.html
      2. Vent til tabellene er lastet (tbody ikke tom)
      3. Assert at <th> med tekst "Tekniker" finnes i alle tre tabeller
      4. Finn rad med kjent tekniker — assert tredje <td> viser tekniker-navn
      5. Finn rad uten tekniker — assert tredje <td> inneholder "—"
      6. Ta screenshot
    Expected Result: Navn vises for tildelte, "—" for ikke-tildelte
    Failure Indicators: Tom celle, "undefined", UUID, eller feil posisjon
    Evidence: .omo/evidence/task-3-browser-qa.png

  Scenario: Empty-state colspan er korrekt visuelt
    Tool: Playwright
    Steps:
      1. Naviger til /admin/dashboard.html på dag uten oppdrag
      2. Assert at empty-state rad i #dagens-oppdrag-liste strekker seg over alle 8 kolonner
      3. Ingen visuell gap ved kolonne 8
    Expected Result: Full-bredde tom-rad
    Evidence: .omo/evidence/task-3-empty-state.png
  ```

  **Commit**: YES (sammen med Task 1 og 2)
  - Message: `feat(dashboard): legg til tekniker-kolonne i oversiktstabeller`
  - Files: `public/admin/dashboard.html`, `public/admin/assets/js/dashboard.js`, `public/admin/assets/css/admin.css`
  - Pre-commit: Kjør grep-scenarioene fra Task 1, 2 og 3 for rask sanity-check

---

## Final Verification Wave

- [x] F1. **Plan Compliance Audit** — `oracle`
  Les planen og verifiser at alle "Must Have" er implementert: Tekniker-kolonne i alle 3 tabeller, korrekt fallback, alle 4 colspan oppdatert, CSS-regel lagt til. Sjekk at "Must NOT Have" ikke er brutt (ingen modal-endringer, ingen backend-endringer, ingen sortering).
  Output: `Must Have [N/N] | Must NOT Have [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Browser QA** — `unspecified-high` + `playwright`
  Kjør alle 4 QA-scenarioer fra oppgave 1. Verifiser at alle tre tabeller viser Tekniker-kolonnen, at navn og fallback rendres korrekt, og at layout ikke er brutt.
  Output: `Scenarios [4/4 pass] | Layout [OK] | VERDICT: APPROVE/REJECT`

- [x] F3. **Scope Fidelity Check** — `oracle`
  Les git diff. Verifiser at kun `dashboard.html`, `dashboard.js` og `admin.css` er endret. Sjekk at ingen andre funksjoner, modal eller backend-filer er rørt.
  Output: `Files changed [3/3 expected] | Contamination [CLEAN/issues] | VERDICT: APPROVE/REJECT`

---

## Commit Strategy

- `feat(dashboard): legg til tekniker-kolonne i oversiktstabeller`
  - `public/admin/dashboard.html`
  - `public/admin/assets/js/dashboard.js`
  - `public/admin/assets/css/admin.css`

---

## Success Criteria

### Final Checklist
- [ ] Alle tre tabeller viser "Tekniker" som kolonneoverskrift
- [ ] Tekniker-navn rendres korrekt for tildelte oppdrag
- [ ] `—` vises for oppdrag uten tekniker
- [ ] Ingen visuelt brutt layout (colspan korrekt på alle 4 steder)
- [ ] Kun 3 filer endret — ingen scope creep
