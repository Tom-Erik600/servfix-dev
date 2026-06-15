# Visuell rydding i Tilbud-siden (tilbud.js)

## TL;DR

> **Quick Summary**: Rydde opp visuelt i admin/tilbud-oversikten ved å gjøre kunde + opprettet-dato til primær identitet, og fjerne internt ordrenummer og tilbuds-ID som ikke skal vises. Kun frontend, kun én fil: `public/admin/assets/js/tilbud.js`.
>
> **Deliverables**:
> - `renderQuotes` template oppdatert: kundenavn øverst, opprettet-dato under, beskrivelse, pris (uendret). Ingen ordre-/prosjekt-linje.
> - `displayQuoteDetails` header endret fra `Tilbud #${id}` til `${kunde.name} – ${beskrivelse}`. Hele Ordre detail-section fjernet.
> - Bevis (Playwright-screenshot + DOM-asserts) for ett quote-item-kort og ett detaljpanel, lagret i `.omo/evidence/`.
>
> **Estimated Effort**: Quick (under 30 min implementasjon, ~15 linjer endret i én fil).
> **Parallel Execution**: YES — 2 implementeringsoppgaver i parallell (uavhengige kode-regioner i samme fil, redigeres via line-anchors).
> **Critical Path**: Task 1 (renderQuotes) ∥ Task 2 (displayQuoteDetails) → Wave FINAL (F1-F4) → user okay.

---

## Context

### Original Request
Tom-Erik ba om visuell rydding av tilbud-siden i admin-panelet. Mål: kunde + prosjektnummer som primært, fjerne internt ordrenummer. Beskrivelse og opprettet-dato beholdes. Designet og funksjonalitet ellers skal ikke røres.

### Interview Summary

**Key Discussions**:
- **Initial spek**: vis kunde + prosjektnummer (`quote.order?.order_number`), fjern `order_id`-fallback.
- **STOPP-rapport etter verifisering**: backend-spørringen i `/api/quotes` selekterer ALDRI `o.order_number`, og DB-tabellen `orders` har ingen `order_number`-kolonne. Det som vises i UI som `PROJ-2026-...` er faktisk `quote.order_id` (orders.id) via `||`-fallbacken.
- **Brukeravgjørelse**: Fjern hele prosjektnummer-linjen fra UI. Ekte prosjektnummer (tripletex_order_id) håndteres som egen backend-oppgave senere.

**Research Findings**:
- `quote.created_at` finnes som DB-kolonne (`migrations/000-base-schema.sql:292`) og brukes allerede i detaljpanelet (`tilbud.js:213-218`).
- Ingen strukturert "anlegg"-kolonne eksisterer. Anlegg ligger embedded i `description`-tekst (typisk "Anlegg Bros22h: – ...").
- Backend `transformQuoteForFrontend` (`src/routes/quotes.js:28-61`) eksponerer `customer: { name, ... }`, `description`, `created_at`, men ikke `order.order_number`.

### Metis Review

**Identified Gaps** (addressed):
- **Dobbel-description-risiko**: Linje 54 har allerede `description` i `.quote-title`-span. Resolution: spek-punkt 1 "Øverst: kundenavn" betyr at `.quote-title`-content **byttes** fra description til kundenavn. Description vises kun én gang (i `.quote-description`).
- **H2-lengde i detaljpanel-header**: Default valgt — bruk 80-char truncation på description i `${kunde.name} – ${beskrivelse}`. Full description vises uansett i Beskrivelse-seksjonen nedenfor.
- **Kundenavn-fallback i H2**: `${quote.customer?.name || 'Ukjent kunde'}` for å unngå "undefined – ..." ved null-kunde.
- **`created_at`-fallback i listekort**: Conditional ternary — hvis falsy, render ingenting (matcher mønsteret på linje 213-218).
- **"Anlegg Bros22h:"-prefiks**: Ikke stripp. Keep raw. Heuristisk regex mot ustrukturert tekst er ut-av-scope.

---

## Work Objectives

### Core Objective
Endre kun visuell layout i `public/admin/assets/js/tilbud.js` slik at kunde + opprettet-dato er primær identitet på hvert tilbud, og slik at internt ordrenummer (`order_id`) og tilbuds-ID (`#id`) ikke lenger vises noe sted i UI-en.

