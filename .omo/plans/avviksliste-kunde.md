# Avvikslista - utvid med kunde, beskrivelse, tekniker og rapport-lenke

> **PIVOT v2**: Denne planen ERSTATTER tidligere versjon som foreslo en tredje fane "Avviksliste-kunde" med egen render og view=kunde-eksport. Per brukerinstruks v1.7 utvider vi den eksisterende avvikslista direkte (lite/ubrukt intern visning - ingen grunn til å bevare urørt).
>
> **Post-Oracle korreksjoner**: Kolonnetelling rettet fra 12 til 13 (9 + 4). Colspan-oppdatering tillates eksplisitt. `viewOrderPDFs` byttet til `_avvikWorklistSeeReport` (faktisk funksjon som arbeidslista bruker - bekreftet av Tom-Erik). Eksport-utvidelse er en del av planen direkte (Tom-Eriks beslutning: utvid standard-eksporten, ingen view=kunde-parameter).

## TL;DR

> **Quick Summary**: Utvid den eksisterende avvikslista (andre fane på `public/admin/avvik.html`) med fire nye kolonner per rad: Kunde, Beskrivelse (med Tripletex-fallback), Utført av, og en "Se rapport"-knapp som gjenbruker `_avvikWorklistSeeReport`. Backend: utvidet `DEVIATION_SELECT` med LEFT JOIN-kjede. Frontend: utvid `renderTable` + `<thead>`, oppdater `colspan` på loading-/empty-rader. Eksport: utvid standard CSV+PDF-eksporten direkte med de fire feltene. Ingen ny fane, ingen `view=kunde`-eksport, ingen ny render-funksjon.
>
> **Deliverables**:
> - Read-first verifikasjon (2 stop-conditions sjekket: multi-tekniker, manglende datafelter)
> - Utvidet `DEVIATION_SELECT` med 4 nye felt via LEFT JOIN-kjede
> - Utvidet eksisterende avvikslista-tabell med 4 nye kolonner inkludert «Se rapport»-knapp; colspan oppdatert
> - Utvidet standard CSV/PDF-eksport med samme 4 felter
> - Ren `formatOrderDescription`-hjelpefunksjon med jest-test (TDD)
>
> **Estimert effort**: Kort
> **Parallell utførelse**: Begrenset - 3 sekvensielle bølger + verifiseringsbølge (avhengigheter forhindrer parallellisme)
> **Critical path**: 1 (read-first) → 2 (backend SELECT) → 3+4 (frontend + eksport parallelt) → F1-F4 → Tom-Eriks godkjenning

---

## Context

### Original Request (brukerinstruks v1.7 - forkortet)
Tom-Erik leverte detaljert instruks som forkaster forrige plan. Vil ha fire tillegg per rad i den EKSISTERENDE avvikslista (ikke en tredje fane):
1. Kunde (kundenavn fra ordren)
2. Beskrivelse - ordrebeskrivelse, med Tripletex-prosjektnummer som fallback når beskrivelse mangler
3. Utført av - teknikeren som gjorde servicen (fra service_reports via avvikets opened_in_report_id)
4. "Se rapport"-knapp - gjenbruk det arbeidslista bruker (`_avvikWorklistSeeReport`)

### Workflow-regler (brukerspesifikke - overstyrer standard)
- **Arbeidsmodus**: PLAN → vent på godkjenning → BUILD → RAPPORTER for VERIFIKASJON
- **Ingen git-operasjoner fra executor** - Tom-Erik eier ALLE commits
- **Stopp-og-rapporter ved divergens** - executor må STOPPE hvis virkeligheten avviker fra planen
- **Tom-Erik gjør manuell dev-QA selv** etter executor-rapport (agent-QA i planen er for executors egen verifikasjon før rapport)

### Avklarte avgjørelser etter Oracle-runde
- **"Se rapport"-knapp**: gjenbruk `_avvikWorklistSeeReport` (avvik.js:318-326) - samme funksjon arbeidslista faktisk bruker. Definert i samme fil som renderTable, så ingen ny `<script>`-tag. Plasseres som tabellcelle (ikke kort-stil).
- **Eksport**: utvid standard-eksporten (deviationsExport.js) direkte med 4 nye kolonner/felter. Ingen view=kunde-parameter. Tom-Erik bekrefter at ingen er avhengig av dagens format.

### Research-grunnlag (fra tidligere explore-agent, supplert av Oracle-funn)
- `src/routes/admin/deviations.js:52-71` - DEVIATION_SELECT-konstanten (her appendes de 4 nye feltene)
- `src/routes/admin/deviations.js:249-259` - list-endepunktets spørring (her legges LEFT JOIN-kjeden til)
- `src/routes/admin/deviations.js:278-400` - worklist-endepunktet joiner ALLEREDE `orders` for customer_name + description (linje 310-311). Bevist mønster å kopiere
- `public/admin/avvik.html:337-345` - avvikslista-tabellens 9 `<th>`-elementer
- `public/admin/avvik.html:349` - loading-row med `colspan="9"` (må oppdateres til 13)
- `public/admin/assets/js/avvik.js:362-380` - `renderTable()` (avvikslista, IKKE arbeidslista)
- `public/admin/assets/js/avvik.js:364` - empty-state-render med `colspan="9"` (må oppdateres til 13)
- `public/admin/assets/js/avvik.js:318-326` - `_avvikWorklistSeeReport` - gjenbrukes for "Se rapport"-knappen
- `src/services/deviationsExport.js:6-52` - CSV-bygger med fast kolonneliste (linje 8 headers, linje 33-47 rad-mapping) - utvides direkte
- `src/services/deviationsExport.js:90-212` - PDF-template (Puppeteer card-basert) - utvides direkte
- Datakilder: `orders.customer_name`, `orders.description`, `orders.tripletex_order_id`, `service_reports.technician_id`, `deviations.opened_in_report_id` - alle eksisterer iht. baseline-schema (verifiseres i T1)

---

## Work Objectives

### Core Objective
Utvid den eksisterende avvikslista-tabellen (andre fane på avvik.html) med fire nye kolonner per rad - Kunde, Beskrivelse (med Tripletex-fallback), Utført av, og «Se rapport»-knapp - via additiv utvidelse av DEVIATION_SELECT, renderTable og standard-eksporten. Ingen ny fane, ingen ny render-funksjon, ingen ny eksport-parameter.

### Konkrete deliverables
- Read-first-rapport som bekrefter (eller stopper på) 2 stop-conditions
- `src/routes/admin/deviations.js`: utvidet DEVIATION_SELECT + LEFT JOIN service_reports → orders → technicians; 4 nye aliaserte felt appendet på slutten (customerName, orderDescription, tripletexOrderId, performedByName)
- `public/admin/avvik.html`: 4 nye `<th>` i avvikslista-tabellens thead; loading-row colspan oppdatert til 13
- `public/admin/assets/js/avvik.js`: utvidet renderTable med 4 nye `<td>` per rad; empty-state colspan oppdatert til 13; ny ren funksjon `formatOrderDescription(orderDescription, tripletexOrderId)`; «Se rapport»-knapp som kaller `_avvikWorklistSeeReport`
- `src/services/deviationsExport.js`: CSV-headers + rad-mapping utvidet med 4 nye kolonner; PDF-template utvidet med 4 nye felter per card
- Jest unit-test for formatOrderDescription
- Verbatim testoutput levert til Tom-Erik

### Definition of Done
- [ ] `npx jest` passerer (inkl. ny enhetstest)
- [ ] curl `/api/admin/deviations` returnerer de 4 nye feltene
- [ ] Avvikslista i nettleser viser 13 kolonner med korrekt fallback og fungerende «Se rapport»-knapp
- [ ] CSV-eksport inneholder de 4 nye kolonnene på slutten
- [ ] PDF-eksport inneholder de 4 nye feltene per card
- [ ] Arbeidslista er UENDRET (verifisert)
- [ ] Ingen ny fane, ingen renderTableKunde, ingen view=kunde, ingen git-operasjoner
- [ ] Tom-Erik har mottatt diff + testoutput for godkjenning

### Must Have
- Read-first før kode endres - 2 stop-conditions verifisert (multi-tekniker, datafelter)
- 4 nye felt APPENDES på slutten av DEVIATION_SELECT (posisjonsstabilt)
- LEFT JOIN hele veien (deviations → service_reports → orders → technicians) - rader med manglende ledd vises med "—", forsvinner ikke
- Beskrivelse-fallback EKSAKT som ren funksjon (testbar): `orderDescription || (tripletexOrderId ? 'Tripletex #' + tripletexOrderId : null) || '—'`
- "Se rapport"-knapp gjenbruker `_avvikWorklistSeeReport` (avvik.js:318-326), i tabellcelle-stil (ikke kopi av kort-knappstil fra arbeidslista). Bruk tabellens egen knappestil hvis en finnes
- Colspan oppdatert til 13 på loading-row (avvik.html:349) og empty-state (avvik.js:364) - matematisk nødvendig konsekvens av 4 nye kolonner
- 13 totale kolonner (9 eksisterende + 4 nye) - alle Playwright-assertions bruker 13
- Standard-eksporten (CSV og PDF) utvides direkte med de 4 nye feltene; ingen view=kunde-parameter
- Norsk tekst, konsistent med eksisterende terminologi
- Stopp-og-rapporter hvis noen stop-condition utløses
- Verbatim testoutput i sluttrapport til Tom-Erik

### Must NOT Have (Guardrails)
- INGEN tredje fane ("Avviksliste-kunde")
- INGEN ny render-funksjon (`renderTableKunde`) - utvid eksisterende `renderTable`
- INGEN `view=kunde`-eksport-parameter / dobbel eksport-variant
- INGEN nye filtre, sorteringsnøkler eller søk på de nye kolonnene
- INGEN endring av arbeidslista (de fire kolonnene skal IKKE inn der)
- INGEN ny rute, INGEN migrasjon, INGEN nye biblioteker, INGEN ny tenant-flag
- INGEN refaktorering av `renderTable` "for DRY" - utvid den, ikke restrukturer
- INGEN forbedring av eksisterende PDF-mal "mens du er der" (bortsett fra de 4 nye feltene)
- INGEN `parseInt` på VARCHAR-IDer
- INGEN `git add`, `git commit`, `git push` fra executor - Tom-Erik eier ALLE commits
- INGEN antagelser om "hovedtekniker" hvis service_reports har flere teknikere - STOPP og rapporter
- INGEN bygging av "noe fra utenfor scope"
- INGEN ny `<script>`-tag i avvik.html (`_avvikWorklistSeeReport` ligger allerede i avvik.js)

---

## Verification Strategy (MANDATORY)

> Executor-utført QA (agent-QA) brukes som verifikasjon FØR rapport til Tom-Erik. Tom-Erik gjør deretter manuell dev-QA selv. Ingen QA-kriterier som krever Tom-Eriks innsats før rapport.

### Test-beslutning
- **Infrastruktur**: jest 30 + supertest 7 eksisterer
- **Strategi**: Tester etterpå for SELECT-utvidelse, renderTable og eksport; **TDD for formatOrderDescription** (ren funksjon, lett å låse, eneste "logikk" i frontend-endringen)
- **Framework**: jest

### QA-policy
Hver oppgave inkluderer agent-utførte QA-scenarier. Evidens lagres i `.omo/evidence/task-{N}-{slug}.{ext}`.

- **Backend/API**: Bash (curl) mot lokalt kjørende server. Autentiser via eksisterende admin-login (lagre cookie med `curl -c cookies.txt`, gjenbruk med `-b cookies.txt`). Dev-tenant fra `.env`/`src/config/database.js`.
- **DB-seeding**: `psql` mot tenant-DB; seed avvik som dekker NULL-permutasjoner.
- **Frontend/UI**: Playwright - naviger, klikk, assert 13 kolonner og celleinnhold, screenshot. (Tom-Erik gjør i tillegg manuell QA i nettleseren.)
- **Unit**: `npx jest` for formatOrderDescription.
- **Eksport**: curl mot eksport-endepunktet, `head -1` på CSV for å bekrefte 4 nye headers, `pdftotext` for å bekrefte at de 4 nye etikettene finnes i PDF.

---

## Execution Strategy

### Bølger og avhengigheter

```
Wave 1 (start umiddelbart - read-first):
└── Task 1: Read-first verifikasjon - sjekk 2 stop-conditions, STOPP hvis utløst [explore]

Wave 2 (etter Wave 1 har bekreftet grønt):
└── Task 2: Backend - utvid DEVIATION_SELECT med LEFT JOIN-kjede + 4 nye felt + integrasjonstest [unspecified-high]

Wave 3 (etter Wave 2 - frontend og eksport parallelt):
├── Task 3: Frontend - utvid renderTable + thead + colspan, formatOrderDescription (TDD), Se rapport-knapp [visual-engineering]
└── Task 4: Eksport - utvid CSV-headers + rad-mapping og PDF-template med 4 nye felter [unspecified-high]

Wave FINAL (etter ALLE oppgaver - 4 parallelle reviews, så Tom-Eriks godkjenning):
├── F1. Plan compliance audit (oracle)
├── F2. Code quality review (unspecified-high)
├── F3. Real manual QA (unspecified-high + playwright skill)
└── F4. Scope fidelity check (deep)
-> Presenter resultater + diff + testoutput -> Vent på Tom-Eriks eksplisitte godkjenning

Critical path: 1 → 2 → 3 → F1-F4 → Tom-Erik
Max samtidig: 4 (kun i Final-Wave)
```

### Dependency Matrix

- **1 (read-first)**: avh. ingen → blokkerer 2, 3, 4
- **2 (backend SELECT)**: avh. 1 → blokkerer 3, 4
- **3 (frontend)**: avh. 1, 2 → blokkerer ingen
- **4 (eksport)**: avh. 1, 2 → blokkerer ingen