### Concrete Deliverables
- `public/admin/assets/js/tilbud.js` modifisert på to spesifikke regioner:
  1. `renderQuotes` template (linje ~52-72): kundenavn → opprettet-dato → beskrivelse → pris.
  2. `displayQuoteDetails` header (linje 149) + fjernet Ordre detail-section (linje 208-211).
- 2× evidence-filer i `.omo/evidence/`: ett kort-screenshot, ett detaljpanel-screenshot, begge med innebygde DOM-asserts.

### Definition of Done
- [ ] `grep -n "Ordre:" public/admin/assets/js/tilbud.js` returnerer 0 treff (label fjernet fra listekort).
- [ ] `grep -n "Tilbud #" public/admin/assets/js/tilbud.js` returnerer 0 treff i `displayQuoteDetails`-templaten (h2 endret).
- [ ] `grep -n "quote.order_id" public/admin/assets/js/tilbud.js` returnerer 0 treff i synlige template-strenger (kun event handlers/data attrs kan beholdes hvis de finnes der).
- [ ] Playwright-screenshot viser kundenavn øverst i et `.quote-item`-kort, dato under, beskrivelse under det, pris nederst.
- [ ] Playwright-screenshot viser detaljpanel uten Ordre-seksjon og uten "Tilbud #..." i headeren.
- [ ] DOM-asserts: `.quote-meta` finnes ikke i kortet; `h2.quote-title-main` inneholder ikke `#`; `h2.quote-title-main` inneholder `–`.
- [ ] Estimat/MVA-blokken i detaljpanelet er pixel-uendret (visuell sammenligning mot before-screenshot).

### Must Have
- **Liste-kort i ny rekkefølge**: kundenavn + status-badge → opprettet-dato → beskrivelse (80-char trunc) → pris-rad.
- **Detaljpanel header**: `<h2 class="quote-title-main">${quote.customer?.name || 'Ukjent kunde'} – ${(quote.description || 'Uten beskrivelse').length > 80 ? (quote.description || '').substring(0, 80) + '...' : (quote.description || 'Uten beskrivelse')}</h2>`.
- **Detaljpanel**: Ordre `<div class="detail-section">` (linje 208-211) fullstendig fjernet.
- **Bevarte elementer**: status-badge styling/plassering, sent-status-badge, action-buttons-modern, Kunde-seksjon, Beskrivelse-seksjon, Opprettet-seksjon (linje 213-218), approved_at-seksjon (linje 220-225), hele Estimat-blokken, `.quote-price`-blokken, `data-quote-id`-attributtet, alle event handlers, PDF/preview-logikk.

### Must NOT Have (Guardrails)
- IKKE endre `tilbud.html` eller noen CSS-fil. Hvis layout knekker → STOPP og rapporter, ikke "fiks med CSS".
- IKKE endre `getStatusText`, `formatCurrency`, event-handlers, PDF/preview-logikk.
- IKKE legg til fallback til `quote.order_id` eller `quote.id` noe sted i synlig UI.
- IKKE endre Estimat-/MVA-beregningen.
- IKKE rør `sent-status-badge`-blokken (linje 150-157 i `displayQuoteDetails`).
- IKKE rør `approved_at`-blokken (linje 220-225 i `displayQuoteDetails`).
- IKKE rør `.quote-price`-blokken (linje 64-69 i `renderQuotes`).
- IKKE endre `data-quote-id`-attributtet på `.quote-item`.
- IKKE legg til ny `Opprettet`-blokk i detaljpanel — den finnes allerede.
- IKKE refaktorer eller "rens" linje 54 utover å bytte content fra `description` til `customer.name`.
- IKKE stripp "Anlegg Bros22h:"-prefiks fra description noe sted.
- IKKE commit, IKKE push, IKKE `git add`. Tom-Erik gjør `git add -p` selv.
- IKKE endre andre filer enn `public/admin/assets/js/tilbud.js`.
- IKKE rør backend (`src/routes/quotes.js` eller andre).

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: Irrelevant for denne oppgaven (pure visual UI cleanup).
- **Automated tests**: NONE. Ingen forretningslogikk endres.
- **Framework**: N/A.

### QA Policy
Hver implementeringsoppgave MUST inkludere agent-executed QA-scenarier via Playwright mot dev-server (airtech tenant). Bevis lagres til `.omo/evidence/task-{N}-{slug}.png`.