### Agent Dispatch Summary

- **Wave 1**: 1 oppgave - 1 → `explore`
- **Wave 2**: 1 oppgave - 2 → `unspecified-high`
- **Wave 3**: 2 oppgaver - 3 → `visual-engineering`, 4 → `unspecified-high`
- **FINAL**: 4 oppgaver - F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [ ] 1. Read-first verifikasjon - sjekk 2 stop-conditions

  **What to do**:
  - Les og verifiser (fil:linje i rapport):
    1. `src/routes/admin/deviations.js`: DEVIATION_SELECT-konstanten og **ALLE spørringer som bruker den** (Oracle har funnet minst tre: list-handler rundt linje 249-259, detail-handler rundt linje 422, PUT-reload rundt linje 611 - finn alle via `grep -n "DEVIATION_SELECT" src/routes/admin/deviations.js`). For hver: rapporter linjenummer, hva den brukes til, og om den allerede joiner orders/service_reports/technicians (for å unngå dobbel-join i Task 2). Worklist-endepunktet sitt JOIN-mønster (gjenbruk - men har egen SELECT).
    2. `public/admin/assets/js/avvik.js`: `renderTable()` (avvikslista-tabellen, IKKE arbeidslista). Hvordan rader/kolonner bygges. `_avvikWorklistSeeReport` (linje 318-326 ifølge Oracle) - bekreft eksakt signatur og at den er definert i SAMME fil som renderTable.
    3. `public/admin/avvik.html`: avvikslista-tabellens `<thead>` (verifiser at den har 9 `<th>`) og loading-row med `colspan="9"` (linje 349 ifølge Oracle).
    4. Datakilder: `orders.customer_name`, `orders.description`, `orders.tripletex_order_id`, `service_reports.technician_id`, `deviations.opened_in_report_id` - bekreft at alle finnes (planen sier ingen migrasjon nødvendig - verifiser).
    5. `src/services/deviationsExport.js`: hvordan avvikslista eksporteres i dag (CSV linje 6-52, PDF linje 90-212). Bekreft fast kolonneliste (Tom-Eriks beslutning er allerede å utvide direkte) - finn nøyaktig hvor headers er definert (Oracle nevner linje 8) og hvor rad-mapping skjer (Oracle nevner linje 33-47).
  - Sjekk 2 STOP-CONDITIONS og rapporter resultat for hver:
    - (b) Har `service_reports` FLERE teknikere per rapport (junction-tabell eller array), ikke bare én FK-kolonne `technician_id`? Hvis JA → STOPP og spør hvilken tekniker som skal vises.
    - (c) Mangler noen av datafeltene (orders.customer_name, orders.description, orders.tripletex_order_id, service_reports.technician_id, deviations.opened_in_report_id)? Hvis JA → STOPP.
  - (Stop-condition (a) om eksport-kolonneliste er ALLEREDE avklart av Tom-Erik - utvid direkte, ikke stopp.)
  - Lever en strukturert rapport (i `.omo/evidence/task-1-readfirst-report.md`) med:
    - Filer + linjenummer for hvert lest punkt
    - Eksplisitt JA/NEI for hver av de 2 stop-conditions + sitering
    - Hvis BEGGE er NEI: si "PROCEED" og oppsummer hvilke ANTAGELSER Task 2, 3 og 4 kan bygge på (single-tekniker, alle datafelter eksisterer, eksakte linjenumre for senere edits)
    - Hvis NOEN er JA: STOPP, rapporter til Tom-Erik, ikke gå videre

  **Must NOT do**:
  - INGEN kodeendringer i denne oppgaven
  - INGEN antagelser om multi-tekniker eller datafelter uten å verifisere i kode
  - INGEN videre arbeid hvis noen stop-condition er JA

  **Recommended Agent Profile**:
  - **Subagent**: `explore`
    - Reason: Read-only kartlegging av eksisterende kode + datamodell; explore er optimalisert for nettopp dette
  - **Skills**: ingen
  - **Skills evaluated but omitted**: ingen relevante

  **Parallelization**:
  - **Can Run In Parallel**: NEI - Wave 1 alene
  - **Blocks**: 2, 3, 4
  - **Blocked By**: ingen

  **References**:
  - `src/routes/admin/deviations.js:52-71, 249-259, 278-400` - DEVIATION_SELECT, list-query, worklist-JOIN-mønster
  - `public/admin/assets/js/avvik.js:318-326, 362-380` - `_avvikWorklistSeeReport`, renderTable
  - `public/admin/avvik.html:337-345, 349` - thead, loading-row colspan
  - `src/services/deviationsExport.js:6-52, 90-212` - CSV og PDF
  - `migrations/000-base-schema.sql:252-280` - orders-tabellen (customer_name, description, tripletex_order_id)
  - `scripts/migrations/2026-05-deviations-foundation.js:43-66` - deviations-tabellen (opened_in_report_id)

  **Acceptance Criteria**:
  - [ ] `.omo/evidence/task-1-readfirst-report.md` eksisterer og inneholder fil:linje-siteringer for alle 5 read-punktene + `_avvikWorklistSeeReport`-signatur
  - [ ] **STOP-CONDITION (b) eksplisitt besvart**: Rapporten siterer konkret DB-schema eller migrations-fil og bekrefter med fil:linje at `service_reports` har EN enkelt FK-kolonne `technician_id` (ikke junction-tabell, ikke array) — eller sier STOPP.
  - [ ] **STOP-CONDITION (c) eksplisitt besvart**: Rapporten bekrefter at ALLE fem felter eksisterer i schema med fil:linje-sitering: `orders.customer_name`, `orders.description`, `orders.tripletex_order_id`, `service_reports.technician_id`, `deviations.opened_in_report_id` — ingen migrasjon nødvendig. Eller sier STOPP.
  - [ ] Eksplisitt PROCEED- eller STOPP-anbefaling
  - [ ] Faktiske linjenumre for alle senere edits (DEVIATION_SELECT, alle spørringer som bruker den, thead, renderTable, loading-row colspan, empty-state colspan, CSV-headers, CSV-rad-mapping, PDF-template-felter)

  **QA Scenarios**:
  ```
  Scenario: Rapporten er komplett og siterer kode
    Tool: Bash (grep)
    Preconditions: Task 1 ferdig, rapport skrevet
    Steps:
      1. test -f .omo/evidence/task-1-readfirst-report.md → exit 0
      2. grep -c "deviations.js:" .omo/evidence/task-1-readfirst-report.md → ≥ 2
      3. grep -c "deviationsExport.js" .omo/evidence/task-1-readfirst-report.md → ≥ 1
      4. grep -c "_avvikWorklistSeeReport" .omo/evidence/task-1-readfirst-report.md → ≥ 1
      5. grep -cE "STOP-CONDITION|stop-condition" .omo/evidence/task-1-readfirst-report.md → ≥ 2
      6. grep -E "PROCEED|STOPP" .omo/evidence/task-1-readfirst-report.md → minst én treff
    Expected Result: Rapport eksisterer, siterer alle nødvendige filer, dekker begge stop-conditions, har klar konklusjon
    Failure Indicators: Manglende fil, manglende siteringer, ingen tydelig konklusjon
    Evidence: rapportfilen er selv evidensen
  ```

  **Commit**: NEI - Tom-Erik eier alle commits