- **Frontend/UI** (denne oppgaven): Playwright — naviger til tilbud-siden, åpne et tilbud, snap kort + panel, kjør DOM-asserts.
- Negative scenarios obligatorisk (kunde uten navn, quote uten created_at — kan testes via DOM-manipulation i Playwright eller fixture-data om tilgjengelig).

---

## Execution Strategy

### Parallel Execution Waves

> Liten oppgave, én fil. Naturlig parallelitet er begrenset til 2 uavhengige funksjoner.

```
Wave 1 (Start Immediately — to uavhengige template-edits, parallell):
├── Task 1: Modifiser renderQuotes template          [quick]
└── Task 2: Modifiser displayQuoteDetails template   [quick]

Wave FINAL (Etter Wave 1 — 4 parallelle reviews):
├── Task F1: Plan compliance audit  (oracle)
├── Task F2: Code quality review    (unspecified-high)
├── Task F3: Real manual QA         (unspecified-high + playwright skill)
└── Task F4: Scope fidelity check   (deep)
-> Present results -> Wait for explicit user okay

Critical Path: (Task 1 ∥ Task 2) → F1-F4 → user okay
Parallel Speedup: ~50% vs sequential (2 implementeringsoppgaver i parallell + 4 reviews i parallell)
Max Concurrent: 4 (Wave FINAL)
```

> **Note on under-splitting**: Wave 1 har bare 2 oppgaver. Dette er forsvart fordi (a) det er én fil og (b) oppgavene er allerede atomiske — ytterligere splitting ville krevd at samme template literal redigeres av to oppgaver, som forårsaker konflikter. Granularitet er forced minimum.

### Dependency Matrix

| Task | Depends on | Blocks |
|------|------------|--------|
| 1    | None       | F1–F4  |
| 2    | None       | F1–F4  |
| F1   | 1, 2       | user-okay |
| F2   | 1, 2       | user-okay |
| F3   | 1, 2       | user-okay |
| F4   | 1, 2       | user-okay |

### Agent Dispatch Summary