- [ ] 2. Backend - utvid DEVIATION_SELECT med LEFT JOIN-kjede + 4 nye felt + integrasjonstest

  **What to do** (KUN hvis Task 1 sa PROCEED):
  - I `src/routes/admin/deviations.js`: APPEND 4 nye aliaserte felt på slutten av `DEVIATION_SELECT` (rundt linje 52-71, bruk Task 1-bekreftede linjenumre), posisjonsstabilt:
    ```sql
    o.customer_name         AS "customerName",
    o.description           AS "orderDescription",
    o.tripletex_order_id    AS "tripletexOrderId",
    perf_t.name             AS "performedByName"
    ```
  - **KRITISK**: `DEVIATION_SELECT` brukes i FLERE spørringer (Task 1 må kartlegge alle via `grep -n "DEVIATION_SELECT" src/routes/admin/deviations.js`). Oracle har funnet minst fire usages: list-handler (~linje 249-259), detail-handler (~linje 422), PUT-reload (~linje 611), OG eksport-handler (~linje 137-142). Når SELECT-konstanten utvides med `o.*` og `perf_t.*`, MÅ ALLE spørringer som bruker den få de samme LEFT JOIN-ene, ellers krasjer de med "missing alias"-feil.
  - Legg til SAMME LEFT JOIN-kjede i ALLE spørringer som bruker DEVIATION_SELECT (inkludert eksport-handlerens spørring):
    ```sql
    LEFT JOIN service_reports sr ON sr.id = d.opened_in_report_id
    LEFT JOIN orders o ON o.id = sr.order_id
    LEFT JOIN technicians perf_t ON perf_t.id = o.technician_id
    ```
    **NB (T1-funn):** `service_reports` har ingen `technician_id`. Teknikeren hentes via `orders.technician_id` (Tom-Erik bekreftet). Alias `perf_t` for å unngå kollisjon med eksisterende `t` (tildelt tekniker). Hvis noen spørring allerede joiner orders (f.eks. via eksisterende alias), bruk SAMME alias for å unngå dobbel-join.
  - **Ansvarsdeling mellom Task 2 og Task 4**:
    - **Task 2 (denne)**: SQL-laget - eier ALLE JOIN-utvidelser, inkludert i eksport-handlerens spørring. Etter Task 2 returnerer eksport-handlerens DATAHENTING de 4 nye feltene per rad (de er bare ikke brukt av CSV/PDF-formatet ennå).
    - **Task 4**: Format-laget - eier CSV-headers + rad-mapping + PDF-template. Bruker feltene som Task 2 allerede har gjort tilgjengelige. Rører IKKE SELECT eller JOIN i deviations.js.
  - LEFT JOIN HELE veien (ikke INNER) - rader med manglende ledd skal returneres med NULL.
  - INGEN endring av WHERE, ORDER BY, LIMIT, OFFSET, paging eller PUT-business-logikk - kun additive JOIN-er + ny SELECT-konstant.
  - Worklist-endepunktet (linje 278-400) bruker IKKE DEVIATION_SELECT - har egen SELECT med egne joins. La det være urørt.
  - Legg til supertest-integrasjonstest (følg eksisterende test-konvensjon i repoet - lokaliser via `grep -r "supertest" src/`):
    - Seed 5 avvik som dekker NULL-permutasjoner: (A) full kjede, (B) `opened_in_report_id` NULL, (C) rapport finnes men `service_reports.technician_id` NULL, (D) `orders.description` NULL men `tripletex_order_id` populert, (E) begge NULL
    - Kall `GET /api/admin/deviations` (list), assert at responsen inkluderer alle 4 nye nøkler, NULL-permutasjoner riktig
    - Kall `GET /api/admin/deviations/<id>` (detail) for rad A, assert at responsen ALSO inkluderer de 4 nye nøklene (siden vi delte SELECT) OG fortsatt returnerer alt det gjorde før (regresjon)
    - Trigger PUT-reload (kall en PUT som returnerer ferdig-oppdatert deviation), assert at responsen inkluderer de 4 nye nøklene OG eksisterende felter intakt
    - Smoke-test eksport-endepunktet (curl med format=csv): forventet at endepunktet IKKE krasjer etter Task 2 sin JOIN-utvidelse (CSV-INNHOLDET endres ikke før Task 4)
    - REGRESJON: assert at eksisterende feltsett er bevart i ALLE tre responstyper (superset-relasjon, ingen renames/fjerninger)
  - Verifiser at worklist-endepunktet fortsatt fungerer (egen SELECT - vi rører det ikke, men regresjonsverifiserbart)

  **Must NOT do**:
  - INGEN INNER JOIN noen steder (ville skjult rader med manglende ledd)
  - INGEN endring av eksisterende feltrekkefølge i DEVIATION_SELECT (append-only)
  - INGEN endring av worklist-endepunktet (har egen SELECT)
  - INGEN endring av eksport-handlerens CSV-bygger eller PDF-template (Task 4 eier det) - KUN den SQL-spørringen som bruker DEVIATION_SELECT får JOIN-utvidelse i denne oppgaven
  - INGEN endring av WHERE, ORDER BY, LIMIT, OFFSET, paging eller PUT-business-logikk - kun tillegg av JOIN-er og nye SELECT-felter
  - INGEN nye query-parametere på list-endepunktet eller eksport-endepunktet
  - INGEN refaktorering av list-handleren, detail-handleren, PUT-handleren eller eksport-handlerens kontroll-flyt
  - INGEN `parseInt` på VARCHAR-IDer
  - INGEN `git add/commit/push`

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Berører deviations-list-query (ordre-livssyklus er high-risk per repo-regler); krever omhyggelig append-only-redigering + regresjonssikrende test
  - **Skills**: ingen
  - **Skills evaluated but omitted**: ingen relevante

  **Parallelization**:
  - **Can Run In Parallel**: NEI - Wave 2 alene
  - **Blocks**: 3, 4
  - **Blocked By**: 1

  **References**:
  - `src/routes/admin/deviations.js:52-71` - DEVIATION_SELECT (APPEND her)
  - `src/routes/admin/deviations.js:249-259` - list-query (LEFT JOIN her)
  - `src/routes/admin/deviations.js:278-400` - worklist-endepunkt, allerede joiner `orders` for `customer_name`/`description` (linje 310-311) - kopier JOIN-shape
  - Task 1-rapporten - faktiske linjenumre kan ha forskjøvet seg; bruk verifiserte
  - Repoets eksisterende supertest-filer - bootstrap/auth/DB-setup-konvensjoner

  **Acceptance Criteria**:
  - [ ] `git diff src/routes/admin/deviations.js` viser KUN: 4 linjer appendet i DEVIATION_SELECT + 3 LEFT JOIN-linjer i HVER spørring som bruker DEVIATION_SELECT (Task 1-kartlagt antall - minst 4 spørringer: list + detail + PUT-reload + eksport-handler = 4 × 3 = 12 join-linjer totalt). Ingen andre redigeringer.
  - [ ] curl `GET /api/admin/deviations/<id>` (detail) → 200, response inkluderer de 4 nye nøklene OG alle pre-change-felter (regresjon)
  - [ ] curl `PUT /api/admin/deviations/<id>` med gyldig body → 200, response inkluderer de 4 nye nøklene OG alle pre-change-felter (regresjon)
  - [ ] curl `GET /api/admin/deviations/export?format=csv` → 200, IKKE 500/crash (smoke-test: eksport-handler skal ikke krasje etter JOIN-utvidelse, selv om CSV-FORMATET ikke endres før Task 4)
  - [ ] curl `GET /api/admin/deviations/export?format=pdf` → 200, IKKE 500/crash (samme smoke-test for PDF-eksport)
  - [ ] `npx jest <ny test-fil>` → ≥ 5 assertions, alle passerer
  - [ ] `npx jest` full suite → 0 feil (regresjonsfri)
  - [ ] curl `/api/admin/deviations` mot seedet dev-tenant: respons inkluderer de 4 nye nøklene; rad A populert, rad B alle NULL

  **QA Scenarios**:
  ```
  Scenario: Endepunktet returnerer 4 nye felt med korrekt NULL-håndtering
    Tool: Bash (psql + curl + jq)
    Preconditions: Server kjører, admin-session-cookie (cookies.txt), dev-tenant, 5 avvik seedet for NULL-permutasjoner A-E
    Steps:
      1. Seed via psql (eller eksisterende test-fixture)
      2. curl -s -b cookies.txt http://localhost:<port>/api/admin/deviations | jq '.items | map(select(.id == <A-id>))[0] | {customerName, orderDescription, tripletexOrderId, performedByName}'
      3. Assert alle 4 felt non-null for A
      4. Gjenta jq for B → alle 4 felt null
      5. Gjenta for C → performedByName null, andre populert
      6. Gjenta for D → orderDescription null, tripletexOrderId populert
      7. Gjenta for E → orderDescription null OG tripletexOrderId null
    Expected Result: Hver rad reflekterer dokumentert NULL-permutasjon
    Failure Indicators: Manglende feltnøkkel, feil null/populert celle
    Evidence: .omo/evidence/task-2-null-permutations.txt

  Scenario: Eksisterende feltsett bevart (regresjon)
    Tool: Bash (curl + jq + diff)
    Steps:
      1. Pre-change snapshot (fra git eller dokumenterte baseline-nøkler)
      2. curl -s -b cookies.txt http://localhost:<port>/api/admin/deviations | jq '.items[0] | keys' > after.json
      3. Bekreft superset: alle pre-change-nøkler fortsatt til stede, kun 4 nye lagt til
    Expected Result: Superset-relasjon holder
    Evidence: .omo/evidence/task-2-key-superset.txt

  Scenario: Full jest grønn
    Tool: Bash
    Steps:
      1. npx jest --verbose
    Expected Result: 0 feil
    Evidence: .omo/evidence/task-2-jest-output.txt
  ```

  **Commit**: NEI - Tom-Erik eier alle commits. Rapporter `git diff src/routes/admin/deviations.js` + testoutput.