| Wave | Tasks | Dispatch |
|------|-------|----------|
| 1    | 2     | T1 → `quick`, T2 → `quick` |
| FINAL| 4     | F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high` (+ `playwright` skill), F4 → `deep` |

---

## TODOs

- [ ] 1. Modifiser `renderQuotes` template i `public/admin/assets/js/tilbud.js`

  **What to do**:

  Endre template literal i `renderQuotes`-funksjonen (rundt linje 52-72) slik at hvert `.quote-item`-kort har følgende struktur:

  1. **`.quote-header`** (linje ~53-56): Bytt content i `.quote-title`-spanen fra `description` til `customer.name`. Bevar `.quote-status`-spanen og dens styling/posisjon UENDRET.

     - Fra: `<span class="quote-title">${(quote.description || 'Uten beskrivelse').substring(0, 40)}${(quote.description || '').length > 40 ? '...' : ''}</span>`
     - Til: `<span class="quote-title">${quote.customer?.name || 'Ukjent'}</span>`

  2. **Fjern `.quote-meta`-blokken FULLSTENDIG** (linje 57-60 i nåværende fil): den som inneholder `<strong>Kunde:</strong> ... | <strong>Ordre:</strong> ...`.

  3. **Sett inn ny dato-rad** mellom `.quote-header` og `.quote-description`. Bruk samme conditional ternary-mønster som linje 213-218 i `displayQuoteDetails`:

     ```
     ${quote.created_at ? `
         <div class="quote-date">${new Date(quote.created_at).toLocaleDateString('no-NO', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
     ` : ''}
     ```

     CSS-klassen `.quote-date` finnes muligens ikke. Hvis ja → fortsett. Hvis layout knekker visuelt → STOPP og rapporter (ikke legg til CSS). Default-rendering uten CSS er akseptabel som plain text under headeren.

  4. **`.quote-description`** (linje 62) — UENDRET. 80-char truncation, `'Ingen beskrivelse'`-fallback bevares.

  5. **`.quote-price`** (linje 64-69) — UENDRET. Ikke rør timer, materialer-indikator, eller formatCurrency-uttrykket.

  6. **`data-quote-id`-attributtet** og `.quote-item ${selectedQuoteId === quote.id ? 'selected' : ''}`-klassen — UENDRET. Click-handlers er avhengig.

  **Must NOT do**:
  - Ikke rør `getStatusText` eller `formatCurrency`.
  - Ikke endre `.quote-status`-spanen.
  - Ikke legg til `|| quote.order_id`-fallback noe sted.
  - Ikke gjør CSS-endringer. Hvis layout krever det → STOPP.
  - Ikke endre selector `.quote-item` eller `.quote-header`.
  - Ikke refaktorer `.quote-price`-uttrykket selv om det er flerlinjet.

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single-file, ~10 linjer endret, ren template-edit, ingen forretningslogikk.
  - **Skills**: `[]`
    - Ingen skill påkrevd. Standard edit-tools (Read + Edit) er tilstrekkelig.
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: Ikke designarbeid. User har eksplisitt sagt "designet skal IKKE røres" — bare reorganisere eksisterende strukturer.
    - `visual-qa`: Brukes i F3, ikke for selve edit-en.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (med Task 2)
  - **Blocks**: F1, F2, F3, F4
  - **Blocked By**: None — kan starte umiddelbart.
  - **Note**: Selv om Task 2 er i samme fil, redigerer den en annen funksjon (`displayQuoteDetails`) i et annet kode-område. Ingen overlapp i linjer som endres.

  **References**:

  **Pattern References** (existing code to follow):
  - `public/admin/assets/js/tilbud.js:50-73` — nåværende `renderQuotes`-template som skal endres.
  - `public/admin/assets/js/tilbud.js:213-218` — eksisterende conditional-rendering for `created_at` i detaljpanelet. Bruk SAMME formaterings-pattern (`toLocaleDateString('no-NO', { day:'numeric', month:'short', year:'numeric' })`) og SAMME conditional-struktur for ny dato-rad i listekortet.
  - `public/admin/assets/js/tilbud.js:57-58` — eksisterende `quote.customer?.name || 'Ukjent'`-mønster. Gjenbruk identisk for ny `.quote-title`.

  **API/Type References**:
  - Backend `transformQuoteForFrontend` (`src/routes/quotes.js:28-61`) bekrefter at `quote.customer.name`, `quote.description`, og `quote.created_at` finnes på objektet. Ikke verifiser dette igjen — det er allerede gjort i planleggings-fasen.

  **WHY Each Reference Matters**:
  - Linje 213-218 i samme fil viser EKSAKT mønsteret som skal brukes for ny dato-rad — kopier strukturen, bytt selector. Ikke skriv ny formaterings-logikk.
  - Linje 57-58 viser eksisterende customer-name-uttrykk — kopier det inn i `.quote-title`-spanen, ikke skriv ny variant.

  **Acceptance Criteria**:

  **Statisk verifisering** (kjør etter edit):
  - [ ] `grep -n "<strong>Ordre:</strong>" public/admin/assets/js/tilbud.js` → 0 treff
  - [ ] `grep -n "<strong>Kunde:</strong>" public/admin/assets/js/tilbud.js` → 0 treff (gammel meta-blokk borte)
  - [ ] `grep -n "order_number || quote.order_id" public/admin/assets/js/tilbud.js` → 0 treff
  - [ ] `grep -n 'class="quote-title">.*customer?.name' public/admin/assets/js/tilbud.js` → minst 1 treff (kunde i title-span)
  - [ ] `node -c public/admin/assets/js/tilbud.js` → exit 0 (syntaktisk gyldig)
  - [ ] `git diff --name-only` → returnerer KUN `public/admin/assets/js/tilbud.js`

  **QA Scenarios** (MANDATORY):

  ```
  Scenario: Liste-kort viser kunde øverst, dato under, beskrivelse, og pris-rad uendret
    Tool: Playwright (playwright skill)
    Preconditions: Dev-server kjører mot airtech tenant. Logget inn som admin. Minst ett tilbud finnes i DB med ikke-null customer.name, description og created_at.
    Steps:
      1. Naviger til `http://localhost:{PORT}/admin/tilbud.html` (eller faktisk dev-URL — sjekk package.json/dev-script).
      2. Vent på at `.quote-item` elementer rendres (timeout 10s).
      3. Velg første `.quote-item` (`page.locator('.quote-item').first()`).
      4. Assert: `.quote-title` inneholder kundenavn (ikke "Anlegg Bros22h" eller annet description-fragment). Bruk `expect(locator.locator('.quote-title')).toHaveText(customerName)` eller `not.toContainText('Anlegg')` som heuristisk negativ-test.
      5. Assert: `.quote-meta` finnes IKKE (`expect(locator.locator('.quote-meta')).toHaveCount(0)`).
      6. Assert: en dato-tekst i `.quote-date` (eller direkte tekst-content) i Norwegian-format finnes mellom header og description. Regex: `/\d+\.\s\w+\.?\s\d{4}/` (matcher "14. jun. 2026").
      7. Assert: `.quote-description` finnes og har content.
      8. Assert: `.quote-price` finnes (uendret pris-rad).
      9. Capture screenshot: `await page.locator('.quote-item').first().screenshot({ path: '.omo/evidence/task-1-quote-item-card.png' })`.
    Expected Result: Skjermbilde viser kundenavn → dato → beskrivelse → pris, ingen "Ordre:"-tekst, ingen "PROJ-..."-strenger synlig.
    Failure Indicators: "Ordre:" eller "PROJ-" synlig i kortet; `.quote-meta` finnes; description rendres øverst i stedet for kundenavn.
    Evidence: .omo/evidence/task-1-quote-item-card.png

  Scenario: Liste-kort uten created_at viser ingen dato-rad og crasher ikke
    Tool: Playwright (playwright skill)
    Preconditions: Dev-server kjører. Mock eller fixture for et quote-objekt uten created_at, ELLER bruk Playwright's `page.evaluate` til å midlertidig mutere `window.allQuotes` for test.
    Steps:
      1. Naviger til tilbud-siden.
      2. I `page.evaluate`, modifiser et quote-objekt i `allQuotes`-arrayet til å sette `created_at = null`, kall `renderQuotes(allQuotes)` på nytt.
      3. Locate det modifiserte kortet (via `data-quote-id`).
      4. Assert: kortet rendres uten å throw'e en error (`page.on('pageerror')` skal ikke fyre).
      5. Assert: ingen dato-rad mellom header og description for dette kortet.
      6. Capture screenshot: `.omo/evidence/task-1-quote-item-no-date.png`.
    Expected Result: Kortet rendres normalt, dato-rad er helt fraværende, ingen "Invalid Date" eller "null"-tekst synlig.
    Failure Indicators: Console error; "Invalid Date" tekst; "null" tekst der dato skulle vært.
    Evidence: .omo/evidence/task-1-quote-item-no-date.png
  ```

  **Evidence to Capture**:
  - [ ] `.omo/evidence/task-1-quote-item-card.png` (happy path)
  - [ ] `.omo/evidence/task-1-quote-item-no-date.png` (negative)

  **Commit**: NO — Tom-Erik kjører `git add -p` selv etter F1-F4 + okay.

- [ ] 2. Modifiser `displayQuoteDetails` template i `public/admin/assets/js/tilbud.js`

  **What to do**:

  Endre template literal i `displayQuoteDetails`-funksjonen slik:

  1. **Header `<h2 class="quote-title-main">`** (linje 149): bytt content fra `Tilbud #${quote.id}` til `${kunde.name} – ${beskrivelse}` med truncation:

     - Fra: `<h2 class="quote-title-main">Tilbud #${quote.id}</h2>`
     - Til:
       ```
       <h2 class="quote-title-main">${quote.customer?.name || 'Ukjent kunde'} – ${(quote.description || 'Uten beskrivelse').length > 80 ? (quote.description || '').substring(0, 80) + '...' : (quote.description || 'Uten beskrivelse')}</h2>
       ```

  2. **Fjern hele Ordre `<div class="detail-section">`** (linje 208-211 i nåværende fil):

     ```
     <div class="detail-section">
         <span class="detail-label">Ordre</span>
         <div class="detail-value">${quote.order?.order_number || `Ordre #${quote.order_id}`}</div>
     </div>
     ```

     Slett blokken komplett, inkludert eventuell omkringliggende whitespace/komma. Etterfølgende `Opprettet`-blokken (linje 213-218) skal rykke opp naturlig.

  3. **`Kunde`-seksjon** — UENDRET.
  4. **`Beskrivelse`-seksjon** (linje 228-230) — UENDRET. Full beskrivelse vises her uavkortet.
  5. **`Opprettet`-seksjon** (linje 213-218) — UENDRET. IKKE legg til en ekstra/duplikat dato-rad.
  6. **`approved_at`-seksjon** (linje 220-225) — UENDRET. Ligger rett under Opprettet — lett å ved et uhell slette. IKKE rør.
  7. **Hele `Estimat`-blokken** (inkludert MVA-kalkulasjon) — UENDRET, pixel-identisk.
  8. **`sent-status-badge`-blokken** (linje 150-157) — UENDRET. Action-buttons-modern (resten av header etter h2) — UENDRET.

  **Must NOT do**:
  - Ikke endre Estimat/MVA-beregning.
  - Ikke endre `sent-status-badge` eller `action-buttons-modern`.
  - Ikke fjern eller endre `approved_at`-blokken.
  - Ikke legg til fallback til `quote.id` eller `quote.order_id` i h2.
  - Ikke stripp "Anlegg Bros22h:"-prefiks fra description i h2 (keep raw).
  - Ikke gjør CSS-endringer. Hvis lang h2 bryter layout visuelt → STOPP og rapporter.
  - Ikke endre Beskrivelse-seksjonen — den skal fortsatt vise full description.

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single-file, ~5 linjer endret, ren template-edit.
  - **Skills**: `[]`
    - Ingen skill påkrevd.
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: Ikke designarbeid.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (med Task 1)
  - **Blocks**: F1, F2, F3, F4
  - **Blocked By**: None — kan starte umiddelbart.
  - **Note**: Endrer kun linjer 149 og 208-211 i samme fil. Ingen linje-overlapp med Task 1 (som endrer linjer ~52-72).

  **References**:

  **Pattern References**:
  - `public/admin/assets/js/tilbud.js:146-218` — nåværende `displayQuoteDetails`-template med eksakt struktur som skal modifiseres.
  - `public/admin/assets/js/tilbud.js:54` — eksisterende 80-char-truncation-pattern for description som skal gjenbrukes i h2.

  **API/Type References**:
  - `src/routes/quotes.js:28-61` — bekrefter at `quote.customer.name` og `quote.description` finnes (transformQuoteForFrontend setter dem eksplisitt).

  **WHY Each Reference Matters**:
  - Linje 54 viser EKSAKT 80-char-truncation-uttrykket. Kopier det inn i h2-templaten, ikke skriv ny variant.
  - Linje 146-218 viser hele detaljpanel-strukturen — bruk det som anker for å finne EKSAKT hvilke linjer som skal endres vs. bevares.

  **Acceptance Criteria**:

  **Statisk verifisering**:
  - [ ] `grep -n 'Tilbud #\${quote.id}' public/admin/assets/js/tilbud.js` → 0 treff
  - [ ] `grep -n '<span class="detail-label">Ordre</span>' public/admin/assets/js/tilbud.js` → 0 treff
  - [ ] `grep -n "order_number || \`Ordre #" public/admin/assets/js/tilbud.js` → 0 treff
  - [ ] `grep -n "quote.customer?.name || 'Ukjent kunde'" public/admin/assets/js/tilbud.js` → minst 1 treff (i h2)
  - [ ] `grep -c '<span class="detail-label">Opprettet</span>' public/admin/assets/js/tilbud.js` → nøyaktig 1 (ikke duplisert)
  - [ ] `grep -n "approved_at" public/admin/assets/js/tilbud.js` → uendret antall treff vs. før
  - [ ] `node -c public/admin/assets/js/tilbud.js` → exit 0
  - [ ] Estimat-blokken visuelt uendret (verifisert i F3).

  **QA Scenarios** (MANDATORY):

  ```
  Scenario: Detaljpanel-header viser "kunde – beskrivelse", Ordre-seksjon er borte
    Tool: Playwright (playwright skill)
    Preconditions: Dev-server kjører mot airtech tenant. Minst ett tilbud finnes med customer.name og description satt.
    Steps:
      1. Naviger til tilbud-siden.
      2. Klikk på første `.quote-item` for å åpne detaljpanelet.
      3. Vent på at `.quote-details-header-modern` rendres.
      4. Assert: `h2.quote-title-main` IKKE inneholder `#` (`expect(locator).not.toContainText('#')`).
      5. Assert: `h2.quote-title-main` IKKE inneholder `Tilbud ` (`expect(locator).not.toContainText('Tilbud ')`).
      6. Assert: `h2.quote-title-main` inneholder `–` (en-dash separator).
      7. Assert: `h2.quote-title-main`-text matcher mønster `/^.+ – .+/` (kunde-separator-beskrivelse).
      8. Assert: ingen `.detail-section` med label "Ordre" finnes (`expect(page.locator('.detail-label', { hasText: 'Ordre' })).toHaveCount(0)`).
      9. Assert: `.detail-section` med label "Kunde" finnes (uendret).
      10. Assert: `.detail-section` med label "Beskrivelse" finnes og inneholder full description.
      11. Assert: `.detail-section` med label "Opprettet" finnes nøyaktig én gang.
      12. Assert: `.sent-status-badge` rendres KUN hvis status === 'sent' (uendret oppførsel).
      13. Assert: action-buttons-modern finnes (uendret).
      14. Assert: Estimat-blokk finnes med samme MVA-kalkulasjon (sjekk totalsum mot et kjent quote-objekt fra fixtures).
      15. Capture screenshot av hele `.quote-details-header-modern` + alle detail-sections: `.omo/evidence/task-2-detail-panel.png`.
    Expected Result: Header er "[Kundenavn] – [beskrivelse, evt. avkortet]", ingen Ordre-seksjon, alt annet uendret.
    Failure Indicators: "Tilbud #" synlig; "Ordre" label synlig; "Opprettet" label dupliseres; Estimat-tall forandret; approved_at-seksjonen forsvunnet.
    Evidence: .omo/evidence/task-2-detail-panel.png

  Scenario: Detaljpanel for quote uten kundenavn viser "Ukjent kunde" i h2, crasher ikke
    Tool: Playwright (playwright skill)
    Preconditions: Dev-server kjører. Mock via `page.evaluate` for å sette `quote.customer.name = null` på et tilbud før klikk.
    Steps:
      1. Naviger til tilbud-siden.
      2. Via `page.evaluate`: muter `allQuotes[0].customer.name = null`, deretter `displayQuoteDetails(allQuotes[0])`.
      3. Assert: ingen pageerror fyrer.
      4. Assert: `h2.quote-title-main` inneholder "Ukjent kunde".
      5. Assert: separator-pattern `Ukjent kunde – ` finnes (ikke "undefined – ").
      6. Capture screenshot: `.omo/evidence/task-2-detail-panel-null-customer.png`.
    Expected Result: h2 rendres som "Ukjent kunde – [beskrivelse]".
    Failure Indicators: "undefined" synlig i h2; "null" synlig; render-crash.
    Evidence: .omo/evidence/task-2-detail-panel-null-customer.png
  ```

  **Evidence to Capture**:
  - [ ] `.omo/evidence/task-2-detail-panel.png` (happy path)
  - [ ] `.omo/evidence/task-2-detail-panel-null-customer.png` (negative)

  **Commit**: NO — Tom-Erik kjører `git add -p` selv etter F1-F4 + okay.

---

## Final Verification Wave (MANDATORY — etter alle implementeringsoppgaver)

> 4 review-agenter kjøres i PARALLELL. Alle må APPROVE. Presenter konsolidert resultat til Tom-Erik og få eksplisitt "okay" før arbeidet markeres ferdig.
>
> **Ikke auto-proceed etter verifisering. Vent på Tom-Eriks eksplisitte godkjenning.**
> **F1-F4 IKKE markeres ferdig før Tom-Erik gir okay.** Avslag eller feedback → fiks → re-run → present på nytt → vent på okay.

- [ ] F1. **Plan Compliance Audit** — `oracle`

  Les denne planen end-to-end. For hver "Must Have": verifiser at implementasjonen finnes (les `public/admin/assets/js/tilbud.js`, grep etter forventede strenger). For hver "Must NOT Have": søk kodebasen og diffen etter forbudte mønstre — avvis med fil:linje hvis funnet (spesielt: `quote.order_id` i synlige template-strenger, `Tilbud #` i `displayQuoteDetails`, `Ordre:` i `renderQuotes`, endringer i CSS/HTML/backend-filer). Sjekk at evidence-filer finnes i `.omo/evidence/`. Sammenlign deliverables mot planen.

  **Output**: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [2/2] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`

  Sjekk `git diff -- public/admin/assets/js/tilbud.js`. Sørg for at:
  - Ingen filer utenfor `public/admin/assets/js/tilbud.js` er endret (`git diff --name-only` returnerer kun denne filen).
  - Ingen `console.log`, ingen `// TODO`, ingen kommentert-ut kode.
  - Ingen ubrukte imports/variabler introdusert.
  - Template literals er syntaktisk korrekte (parse JS — kjør f.eks. `node -c public/admin/assets/js/tilbud.js` om mulig, eller `bun build` hvis bygg-pipeline finnes).
  - Indentering konsistent med eksisterende stil i filen.
  - Ingen AI-slop: generic navn, over-abstraksjon, eller "forbedringer" utenfor scope.

  **Output**: `Files changed [1 of 1 expected] | Syntax [PASS/FAIL] | Slop [CLEAN/N issues] | VERDICT: APPROVE/REJECT`

- [ ] F3. **Real Manual QA** — `unspecified-high` (+ `playwright` skill)

  Start fra clean state. Kjør dev-server mot airtech tenant. Naviger til tilbud-siden. Eksekver ALLE QA-scenarier fra Task 1 og Task 2 — følg eksakte steg, capture nye evidence-filer til `.omo/evidence/final-qa/`. Test cross-task integrasjon:
  - Klikk på et kort → detaljpanel åpner → header viser "kunde – beskrivelse", ingen Ordre-seksjon, dato vises.
  - Klikk på et annet kort → samme oppførsel for andre tilbud.
  - Test edge case: åpne tilbud uten beskrivelse (om noen finnes i tenant) — verifiser at fallback "Uten beskrivelse"/"Ingen beskrivelse" vises.
  - Test edge case: tilbud uten kunde (om noen) — verifiser "Ukjent"/"Ukjent kunde" vises.
  - Visuell sammenligning av Estimat-blokken før/etter (skal være pixel-identisk).

  **Output**: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT: APPROVE/REJECT`

- [ ] F4. **Scope Fidelity Check** — `deep`

  Les `git diff -- public/admin/assets/js/tilbud.js`. For hver endret kodeblokk:
  - Mappér til en konkret "What to do"-instruksjon i Task 1 eller Task 2.
  - Verifiser at ingen "Must NOT do"-element er brutt (sjekk spesielt: sent-status-badge intakt, approved_at intakt, .quote-price intakt, data-quote-id intakt, Estimat-blokk intakt).
  - Flag enhver endring som ikke kan spores tilbake til en eksplisitt task-instruksjon.

  Verifiser at `git diff --name-only` returnerer KUN `public/admin/assets/js/tilbud.js` — ingen andre filer (CSS, HTML, backend, package.json, etc.) er rørt.

  **Output**: `Tasks [2/2 compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT: APPROVE/REJECT`

---

## Commit Strategy

Ingen commits utføres av agent. Tom-Erik kjører `git add -p` selv etter at F1-F4 har APPROVE og Tom-Erik har gitt eksplisitt okay.

Foreslått commit-melding (for Tom-Erik å bruke om ønskelig):
- `refactor(admin/tilbud): forenkle visuell layout — kunde + dato som primær, fjern intern ID`

---

## Success Criteria

### Verification Commands

```bash
# Skal returnere ingenting (label fjernet)
grep -n "<strong>Ordre:</strong>" public/admin/assets/js/tilbud.js

# Skal returnere ingenting (intern ID fjernet fra h2)
grep -n 'Tilbud #\${quote.id}' public/admin/assets/js/tilbud.js

# Skal returnere ingenting (ingen synlig fallback til order_id)
grep -n "order_number || quote.order_id" public/admin/assets/js/tilbud.js
grep -n "order_number || \`Ordre #" public/admin/assets/js/tilbud.js

# Skal returnere KUN public/admin/assets/js/tilbud.js
git diff --name-only

# Syntakskontroll
node -c public/admin/assets/js/tilbud.js
```

### Final Checklist
- [ ] Alle "Must Have" punkter implementert (verifisert av F1).
- [ ] Alle "Must NOT Have" punkter overholdt (verifisert av F1 + F4).
- [ ] Kun én fil endret (verifisert av F4).
- [ ] Playwright-screenshots viser ny layout korrekt (verifisert av F3).
- [ ] Estimat/MVA visuelt uendret (verifisert av F3).
- [ ] Tom-Erik har gitt eksplisitt okay etter å ha sett F1-F4 resultater.