- [ ] 3. Frontend - utvid renderTable + thead + colspan, formatOrderDescription (TDD), Se rapport-knapp

  **What to do**:
  - I `public/admin/avvik.html` (avvikslista-tabellens `<thead>`, Task 1-verifisert lokasjon rundt linje 337-345): APPEND 4 nye `<th>` på slutten med norske etiketter: `<th>Kunde</th>`, `<th>Beskrivelse</th>`, `<th>Utført av</th>`, `<th>Rapport</th>`.
  - I `public/admin/avvik.html` (loading-row rundt linje 349): oppdater `colspan="9"` til `colspan="13"`. Matematisk nødvendig fordi vi går fra 9 til 13 kolonner.
  - I `public/admin/assets/js/avvik.js`:
    - **3a. `formatOrderDescription(orderDescription, tripletexOrderId)` (TDD: skriv test FØRST, RED, så implementer til GREEN)**:
      ```js
      function formatOrderDescription(orderDescription, tripletexOrderId) {
        return orderDescription
          || (tripletexOrderId ? 'Tripletex #' + tripletexOrderId : null)
          || '—';
      }
      ```
      Gjør den testbar UTEN å introdusere en ny `<script>`-tag (det er forbudt). Bruk `module.exports`-mønster guardet av `typeof module !== 'undefined' && module.exports`, slik at funksjonen kan kreves fra jest-test uten å påvirke browser-kjøring. Hvis dette mønsteret ikke finnes i repoet fra før (verifiser i Task 1), bruk samme pattern andre testbare browser-hjelpere bruker - aldri en ny script-tag.
      Test-matrise (alle som assertions):
      | orderDescription | tripletexOrderId | expected |
      |---|---|---|
      | 'Vannlekkasje kjøkken' | 12345 | 'Vannlekkasje kjøkken' |
      | null | 12345 | 'Tripletex #12345' |
      | '' | 12345 | 'Tripletex #12345' |
      | null | null | '—' |
      | '' | null | '—' |
      | undefined | undefined | '—' |
      | 'desc' | null | 'desc' |
    - **3b. Utvid eksisterende `renderTable` (rundt linje 362-380 - IKKE refaktorer, IKKE lag ny funksjon)**:
      - Oppdater `colspan="9"` til `colspan="13"` i empty-state-rad (rundt linje 364)
      - Append 4 nye `<td>` på slutten av hver datarad:
        ```html
        <td>${escHtml(d.customerName || '—')}</td>
        <td>${escHtml(formatOrderDescription(d.orderDescription, d.tripletexOrderId))}</td>
        <td>${escHtml(d.performedByName || '—')}</td>
        <td>${reportButtonHtml(d.openedInReportId)}</td>
        ```
    - **3c. "Se rapport"-knapp via `_avvikWorklistSeeReport`-gjenbruk**:
      - Liten hjelpefunksjon `reportButtonHtml(reportId)` som returnerer en knapp i TABELLCELLE-STIL (ikke kort-stil fra arbeidslista). Bruk eksisterende tabellens knappestil hvis en finnes (verifisert i Task 1)
      - Onclick: bruk EKSAKT SAMME kalleform som arbeidslista bruker på linje 247-264 (Oracle bekreftet at funksjonen forventer en encodet JSON-array-streng, IKKE en naken reportId). Task 1 MÅ dokumentere eksakt signatur og kalleform; Task 3 bruker den verifiserte formen. Eksempel-skjelett (verifiser mot Task 1-rapport): `window._avvikWorklistSeeReport(encodeURIComponent(JSON.stringify([reportId])))` eller hva Task 1 fant
      - Hvis `reportId` mangler/null: render `—` i stedet for knapp
      - Bruk `data-` attributter eller event delegation hvis det matcher repoets mønster - ellers direkte onclick som i arbeidslista
  - Eksisterende `renderTable` skal forbli funksjonelt uendret bortsett fra:
    - colspan-oppdatering i empty-state (matematisk nødvendig)
    - 4 nye `<td>` per rad på slutten av rad-templaten
    Ingen restrukturering, ingen utvinning til ny funksjon.

  **Must NOT do**:
  - INGEN ny render-funksjon (`renderTableKunde` eller lignende)
  - INGEN refaktorering av `renderTable` "for DRY"
  - INGEN endring av eksisterende kolonner eller deres rekkefølge
  - INGEN endring av arbeidslista (de 4 nye kolonnene skal IKKE inn der)
  - INGEN kopiering av kort-knappstil fra arbeidslista - bruk tabellens egen knappestil
  - INGEN tredje fane, ingen view=kunde-eksport
  - INGEN nye filtre, sorteringsnøkler eller søk
  - INGEN inline-konkatenering av Tripletex-fallback (må gå via `formatOrderDescription`)
  - INGEN ny `<script>`-tag for å laste annen JS - `_avvikWorklistSeeReport` ligger allerede i avvik.js
  - INGEN `git add/commit/push`

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Frontend-utvidelse med TDD på ren hjelper og disiplinert ikke-refaktor-tilnærming
  - **Skills**: [`playwright`]
    - `playwright`: nødvendig for å QA den utvidede tabellen med seedet NULL-permutasjoner i nettleser
  - **Skills evaluated but omitted**: ingen relevante

  **Parallelization**:
  - **Can Run In Parallel**: YES - Wave 3 (parallelt med Task 4)
  - **Blocks**: ingen
  - **Blocked By**: 1, 2

  **References**:
  - `public/admin/avvik.html:337-345, 349` - thead + loading-row (verifisert i Task 1)
  - `public/admin/assets/js/avvik.js:362-380` - eksisterende renderTable (UTVID, ikke refaktorer)
  - `public/admin/assets/js/avvik.js:364` - empty-state colspan (oppdater)
  - `public/admin/assets/js/avvik.js:318-326` - `_avvikWorklistSeeReport` - gjenbruk; bekreft eksakt signatur i Task 1
  - Tabellens eksisterende knappestil (fra Task 1) - gjenbruk
  - Eksisterende `module.exports`/test-mønster i repoet (fra Task 1) - følg for testbarhet

  **Acceptance Criteria**:
  - [ ] `npx jest formatOrderDescription` → alle 7 cases passerer
  - [ ] `git diff public/admin/assets/js/avvik.js` viser KUN: ny `formatOrderDescription`-funksjon + ny `reportButtonHtml`-hjelper + 4 nye `<td>`-linjer i renderTable-rad-templaten + colspan `9` → `13` i empty-state. Ingen andre endringer.
  - [ ] `git diff public/admin/avvik.html` viser KUN: 4 nye `<th>` i avvikslista-tabellens thead + colspan `9` → `13` i loading-row
  - [ ] I nettleser: avvikslista viser 13 kolonner med korrekt fallback per rad; klikk på "Se rapport" åpner samme PDF-visning som arbeidslista
  - [ ] Arbeidslista uendret (verifisert ved å bytte fane og telle/sammenligne)

  **QA Scenarios**:
  ```
  Scenario: TDD-hjelper grønn med alle 7 cases
    Tool: Bash
    Steps:
      1. npx jest formatOrderDescription --verbose
      2. Assert 7 passed, 0 failed
    Expected Result: Alle dokumenterte inputs gir forventet output
    Failure Indicators: Hvilken som helst case feiler (særlig '' vs null)
    Evidence: .omo/evidence/task-3-jest-helper.txt

  Scenario: 13 kolonner og rader reflekterer fallback-kjeden + Se rapport-knapp fungerer
    Tool: Playwright
    Preconditions: Seedet avvik fra Task 2 (rader A-E)
    Steps:
      1. Naviger til avvik.html, klikk Avviksliste-fanen
      2. Tell `thead th` i avvikslista-tabellen → assert 13
      3. Tell `tbody tr:first-child td` i en datarad → assert 13
      4. Lokaliser rad A → assert 'Beskrivelse'-celle = seedet orderDescription
      5. Rad D → assert celle = 'Tripletex #' + seedet tripletexOrderId
      6. Rad E → assert celle = '—'
      7. Rad B (ingen rapport) → assert alle 3 nye datakolonner viser '—', og 'Rapport'-celle viser '—' (ingen knapp)
      8. Rad A → klikk 'Se rapport'-knapp → assert samme PDF-visning som arbeidslista åpnes
      9. Screenshot
    Expected Result: 13 kolonner, fallback synlig og korrekt, rapport-knapp fungerer
    Evidence: .omo/evidence/task-3-frontend.png + .txt

  Scenario: Eksisterende renderTable utvidet, ikke restrukturert (regresjon)
    Tool: Bash (git diff)
    Steps:
      1. git diff public/admin/assets/js/avvik.js | grep -E "^-" | grep -v "^---" | grep -vE "^-\s*$" | grep -v "colspan=\"9\"" → tomt (eneste fjernede ikke-blanke linjer skal være colspan-oppdateringen)
      2. Bekreft at original 9 td-elementer fortsatt er på plass i diffen før de 4 nye
    Expected Result: Rene tillegg + colspan-oppdatering, ingen refaktorering
    Evidence: .omo/evidence/task-3-additive-diff.txt

  Scenario: Arbeidslista uendret
    Tool: Playwright
    Steps:
      1. Klikk Arbeidslista-fanen
      2. Tell kolonner/rader, sammenlign med pre-change-baseline
      3. Bekreft ingen nye Kunde/Beskrivelse/Utført av/Rapport-kolonner
    Expected Result: Identisk med før
    Evidence: .omo/evidence/task-3-arbeidsliste-uendret.png
  ```

  **Commit**: NEI - Tom-Erik eier alle commits. Rapporter `git diff` for avvik.js + avvik.html + ny testfil + verbatim testoutput.

- [ ] 4. Eksport - utvid CSV-headers + rad-mapping og PDF-template med 4 nye felter

  **What to do**:
  - I `src/services/deviationsExport.js`:
    - **CSV (linje 6-52)**:
      - Append 4 nye headers på slutten av eksisterende headers-array (rundt linje 8 ifølge Oracle): `'Kunde'`, `'Beskrivelse'`, `'Utført av'`, `'Tripletex prosjektnr'`. (Tripletex prosjektnr som egen kolonne - lettere for Excel-bruk enn fallback-streng. Beskrivelse-kolonnen får bare faktisk beskrivelse, ikke fallback-streng. Dette gir admin mulighet til å sortere/filtrere på rene verdier i Excel.)
      - Append tilsvarende rad-mapping på slutten av rad-bygger-blokken (rundt linje 33-47): `customerName || ''`, `orderDescription || ''`, `performedByName || ''`, `tripletexOrderId || ''`
      - Bruk eksisterende escape-funksjon for komma/anførselstegn/linjeskift (samme behandling som de andre tekstfeltene)
      - Bevar UTF-8 BOM og eksisterende linjeskill-format
    - **PDF (linje 90-212)**:
      - Append 4 nye felter per deviation-card. Plasser dem i card-headerens meta-seksjon (eller der det passer i eksisterende layout - verifiser i Task 1):
        - "Kunde: ${customerName || '—'}"
        - "Beskrivelse: ${formatOrderDescription-ekvivalent (inline, samme uttrykk som frontend) || '—'}"
        - "Utført av: ${performedByName || '—'}"
        - "Tripletex prosjektnr: ${tripletexOrderId || '—'}"
      - Bevar Puppeteer-options, fonts, header, footer
      - Hvis card-layouten ikke har plass: utvid card-høyden minimalt, IKKE bytt orientering eller endre eksisterende felter
    - Eksport-handlerens SQL-spørring fikk JOIN-utvidelse i Task 2 (ansvarsdeling: Task 2 eier SQL/JOIN-laget, Task 4 eier CSV/PDF-formatet). De 4 nye feltene er allerede i resultatsettet etter Task 2. Task 4 trenger IKKE å røre SQL eller JOIN-er i deviations.js - kun CSV- og PDF-format-koden i deviationsExport.js.
  - INGEN restrukturering av PDF-templaten, ingen ny stilark, ingen logo-/branding-endring
  - INGEN view=kunde-parameter eller noen ny query-string-parameter

  **Must NOT do**:
  - INGEN ny eksport-endepunkt
  - INGEN view=kunde-parameter eller annen ny query-string
  - INGEN endring av CSV-separator (behold komma hvis komma, semikolon hvis semikolon)
  - INGEN endring av BOM, line endings eller escape-oppførsel
  - INGEN endring av rekkefølgen på eksisterende CSV-kolonner eller PDF-felter
  - INGEN grupperer i CSV eller PDF (ingen "etter kunde"-sortering)
  - INGEN forbedring av eksisterende PDF-template (kun additivt)
  - INGEN biblioteks-tillegg
  - INGEN `git add/commit/push`

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: PDF-generering er designert high-risk-område (per repo-regler); krever presis additiv redigering
  - **Skills**: ingen
  - **Skills evaluated but omitted**: ingen relevante

  **Parallelization**:
  - **Can Run In Parallel**: YES - Wave 3 (parallelt med Task 3)
  - **Blocks**: ingen
  - **Blocked By**: 1, 2

  **References**:
  - `src/services/deviationsExport.js:6-52` - CSV-bygger (headers + rad-mapping)
  - `src/services/deviationsExport.js:90-212` - PDF Puppeteer-template
  - Task 1-rapporten - bekrefter om eksporten gjenbruker DEVIATION_SELECT eller har egen spørring
  - Task 2 - DEVIATION_SELECT-utvidelsen som eksporten arver fra (hvis felles spørring)

  **Acceptance Criteria**:
  - [ ] curl CSV-eksport: header-linjen ender med ",Kunde,Beskrivelse,Utført av,Tripletex prosjektnr" (eller hvilken eksakt rekkefølge som velges, lokket her)
  - [ ] curl CSV-eksport: en rad med seedet kundenavn-med-komma ("Acme, Inc") er korrekt escapet (omgitt av anførselstegn)
  - [ ] curl CSV-eksport: UTF-8 BOM bevart
  - [ ] curl PDF-eksport: `pdftotext` finner alle 4 etiketter: "Kunde:", "Beskrivelse:", "Utført av:", "Tripletex prosjektnr:"
  - [ ] curl PDF-eksport: seedet kundenavn forekommer i tekst-output
  - [ ] `git diff package.json` viser ingen dep-endringer

  **QA Scenarios**:
  ```
  Scenario: CSV inneholder 4 nye kolonner med korrekt escape
    Tool: Bash (curl + head + grep)
    Preconditions: Server kjører, session-cookie, seedet kunde "Acme, Inc" med komma + tilhørende avvik
    Steps:
      1. curl -s -b cookies.txt 'http://localhost:<port>/api/admin/deviations/export?format=csv' -o out.csv
      2. head -1 out.csv → ender med ",Kunde,Beskrivelse,Utført av,Tripletex prosjektnr"
      3. head -c 3 out.csv | xxd | grep efbbbf → BOM bevart
      4. grep '"Acme, Inc"' out.csv → matcher (komma korrekt escapet)
    Expected Result: Headers korrekte, escape bevart, BOM intakt
    Failure Indicators: Manglende header, manglende escape, manglende BOM
    Evidence: .omo/evidence/task-4-csv.txt

  Scenario: PDF inneholder de 4 nye etikettene + seedet data
    Tool: Bash (curl + pdftotext)
    Steps:
      1. curl -s -b cookies.txt 'http://localhost:<port>/api/admin/deviations/export?format=pdf' -o out.pdf
      2. file out.pdf | grep -q 'PDF document'
      3. pdftotext out.pdf - > out.txt
      4. grep -q 'Kunde:' out.txt && grep -q 'Beskrivelse:' out.txt && grep -q 'Utført av:' out.txt && grep -q 'Tripletex prosjektnr:' out.txt
      5. grep -q '<seedet kundenavn>' out.txt
    Expected Result: Alle etiketter + seedet data
    Evidence: .omo/evidence/task-4-pdf.txt

  Scenario: Ingen nye dependencies (regresjon)
    Tool: Bash
    Steps:
      1. git diff package.json → tomt eller kun ikke-dep-relatert
    Expected Result: Ingen biblioteks-tillegg
    Evidence: .omo/evidence/task-4-no-deps.txt
  ```

  **Commit**: NEI - Tom-Erik eier alle commits. Rapporter `git diff src/services/deviationsExport.js` + curl-output + pdftotext-output.

---

## Final Verification Wave (MANDATORY - etter ALLE implementasjonsoppgaver)

> 4 review-agenter kjører PARALLELT. ALLE må APPROVE. Presenter konsolidert resultat + diff + testoutput til Tom-Erik og vent på eksplisitt godkjenning. Tom-Erik gjør egen manuell dev-QA etter dette.
> IKKE auto-proceed. ALDRI markér F1-F4 som ferdige før Tom-Erik har gitt OK.

- [ ] F1. **Plan Compliance Audit** - `oracle`
  Les denne planen end-to-end. For hver "Must Have": verifiser at implementasjonen eksisterer (les fil, curl endpoint, kjør kommando). For hver "Must NOT Have": søk kodebasen for forbudte mønstre - reject med fil:linje hvis funnet. Spesifikt sjekk: ingen renderTableKunde-funksjon eksisterer, ingen tredje fane-knapp, ingen view=kunde-parameter, ingen endring av arbeidslista, ingen nye filtre/sortering, ingen nye filer under `migrations/`, ingen nye package.json-deps, ingen `git add/commit` fra executor (verifiser via `git log` - skal ikke ha nye commits utenom Tom-Eriks). Sjekk at evidensfiler eksisterer i `.omo/evidence/`. Bekreft kolonneantall = 13 i thead/colspan/Playwright-assertions. Sammenlign deliverables mot plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** - `unspecified-high`
  Kjør `npx jest` (full suite). Gjennomgå endrede filer for: tomme catches, console.log i prod-stier, kommentert kode, ubrukte requires, SQL-injection-risk (strenginterpolert SQL i stedet for $1), manglende tenant-scoping, parseInt på VARCHAR-IDer. Sjekk AI-slop: overdrevne kommentarer, over-abstraksjon, generiske navn. Verifiser at `renderTable` IKKE er restrukturert (kun colspan-oppdatering + appendet 4 td). Verifiser at DEVIATION_SELECT-tillegg er appendet på slutten. Verifiser at "Se rapport"-knapp bruker `_avvikWorklistSeeReport` (ikke viewOrderPDFs) og tabellcelle-stil.
  **Spesifikt for formatOrderDescription**: verifiser at unit-testene dekker EKSAKT disse tre tilfellene med verbatim assertion-output: (1) `orderDescription` finnes → returnerer `orderDescription` direkte, (2) `orderDescription` er null/'' men `tripletexOrderId` finnes → returnerer `'Tripletex #' + tripletexOrderId` (IKKE `'Tripletex #null'`), (3) begge mangler → returnerer `'—'`. Inkluder verbatim `npx jest formatOrderDescription --verbose` output i evidens.
  Output: `Tests [N pass/N fail] | formatOrderDescription [3/3 cases] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** - `unspecified-high` (+ `playwright` skill)
  Start server fra ren state. Seed dev-tenant med 5 avvik som dekker NULL-permutasjonene (A: full kjede, B: ingen rapport, C: ingen tekniker, D: ingen description men tripletex_order_id, E: verken-eller). Via Playwright: åpne avvik.html, klikk Avviksliste-fanen, verifiser 13 kolonner (9 eksisterende + 4 nye), verifiser at de seedede NULL-permutasjons-radene renderes korrekt — SPESIFIKT: rad D må vise 'Tripletex #\<id\>' (IKKE 'Tripletex #null'), rad E må vise '—', rad A må vise faktisk ordrebeskrivelse. Klikk "Se rapport"-knapp på rad A og bekreft PDF-visning åpnes. Klikk Arbeidslista-fanen og bekreft URØRT.
  **Eksport-verifisering (begge formater obligatorisk)**:
  - CSV: curl `?format=csv` → 200, head -1 viser 4 nye header-kolonner på slutten, minst én datared bekrefter faktisk innhold (kundenavn, beskrivelse/fallback). Lagre CSV til `.omo/evidence/final-qa/export.csv`.
  - PDF: curl `?format=pdf` → 200, `pdftotext` bekrefter at alle 4 etiketter forekommer (`Kunde:`, `Beskrivelse:`, `Utført av:`, `Tripletex prosjektnr:`), og at seedet kundenavn forekommer i teksten. Lagre PDF-tekst til `.omo/evidence/final-qa/export-pdf.txt`.
  Lagre screenshots til `.omo/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | CSV [OK/FAIL] | PDF [OK/FAIL] | formatOrderDescription fallback [3/3] | VERDICT`

- [ ] F4. **Scope Fidelity Check** - `deep`
  For hver oppgave: les "What to do", les faktisk diff (`git diff` mot pre-change baseline). Verifiser 1:1 - alt i spec ble bygget, ingenting utover spec ble bygget. Søk diffen for de forbudte mønstrene: nye filter-dropdowns, nye sortering-nøkler, ny render-funksjon, view=kunde-param, endringer i arbeidslista-render, ny eksport-variant, nye package.json-deps, `git commit` fra executor, parseInt på VARCHAR, ny `<script>`-tag i avvik.html. Bekreft at colspan-oppdatering er den ENESTE ikke-tillegg-endringen (alt annet skal være tillegg). Oppdage cross-task-kontaminasjon.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

> **TOM-ERIK EIER ALLE COMMITS.** Executor må IKKE kjøre `git add`, `git commit` eller `git push`. Etter at alle oppgaver er ferdige og F1-F4 har APPROVE, lever rapport med:
> - `git status --short` (viser alle endrede filer)
> - `git diff` per fil (eller `git diff --stat` + relevante uthevinger)
> - Verbatim testoutput fra `npx jest`
> - QA-scenario-evidens (screenshots, curl-output, pdftotext-output)
>
> Tom-Erik beslutter commit-grupperinger og kjører `git add` + `git commit` selv.

---

## Success Criteria

### Verifikasjonskommandoer
```bash
# Kjøres av executor før rapport
npx jest                                                          # forventet: 0 feil
curl -s -b cookies.txt http://localhost:<port>/api/admin/deviations | jq '.items[0] | keys' | grep -cE 'customerName|orderDescription|tripletexOrderId|performedByName'   # forventet: 4
curl -s -b cookies.txt 'http://localhost:<port>/api/admin/deviations/export?format=csv' | head -1 | grep -E ',Kunde,.*,Tripletex prosjektnr$'   # forventet: match
git status --short                                                # forventet: avvik.js + avvik.html + deviations.js + deviationsExport.js + ny test-fil
git log --oneline -5                                              # forventet: ingen commits fra denne sesjonen (Tom-Erik eier commits)
```

### Sluttsjekkliste (fra brukerinstruks §7, oppdatert med Oracle-funn)
- [ ] SELECT utvidet med customerName, orderDescription, tripletexOrderId, performedByName (LEFT JOIN, appendet)
- [ ] Avvikslista-tabellen har fire nye kolonner: Kunde, Beskrivelse, Utført av, Se rapport (total 13)
- [ ] Colspan oppdatert til 13 på loading-row og empty-state
- [ ] Beskrivelse-fallback er en ren funksjon (description → Tripletex # → "—"), ingen "Tripletex #null"
- [ ] "Utført av" viser tekniker fra service_reports, "—" ved mangel
- [ ] "Se rapport"-knapp gjenbruker `_avvikWorklistSeeReport` (samme fil, ingen ny script-tag), plassert som tabellcelle
- [ ] Eksport (CSV + PDF) utvidet direkte med 4 nye kolonner/felter; ingen view=kunde-parameter
- [ ] Arbeidslista URØRT. Ingen tredje fane. Ingen ny render-funksjon. Ingen view=kunde
- [ ] Ingen migrasjon, ny rute, nytt bibliotek, parseInt på VARCHAR, ny script-tag
- [ ] Verbatim testoutput levert
- [ ] F1-F4 alle APPROVE
- [ ] Tom-Erik har eksplisitt godkjent
