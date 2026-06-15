# v1.2 Avvik til omsetning — livsløp + sendt-knapp + design

## TL;DR

> **Quick Summary**: Rydd avviks-livsløpet mot tilbuds-livsløpet (A), legg til konsistent "marker som sendt"-vei i tilbudsmodalen (C1+C2), og gjør tre forsiktige design-grep i arbeidslista (C3) — alt uten redesign og uten nye farger/fonter.
>
> **Deliverables**:
> - Worklist filtrerer ut sendte tilbud på `quotes.sent_to_customer = true` (autoritativ kolonne, ikke status-streng)
> - Toggle "Vis også sendte" (én knapp, ikke filtersystem)
> - Triage-knapper deaktivert per avvik når `quote_id` finnes
> - Nytt endepunkt `POST /api/quotes/:quoteId/mark-as-sent` (3 felter, uten e-post/PDF)
> - "Sendt" fjernet fra fri status-dropdown + status-felt skjult i modal når quote er sendt
> - Venstre statusstripe på worklist-kort (gjenbrukte farger)
> - Tydeligere kunde+prosjekt-hierarki (kun font-weight, ingen ny typografi)
> - Max-width 1280px container på worklist-card
> - Defensiv `console.warn` i PUT quotes.js når status='sent' settes direkte
>
> **Estimated Effort**: Medium
> **Parallel Execution**: YES — 2 hovedbølger
> **Critical Path**: T1 (deviations.js per-row payload) → T5 (avvik.js triage-disable) → F1-F4 → user okay

---

## Context

### Original Request
v1.2-instruksjon levert av Tom-Erik: rydd avvik-til-tilbud-livsløpet, lag konsistent "sendt"-vei, og noen forsiktige designgrep. Spesifikk arbeidsmodus: PLAN → vent på godkjenning → BUILD → rapporter for verifikasjon. Ingen commits fra agent. Tom-Erik gjør manuell dev-QA selv.

### Interview Summary
**Tre workstreams (A/C, B sammenslått i A):**
- A1: Disable triage-knapper når avvik har `quote_id`
- A2: Filtrer worklist-default på `quotes.sent_to_customer = true` (boolean — ikke status-streng)
- A3: Minimal toggle "Vis også sendte"
- C1: Ny knapp "Marker som sendt" (status + sent_to_customer + sent_date konsistent, ingen e-post)
- C2: Fjern "Sendt" fra fri status-dropdown
- C3: Statusstripe venstre, hierarki primær/sekundær, max-width 1280px

**Research-bekreftet:**
- `quotes.status` er varchar(50) uten constraint
- Ekte send-løp i `quotes.js:466-469` setter alle 3 felter atomisk
- `airtech_db` har 0 inkonsistente rader (verifisert) — ingen migrering trengs for C2
- Worklist SQL `deviations.js:292-338` har allerede `d.quote_id` i SELECT — trenger kun JOIN mot quotes for `sent_to_customer`
- Per-deviation push `deviations.js:373-381` mangler `quoteId` — må utvides for A1

### Metis Review

**Identified Gaps** (alle adressert):
- C1 idempotens: Default 200 + re-set sent_date hver gang
- A2 empty-ordre: Naturlig forsvinning (filter før gruppering) — ingen empty-state
- C2 bakoverkomp: Verifisert 0 rader i DB — ingen migrering
- Defensiv `console.warn` i PUT quotes.js når status='sent' settes direkte — observerbarhet uten å endre funksjonalitet
- C3 scope-creep grenser eksplisitte: kun font-weight (ikke font-size); max-width på spesifikk worklist-selector (ikke `.main-content`)
- C2 vilkår: bruk `sent_to_customer === true` (autoritativ), ikke `status === 'sent'`

### Oracle Phase 1 Verdict
GO — alle 5 porter passert etter draft-fiks (hidden alternates fjernet, scope OUT eksplisitt, beslutninger dokumentert, rute-guardrail presisert).

---

## Work Objectives

### Core Objective
Lukk inkonsistensene mellom hvordan avvik blir til tilbud og hvordan tilbud lever videre — én autoritativ vei til "sendt"-tilstand, og en arbeidsliste som bare viser det Lars trenger å handle på.

### Concrete Deliverables
- `src/routes/admin/deviations.js` — utvidet worklist (per-row quoteId + sent_to_customer-filter + includeSent-param)
- `src/routes/quotes.js` — nytt endepunkt `POST /:quoteId/mark-as-sent` + defensiv `console.warn` i PUT
- `public/admin/assets/js/avvik.js` — triage-disable per quote_id, A3-toggle-knapp, statusstripe-klasse i render
- `public/admin/assets/js/tilbud.js` — ny "Marker som sendt"-knapp, fjernet "Sendt" option, skjult status-felt for sendte
- `public/admin/avvik.html` — CSS for C3 (statusstripe, hierarki, max-width, A3-toggle)
- Minimale jest-tester for C1-endepunkt og A2-filter

### Definition of Done
- [ ] `npm test` passerer (alle eksisterende + nye tester)
- [ ] Manuell dev-QA av Tom-Erik bekrefter alle 9 punkter i instruks-sjekkliste H
- [ ] Alle "Must NOT have" verifisert fraværende (ingen nye farger, ingen parseInt på VARCHAR, ingen mount-endringer)

### Must Have
- A2-filter bruker `sent_to_customer` boolean, ikke `status`-streng
- C1-endepunkt setter alle 3 felter (status, sent_to_customer, sent_date) i én UPDATE
- C2 skjuler status-feltet (label + select) når `quote.sent_to_customer === true`
- A3 toggle reverserer A2-filter via `?includeSent=true`-param
- C3 bruker kun #B45309/#047857/#6B7280 + eksisterende badge-farger
- Defensiv `console.warn` i PUT quotes.js når body.status === 'sent'

### Must NOT Have (Guardrails)
- INGEN commits fra agent (Tom-Erik eier alle commits)
- INGEN parseInt på VARCHAR (særlig `:quoteId` i C1-endepunktet)
- INGEN nye farger eller fonter (kun gjenbruk av eksisterende)
- INGEN nye DB-statuser
- INGEN CHECK-constraint på quotes.status (eksplisitt utenfor scope)
- INGEN omskriving av modal/worklist (kun målrettet)
- INGEN mount-endringer i `src/app.js`/`server.js` (alle endringer skjer inne i eksisterende rute-filer som allerede er mountet)
- INGEN endring av `font-size`, `letter-spacing` eller `font-family` i C3.2
- INGEN max-width på `.main-content` eller `body` (kun spesifikk worklist-selector)
- INGEN endring av `status`-feltet i API-respons (C2 er ren UI-skjuling — kontrakten beholdes)
- INGEN bruk av `sent_date` som fallback i A2-filter (kun `sent_to_customer`)
- INGEN counter for skjulte sendte i A3-toggle (utenfor v1.2)
- INGEN URL-state for A3-toggle (per-session er nok)
- INGEN fjerning av "Sendt"-status fra API eller andre steder enn fri status-dropdown i rediger-modalen
- INGEN kebab-/dropdown-meny for handlinger, KPI-redesign, pipeline-kolonner, tidsdimensjon/SLA, eller annen strukturell omlegging
- INGEN fix av fri PUT i quotes.js utover defensiv warn (lukking av PUT er egen senere oppgave)
- INGEN fix av status-modell-cleanup (død `draft`, manglende constraint) — egen senere hygiene-oppgave

### Spec Framework Integration
Ikke detektert — ingen `openspec/`, `.specify/`, eller `_bmad/` i repo. Standard plan uten SDD-framework.

---

## Verification Strategy

> **Per instruks: Tom-Erik gjør manuell dev-QA selv. INGEN Playwright/browser fra agent.**
> Agent leverer: jest-tester (eksisterende må passere + nye for C1 og A2-filter) + diff per fil + verbatim testoutput.

### Test Decision
- **Infrastructure exists**: YES (jest, scripts i package.json:27-28)
- **Automated tests**: YES (tests-after) — minimale enhetstester for nytt endepunkt og filter-endring
- **Framework**: jest
- **TDD**: Ikke krevd. Skriv test ETTER implementasjon for C1 og A2.

### QA Policy
Per instruks: **Tom-Erik kjører all dev-QA selv. Ingen agent-utført QA.** Agent leverer jest-output verbatim, så manuell QA-sjekkliste leveres som en del av rapporten (ikke utført av agent).

Manuell QA-sjekkliste som agent leverer (Tom-Erik kjører):
- **Avvik-arbeidsliste**: Bekreft triage-knapper disablet på rad med quote_id; bekreft sendt tilbud forsvinner fra default-visning; bekreft toggle viser sendte igjen
- **Tilbudsmodal**: Bekreft "Marker som sendt" setter alle 3 felter; bekreft "Sendt" ikke lenger i dropdown; bekreft status-felt skjult for sendte
- **Design**: Bekreft venstre stripe i riktig farge per utfall; bekreft hierarki (kunde primær); bekreft max-width 1280px på bred skjerm
- **PUT-warn**: Bekreft `console.warn` i server-loggen når PUT body har status='sent'

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Backend foundation - 4 parallelle):
├── T1: deviations.js — per-deviation quoteId payload [unspecified-low]
├── T2: deviations.js — LEFT JOIN quotes + includeSent toggle [unspecified-high]
├── T3: quotes.js — POST /:quoteId/mark-as-sent endepunkt [unspecified-low]
└── T4: quotes.js — PUT defensiv console.warn [quick]

Wave 2 (Frontend - 3 parallelle, klassenavn-kontrakt låst i plan):
├── T5: avvik.js — triage-disable + A3-toggle UI + statusstripe-klasse + hierarki-klasser i render (depends: T1, T2) [unspecified-high]
├── T6: avvik.html — C3 styling: statusstripe, hierarki (kun font-weight), max-width, toggle-bar [visual-engineering]
└── T7: tilbud.js — "Marker som sendt"-knapp + C2 dropdown-fix (depends: T3) [unspecified-high]

Wave 3 (Tests - 2 parallelle):
├── T8: tests/quotes-mark-as-sent.test.js — C1-endepunkt-tester (depends: T3) [unspecified-low]
└── T9: tests/admin-deviations-worklist-filter.test.js — A2-filter-tester (depends: T2) [unspecified-low]

Wave FINAL (Etter ALL implementasjon — 4 parallelle reviews + brukergodkjenning):
├── F1: Plan-compliance audit (oracle)
├── F2: Code quality review (unspecified-high)
├── F3: Manuell QA-sjekkliste leveres til Tom-Erik (unspecified-high)
└── F4: Scope fidelity check (deep)
-> Vis resultater -> Vent på Tom-Eriks "okay"

Critical Path: T1/T2 → T5 → F1-F4 → user okay
Parallel Speedup: ~65% raskere enn sekvensielt
Max Concurrent: 4 (Wave 1)
```

### Dependency Matrix

| Task | Depends On | Blocks |
|------|------------|--------|
| T1 | — | T5 |
| T2 | — | T5, T9 |
| T3 | — | T7, T8 |
| T4 | — | (none) |
| T5 | T1, T2 | F1-F4 |
| T6 | — (kontrakt forhåndsdefinert) | F1-F4 |
| T7 | T3 | F1-F4 |
| T8 | T3 | F1-F4 |
| T9 | T2 | F1-F4 |
| F1-F4 | T1-T9 (alle implementasjonsoppgaver) | user okay |

### Agent Dispatch Summary

| Wave | Tasks | Profile |
|------|-------|---------|
| 1 | 4 | T1, T3 → `unspecified-low`; T2 → `unspecified-high`; T4 → `quick` |
| 2 | 3 | T5, T7 → `unspecified-high`; T6 → `visual-engineering` |
| 3 | 2 | T8, T9 → `unspecified-low` |
| FINAL | 4 | F1 → `oracle`; F2, F3 → `unspecified-high`; F4 → `deep` |

---

## TODOs

> Implementasjon + Test = ÉN oppgave når relevant. Triage og kvalitet ligger i samme TODO.
> EVERY task MUST have: Recommended Agent Profile + Parallelization info + manuell QA-sjekkpunkter (per-instruks: Tom-Erik kjører — agent leverer presise sjekksteg).
> **FORMAT**: Task labels MUST use bare numbers: `1.`, `2.`, `3.`. Final Wave bruker `F1.`, `F2.`.

- [ ] 1. `src/routes/admin/deviations.js`: Utvid per-deviation push i worklist-respons med `quoteId`

  **What to do**:
  - I `deviations.js:373-381`, legg til `quoteId: r.quoteId` i deviation-objektet som pushes til `grp.deviations`.
  - SELECT-listen (`deviations.js:310`) henter allerede `d.quote_id AS "quoteId"` — ingen SQL-endring nødvendig.
  - Ingen andre endringer i denne oppgaven (filter og toggle skjer i T2).

  **Must NOT do**:
  - Ikke endre SELECT-listen (allerede komplett)
  - Ikke endre WHERE-klausulen (det er T2)
  - Ikke endre grp-aggregering (`if (r.quoteId && !grp.quote_id)` på linje 369 forblir)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-low`
    - Reason: Ren feltlegging i eksisterende objekt. Ingen logikk-endring. Trivielt scoped.
  - **Skills**: ingen
    - Domenet er enkelt (én linje + felt-kontrakt med frontend i T5).

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (med T2, T3, T4)
  - **Blocks**: T5 (avvik.js triage-disable trenger quoteId per rad)
  - **Blocked By**: ingen

  **References**:
  - Pattern: `src/routes/admin/deviations.js:373-381` — eksisterende push-objekt; `r.quoteId` er allerede tilgjengelig fra SQL.
  - Kontekst: `src/routes/admin/deviations.js:310` — SELECT-feltet `d.quote_id AS "quoteId"`.

  **Acceptance Criteria**:
  - [ ] `grp.deviations.push({...})` inkluderer `quoteId: r.quoteId` (kan være null)
  - [ ] Ingen SQL endret
  - [ ] Manuell test (Tom-Erik): GET `/api/admin/deviations/worklist` returnerer `quoteId` per deviation i orders[].deviations[]

  **Commit**: NO (Tom-Erik grupper med T2, T9)

- [ ] 2. `src/routes/admin/deviations.js`: LEFT JOIN quotes + filter på `sent_to_customer` + `?includeSent` toggle

  **What to do**:
  - Endre worklist-SQL i `deviations.js:292-338`:
    - Legg til `LEFT JOIN quotes q ON q.id = d.quote_id` etter `LEFT JOIN equipment e ON e.id = d.equipment_id`
    - I WHERE-klausul: legg til `AND (q.sent_to_customer IS NOT TRUE)` BAK eksisterende vilkår
  - Les `req.query.includeSent` i ruten (`router.get('/worklist', ...)` på linje 278). Hvis `req.query.includeSent === 'true'`, bygg SQL UTEN det nye filteret. Bygg som dynamisk WHERE-konstruksjon eller bruk to separate SQL-strenger styrt av if-betingelse (foretrekk dynamisk for å unngå duplisering).
  - Param-validering: bare aksepter exact streng `'true'` for `?includeSent`. Alt annet behandles som false (default).

  **Must NOT do**:
  - Ikke bruk `sent_date` som fallback i filter
  - Ikke bruk `status = 'sent'`-streng som filter
  - Ikke bruk `parseInt` eller `Boolean()` på query-param — string-eksakt match
  - Ikke endre returobjektet (counters/orders) — bare WHERE-klausulen
  - Ikke modifiser eksisterende WHERE-vilkår (`outcome_handled_at IS NULL`, `outcome IS NOT NULL OR status <> 'closed'`, `sr.order_id IS NOT NULL`) — kun TILLEGG

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: SQL-endring + nytt query-param + dynamisk WHERE. Krever omtanke for tri-state NULL-håndtering og ikke å bryte eksisterende tester.
  - **Skills**: ingen
    - Standard SQL/Express-domene.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: T5 (frontend trenger filtrert respons), T9 (test for ny oppførsel)
  - **Blocked By**: ingen

  **References**:
  - SQL-mål: `src/routes/admin/deviations.js:292-338`
  - Eksisterende WHERE-mønster: linje 334-336
  - Param-håndtering-eksempel (i samme fil): `parseList(req.query.status)` på linje 81-84
  - quotes-tabellen: kolonnen `sent_to_customer BOOLEAN DEFAULT false` (`migrations/000-base-schema.sql:294`)

  **Acceptance Criteria**:
  - [ ] Default GET `/api/admin/deviations/worklist`: avvik med `quotes.sent_to_customer = true` skjules
  - [ ] Default GET: avvik med `quote_id IS NULL` vises (LEFT JOIN gir NULL i q.sent_to_customer; `IS NOT TRUE` evaluerer til true)
  - [ ] Default GET: avvik med `quote_id` satt og `sent_to_customer = false` vises
  - [ ] GET med `?includeSent=true`: alle avvik vises (filteret av)
  - [ ] GET med `?includeSent=other`/`?includeSent=1`/uten param: filter aktivt
  - [ ] Eksisterende tester (`tests/admin-deviations.test.js`) passerer fortsatt

  **Commit**: NO

- [ ] 3. `src/routes/quotes.js`: Nytt endepunkt `POST /:quoteId/mark-as-sent`

  **What to do**:
  - Legg til ny rute i `src/routes/quotes.js` mellom PUT (`router.put('/:id', ...)` på linje 185) og DELETE eller før `router.post('/:quoteId/send-to-customer', ...)` på linje 405:
    ```
    router.post('/:quoteId/mark-as-sent', async (req, res) => { ... });
    ```
  - Logikk:
    - Les `req.params.quoteId` direkte (string, IKKE parseInt)
    - Hent tenant: `const tenantId = req.tenantId;` (middleware på linje 10-25 har allerede satt det)
    - `const pool = await db.getTenantConnection(tenantId);`
    - Sjekk eksistens: `SELECT 1 FROM quotes WHERE id = $1` — hvis 0 rader, returner 404 `{ error: 'Tilbud ikke funnet' }`
    - Kjør UPDATE med samme tre felt som send-to-customer-ruten (linje 466-469):
      ```
      UPDATE quotes SET status = 'sent', sent_to_customer = true, sent_date = CURRENT_TIMESTAMP WHERE id = $1
      ```
    - Returner 200 med `{ success: true, quoteId, status: 'sent', sent_to_customer: true, sent_date: <ISO-streng> }` (les sent_date fra UPDATE...RETURNING for nøyaktig timestamp)
  - Idempotens: Gjentatt kall oppdaterer `sent_date` hver gang. Ikke bruk WHERE-vilkår som blokkerer re-set.
  - Try/catch med `console.error('Mark-as-sent error:', error)` + 500-respons (mønster fra send-to-customer på linje 478-483).

  **Must NOT do**:
  - Ikke `parseInt(req.params.quoteId)` — id er VARCHAR
  - Ikke send e-post (det er hele poenget)
  - Ikke generer PDF
  - Ikke kall EmailService eller QuotePDFGenerator
  - Ikke bruk customerService for recipient-lookup
  - Ikke legg til ny mount-linje i `src/app.js`/`server.js` (eksisterende mount på `server.js:328` plukker opp ny rute via require)
  - Ikke valider mer enn quoteId-eksistens (ingen content-validering, ingen body-parsing — endepunktet er parameter-fritt)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-low`
    - Reason: Liten avgrenset rute, kopier mønster fra eksisterende send-to-customer minus e-post-delen. ~30 linjer kode.
  - **Skills**: ingen

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: T7 (frontend-knapp), T8 (test)
  - **Blocked By**: ingen

  **References**:
  - Send-to-customer-rute (mønster): `src/routes/quotes.js:404-489` — kopier UPDATE-querien (linje 466-469) og 404-håndteringen (linje 422-424)
  - Auth-middleware (allerede aktiv): `src/routes/quotes.js:10-25` — setter `req.tenantId`
  - Tenant-pool: `db.getTenantConnection(tenantId)` mønster i samme fil
  - VARCHAR-bekreftelse: `migrations/000-base-schema.sql:286` (`id VARCHAR(50) NOT NULL`)

  **Acceptance Criteria**:
  - [ ] `POST /api/quotes/QUOTE-123-456/mark-as-sent` på eksisterende quote → 200 med JSON `{ success: true, ... }` og DB har `status='sent', sent_to_customer=true, sent_date=NOW()`
  - [ ] `POST /api/quotes/INVALID/mark-as-sent` → 404 `{ error: 'Tilbud ikke funnet' }`
  - [ ] Gjentatt POST på samme quote → 200, sent_date oppdatert til ny timestamp
  - [ ] Ingen e-post sendt (verifiseres ved at EmailService ikke importeres i ruta)
  - [ ] Manuell test: kjør `psql ... -c "SELECT status, sent_to_customer, sent_date FROM quotes WHERE id = '...'"` etter API-kall — alle 3 felter satt

  **Commit**: NO

- [ ] 4. `src/routes/quotes.js`: Defensiv `console.warn` i PUT når body.status === 'sent'

  **What to do**:
  - I `src/routes/quotes.js:188` (PUT-handler), tidlig i try-blokken etter destrukturering, legg til:
    ```
    if (status === 'sent') {
        console.warn(`[WARN] PUT /api/quotes/${id} satt status='sent' direkte. Bruk POST /api/quotes/${id}/mark-as-sent for korrekt sent-flyt. sent_to_customer/sent_date settes IKKE av denne ruten.`);
    }
    ```
  - INGEN andre endringer i PUT-handleren. Funksjonalitet uendret.

  **Must NOT do**:
  - Ikke endre logikken (status settes fortsatt som før)
  - Ikke returner feil/blokker requesten
  - Ikke endre status-validering
  - Ikke fjern den eksisterende fri-PUT-veien

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 4 linjer kode. Enkel observerbarhet.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: ingen
  - **Blocked By**: ingen

  **References**:
  - PUT-handler: `src/routes/quotes.js:184-220`
  - Variabel-destrukturering: linje 188

  **Acceptance Criteria**:
  - [ ] PUT med body `{ status: 'sent' }` skriver console.warn i server-logg
  - [ ] PUT med body `{ status: 'pending' }` skriver INGEN warn
  - [ ] Funksjonalitet uendret: status oppdateres fortsatt i DB

  **Commit**: NO

- [ ] 5. `public/admin/assets/js/avvik.js`: Triage-disable + A3-toggle UI + statusstripe-klasse i render

  **What to do**:
  - **A1 — Triage-disable**: I `avvik.js:194-207` (innenfor `renderWorklistOrders`-mappen), endre rendering av triage-knappene (linje 204-205) slik at de er disablet (med `disabled` attributt og dempet styling) når `d.quoteId` er satt. Bruk inline-template:
    - Hvis `d.quoteId` er truthy: `<button class="avvik-btn avvik-btn-outline" disabled style="opacity:0.4;cursor:not-allowed;" type="button" title="Avvik er knyttet til tilbud">Ikke aktuelt</button>` (samme for "Håndtert")
    - Ellers: bevar eksisterende rendering med onclick-handlere
  - **A3 — Toggle UI**: 
    - Modul-state øverst i fil-IIFE (rundt `state`-deklarasjon, linje 8): legg til `let includeSent = false;` ETTER state-objekt, IKKE inne i state.
    - Modifiser `loadWorklist()` (linje 155): `const url = '/api/admin/deviations/worklist' + (includeSent ? '?includeSent=true' : '');` og `fetch(url, ...)` i stedet for hardkoded streng.
    - Render selve toggle-baren ØVERST i `renderWorklistOrders` (linje 188-194), før orders-mappen:
      ```
      const toggleBar = `<div class="worklist-toggle-bar"><label><input type="checkbox" id="worklist-include-sent" ${includeSent ? 'checked' : ''}> Vis også sendte</label></div>`;
      ```
    - Wire up i `setupEventListeners` (eller etter render): `document.getElementById('worklist-include-sent')?.addEventListener('change', (e) => { includeSent = e.target.checked; loadWorklist(); });`
  - **C3.1-klasse i render**: I `renderWorklistOrders` (linje 194-231), beregn dominerende state per ordre fra `o.stateCounts`:
    - Funksjon: `function dominantState(sc) { if (sc.wants_quote >= sc.fixed_on_site && sc.wants_quote >= sc.unassessed) return 'wants-quote'; if (sc.fixed_on_site >= sc.unassessed) return 'fixed-on-site'; return 'unassessed'; }`
    - Tie-breaker: wants_quote > fixed_on_site > unassessed (først i prioritet ved likhet)
    - Legg til klasse på `.avvik-card`: `worklist-card--${dominantState(o.stateCounts)}`
  - **C3.2-klasser for hierarki** (kontrakt mot T6):
    - Customer-elementet i linje 213: fjern `style="font-size:15px;"` og legg til `class="worklist-card-customer"`
    - Adresse/kontakt-wrapper i linje 216-219: fjern `style="font-size:13px; color:#6B7280;"` og legg til `class="worklist-card-meta"` på den ytre div-en
    - Beholde inline `color`-deklarasjoner ER tillatt hvis nødvendig (T6 deklarerer ingen nye color-regler) — men foretrukket: la fargen arve fra eksisterende `.avvik-table td { color: #374151; }` (avvik.html:67) eller la den være helt udeklarert.

  **Must NOT do**:
  - Ikke endre per-deviation rendering utover triage-knapp-betingelsen
  - Ikke endre badge/severity rendering
  - Ikke fjern eksisterende onclick-handlere for ikke-quoted avvik
  - Ikke parseInt på quoteId/orderId (de er strenger)
  - Ikke lagre toggle-state i localStorage/URL (per-session er nok)
  - Ikke endre stateCounts-strukturen — bare LES fra den
  - Ikke legg includeSent i `state`-objektet (modul-scope-variabel for å holde state lokalt enkelt)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Tre relaterte men distinkte endringer i samme render-funksjon. Krever forsiktighet med string-template og logikkflyt.

  **Parallelization**:
  - **Can Run In Parallel**: YES med T6 og T7 — klassenavn-kontrakten er låst i denne planen (`worklist-card--{wants-quote|fixed-on-site|unassessed}`, `worklist-card-customer`, `worklist-card-meta`, `worklist-toggle-bar`). T5 emitter klassene; T6 styler dem. Hverken oppgave avhenger av at den andre er ferdig først.
  - **Parallel Group**: Wave 2
  - **Blocks**: F1-F4
  - **Blocked By**: T1, T2

  **References**:
  - Render-mål: `public/admin/assets/js/avvik.js:188-232`
  - Triage-knapp-render: linje 204-205
  - Eksisterende handlere: `_avvikWorklistNotApplicable`, `_avvikWorklistHandled` (linje 451-452)
  - `loadWorklist`: linje 149-166
  - `setupEventListeners`: linje 433-492
  - `stateCounts`-felt fra backend: `src/routes/admin/deviations.js:365-372`

  **Acceptance Criteria**:
  - [ ] Avvik med `quoteId` satt: triage-knapper har `disabled`-attributt og opacity 0.4
  - [ ] Avvik uten `quoteId`: triage-knapper aktive som før
  - [ ] Toggle-bar finnes i worklist-visningen med tekst "Vis også sendte"
  - [ ] Toggle ON: kall til `/api/admin/deviations/worklist?includeSent=true`
  - [ ] Toggle OFF: kall uten param
  - [ ] Toggle resetter til OFF ved sidereload (per-session)
  - [ ] Hver `.avvik-card` har én klasse: `worklist-card--wants-quote` / `--fixed-on-site` / `--unassessed`
  - [ ] Customer-elementet (linje 213) bruker `class="worklist-card-customer"` (ikke inline font-size)
  - [ ] Adresse/kontakt-wrapper bruker `class="worklist-card-meta"`

  **Commit**: NO

- [ ] 6. `public/admin/avvik.html`: C3 styling — statusstripe + hierarki + max-width + toggle-bar

  **What to do**:
  Innenfor `<style>`-blokken i `avvik.html` (linje 11-223), legg til ETTER de eksisterende avvik-card-reglene (linje 50 ish):

  - **C3.1 Statusstripe**:
    ```
    .avvik-card.worklist-card--wants-quote   { border-left: 4px solid #B45309; }
    .avvik-card.worklist-card--fixed-on-site { border-left: 4px solid #047857; }
    .avvik-card.worklist-card--unassessed    { border-left: 4px solid #6B7280; }
    ```
    Bruk EKSAKT disse hex-kodene fra `avvik.js:176-178` (ingen nye farger).

  - **C3.2 Hierarki** (kun font-weight, ingen farge eller font-size i nye CSS-regler):
    Legg til regler som skriver over den eksisterende inline-stylen i `avvik.js:213-219`. Siden inline > CSS, må selve avvik.js-renderen i T5 oppdateres til å bruke klassenavn `worklist-card-customer` (primær) og `worklist-card-meta` (sekundær) på de tilsvarende span/div, OG ikke ha inline font-weight.

    **VIKTIG kontrakt med T5**: T5-implementeren må fjerne inline `style="font-size:15px;"` fra customer-elementet (linje 213) og fjerne `style="font-size:13px; color:#6B7280;"` fra adresse/kontakt-divene (linje 216-219), og i stedet legge til `class="worklist-card-customer"` på customer + `class="worklist-card-meta"` på adresse/kontakt-wrapper. Eksisterende farger bevares fordi T6 ikke deklarerer nye color-regler — fargene flyttes ut av inline og inn i klassen som arver fra eksisterende kontekst eller settes av T5 via klassenavn.

    CSS:
    ```
    .avvik-card .worklist-card-customer { font-weight: 700; }
    .avvik-card .worklist-card-meta     { font-weight: 400; }
    ```
    INGEN nye `color`-deklarasjoner i CSS — kun font-weight. Farge arves fra parent eller settes av eksisterende inline-style som T5 BEHOLDER for `color`-egenskapen alene (T5 fjerner kun font-size, beholder color der nødvendig). Alternativt kan T5 fjerne fargen helt og la den arve fra `.avvik-table td { color: #374151; }` (avvik.html:67) som er etablert.

  - **C3.3 Max-width container**:
    ```
    #avvik-worklist-card { max-width: 1280px; margin: 0 auto; }
    ```
    KUN på `#avvik-worklist-card` (worklist-spesifikk). IKKE på `.main-content`, `.app-layout`, eller `body`.

  - **A3 Toggle-bar styling** (kun struktur, ingen nye farger):
    ```
    .worklist-toggle-bar { padding: 8px 0 16px; font-size: 13px; }
    .worklist-toggle-bar input[type="checkbox"] { margin-right: 6px; }
    ```
    INGEN `color`-deklarasjon — arver fra parent. `font-size: 13px` er eksisterende skala (samme som `.avvik-table td` i avvik.html:64-69).

  **Must NOT do**:
  - INGEN max-width på `.main-content`, `.app-layout`, `body`, eller andre globale wrappere
  - INGEN nye hex-koder utenfor #B45309/#047857/#6B7280 og det som finnes fra før
  - INGEN endring av eksisterende `.avvik-card`-regler (kun TILLEGG av modifier-klasser)
  - INGEN `font-size`, `letter-spacing`, eller `font-family` i C3.2-reglene
  - INGEN endring av eksisterende badges (linje 81-86)
  - Ikke ta bort eksisterende inline-stylen i `avvik.js` selv (det skjer i T5 — denne oppgaven legger bare til CSS-klasser)

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Forsiktig CSS-tillegg med spesifisitet og scope-kontroll. Krever forståelse av cascade og at ingen globale wrappere får max-width.

  **Parallelization**:
  - **Can Run In Parallel**: YES med T5 — klassenavn-kontrakten er låst i denne planen (`worklist-card--{wants-quote|fixed-on-site|unassessed}`, `worklist-card-customer`, `worklist-card-meta`, `worklist-toggle-bar`). T6 skriver CSS for disse klassene; T5 emitter dem. Hverken oppgave avhenger av at den andre er ferdig først.
  - **Parallel Group**: Wave 2 (parallelt med T5 og T7)
  - **Blocks**: F1-F4
  - **Blocked By**: ingen (kontrakten er forhåndsdefinert i planen)

  **References**:
  - Eksisterende `<style>`-blokk: `public/admin/avvik.html:11-223`
  - Badges (gjenbruk): linje 81-86
  - Worklist-card scope: `#avvik-worklist-card` definert i `avvik.html:321`

  **Acceptance Criteria**:
  - [ ] Worklist-card med klassen `worklist-card--wants-quote` har 4px oransje venstre-border (#B45309)
  - [ ] Tilsvarende for `--fixed-on-site` (grønn #047857) og `--unassessed` (grå #6B7280)
  - [ ] `#avvik-worklist-card` har max-width 1280px og er sentrert med margin: 0 auto
  - [ ] `.main-content` og `body` IKKE påvirket — bekreft ved å sammenligne andre admin-sider (rapporter, planlegger) før/etter
  - [ ] Toggle-bar har riktig padding og font-size 13px
  - [ ] Søk i admin.css + alle CSS-filer: ingen nye hex utenfor de tre tillatte (verifiser med grep)
  - [ ] Søk i CSS: ingen `font-size` lagt til i de nye reglene

  **Commit**: NO

- [ ] 7. `public/admin/assets/js/tilbud.js`: "Marker som sendt"-knapp + C2 dropdown-fix

  **What to do**:

  **C1 — Ny knapp "Marker som sendt"**:
  - I `tilbud.js:160-178` (action-buttons-modern-blokken), legg til ny knapp ved siden av "Send til kunde", med samme synlighetsregel (`status === 'pending' || status === 'rejected'`):
    ```
    ${quote.status === 'pending' || quote.status === 'rejected' ? `
      <button class="btn-modern btn-mark-sent" onclick="markQuoteAsSent('${quote.id}')">
        ✓ Marker som sendt
      </button>
    ` : ''}
    ```
  - Legg til ny global handler i samme fil (i nærheten av `sendQuoteToCustomer` på linje 339):
    ```
    window.markQuoteAsSent = async function(quoteId) {
      if (!confirm('Marker tilbudet som sendt til kunde? (Sender INGEN e-post)')) return;
      try {
        const response = await fetch(`/api/quotes/${quoteId}/mark-as-sent`, {
          method: 'POST', credentials: 'include'
        });
        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw new Error(error.error || `Serverfeil: ${response.status}`);
        }
        showToast('Tilbud markert som sendt', 'success');
        await loadData();
      } catch (error) {
        console.error('Error marking quote as sent:', error);
        showToast('Feil: ' + error.message, 'error');
      }
    };
    ```
  - Knappestil: bruk eksisterende `.btn-modern` + ny modifier-klasse `.btn-mark-sent`. Style legges i `tilbud.css` (eller behold inline med eksisterende fargeskala om enklere). Hvis CSS legges til, må T7-implementeren oppdatere `tilbud.css` med farge fra eksisterende palett (f.eks. samme grønn som suksess-toaster). KEEP minimal.

  **C2 — Fjern "Sendt" fra fri status-dropdown + skjul status-felt for sendte**:
  - I `tilbud.js:451-457`, modifiser status-dropdownen:
    - Fjern linje 453 helt: `<option value="sent" ${quote.status === 'sent' ? 'selected' : ''}>Sendt</option>` skal IKKE eksistere lenger.
    - Behold de andre 5 alternativene (pending, accepted, rejected, rejected_admin, rejected_customer).
  - Wrap hele `<div class="form-group">` for status (linje 449-459) i en betinget render basert på `quote.sent_to_customer === true`:
    ```
    ${quote.sent_to_customer === true ? `
      <div class="form-group">
        <label>Status</label>
        <div class="sent-readonly-badge">
          ✉️ Sendt ${quote.sent_date ? new Date(quote.sent_date).toLocaleDateString('no-NO', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}
        </div>
      </div>
    ` : `
      <div class="form-group">
        <label for="edit-status">Status</label>
        <select id="edit-status" class="form-control">
          <option value="pending" ${quote.status === 'pending' ? 'selected' : ''}>Venter</option>
          <option value="accepted" ${quote.status === 'accepted' ? 'selected' : ''}>Godkjent</option>
          <option value="rejected" ${quote.status === 'rejected' ? 'selected' : ''}>Avvist</option>
          <option value="rejected_admin" ${quote.status === 'rejected_admin' ? 'selected' : ''}>Avvist av admin</option>
          <option value="rejected_customer" ${quote.status === 'rejected_customer' ? 'selected' : ''}>Avvist av kunde</option>
        </select>
      </div>
    `}
    ```
  - I save-handleren `tilbud.js:576-606`, modifiser status-lesningen:
    - Endre `const status = document.getElementById('edit-status')?.value;` til en betinget verdi:
      `const statusEl = document.getElementById('edit-status'); const status = statusEl ? statusEl.value : (quote.status || 'pending');`
    - Dette sikrer at status-feltet bevares uendret når feltet er skjult (sendte quotes).

  **Must NOT do**:
  - Ikke fjern "Sendt"-relaterte felter andre steder (f.eks. badge på linje 150-157 — den skal beholdes)
  - Ikke parseInt på quote.id
  - Ikke endre PUT-flyten utover status-lesningen
  - Ikke send "sent" som verdi gjennom dropdown noe sted
  - Ikke endre "Send til kunde"-knappen (den ekte send-veien forblir uendret)
  - Ikke fjern de andre 5 status-alternativene fra dropdown
  - Ikke endre "Avvis"-knappen (linje 172-176) — den setter `rejected_admin` via PUT, det er en eksisterende fungerende vei

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Tre relaterte UI-endringer i samme fil (knapp, handler, dropdown-fix). Krever forsiktighet med betinget rendering og save-flytens status-håndtering for å unngå at sendte quotes mister status ved lagring.

  **Parallelization**:
  - **Can Run In Parallel**: YES (uavhengig av T5/T6)
  - **Parallel Group**: Wave 2
  - **Blocks**: F1-F4
  - **Blocked By**: T3 (mark-as-sent endepunktet må eksistere først)

  **References**:
  - Action buttons render: `public/admin/assets/js/tilbud.js:160-178`
  - sendQuoteToCustomer (mønster for handler): linje 338-365
  - Status dropdown: linje 451-457
  - Save handler status-lesning: linje 576, 606
  - Sendt-badge (uendret): linje 150-157

  **Acceptance Criteria**:
  - [ ] Ny knapp "Marker som sendt" vises ved siden av "Send til kunde" når status er pending eller rejected
  - [ ] Klikk på knappen → confirm-dialog → POST `/api/quotes/:id/mark-as-sent` → toast "Tilbud markert som sendt" → loadData() refresher liste
  - [ ] Status-dropdown for ikke-sendte quotes har 5 alternativer (pending, accepted, rejected, rejected_admin, rejected_customer) — IKKE "sent"
  - [ ] For quotes med `sent_to_customer === true`: status-feltet vises som read-only badge med dato, IKKE som dropdown
  - [ ] Lagring av sendt quote (med skjult status-felt) bevarer `quote.status` uendret i PUT-body
  - [ ] Eksisterende "Sendt"-badge på linje 150-157 vises fortsatt som før (ikke berørt)

  **Commit**: NO

- [ ] 8. `tests/quotes-mark-as-sent.test.js`: Jest-tester for C1-endepunkt

  **What to do**:
  - Opprett ny testfil `tests/quotes-mark-as-sent.test.js`.
  - Bruk supertest mot `src/app.js` (etablert mønster i `tests/quotes-auth.test.js`).
  - Test-cases (minimum):
    1. POST mot eksisterende quote → 200, body har `success: true`, og DB har `status='sent', sent_to_customer=true, sent_date IS NOT NULL`
    2. POST mot ikke-eksisterende quote-id → 404 med `{ error: 'Tilbud ikke funnet' }`
    3. Idempotent: POST to ganger på samme quote → begge 200, andre kallets sent_date er nyere enn første
    4. Auth: POST uten gyldig session → 401
  - Følg eksisterende test-mønster fra `tests/quotes-auth.test.js` for tenant-mocking og DB-cleanup.
  - Hvis test-DB-oppsett mangler quote-rader: bygg minimal seeding i `beforeEach` eller bruk eksisterende test-fixtures.

  **Must NOT do**:
  - Ikke kjør mot prod-DB (bruk test-tenant)
  - Ikke test e-post-funksjonalitet (mark-as-sent har INGEN e-post — det er hele poenget)
  - Ikke test send-to-customer-endepunktet (eksisterer separat)
  - Ikke parseInt-handle id-en

  **Recommended Agent Profile**:
  - **Category**: `unspecified-low`
    - Reason: Bibliotektesting med etablert mønster. ~50-80 linjer test-kode.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: F1-F4
  - **Blocked By**: T3

  **References**:
  - Eksisterende mønster: `tests/quotes-auth.test.js:1-46` — supertest-oppsett, express-app-mock, session-middleware, `app.use('/api/quotes', require('../src/routes/quotes'))` på linje 42
  - `package.json:27` — `npm test`-kommando
  - C1-endepunkt: `src/routes/quotes.js` (legges til av T3)
  - Schema: `migrations/000-base-schema.sql:285-297` for quotes-tabell-kolonner og default-verdier

  **Acceptance Criteria**:
  - [ ] `tests/quotes-mark-as-sent.test.js` finnes
  - [ ] `npx jest tests/quotes-mark-as-sent.test.js` → alle 4 test-cases passerer
  - [ ] Tester rører ikke prod-DB
  - [ ] Tester rydder opp etter seg (cleanup)

  **Commit**: NO

- [ ] 9. `tests/admin-deviations-worklist-filter.test.js`: Jest-tester for A2-filter

  **What to do**:
  - Opprett ny testfil `tests/admin-deviations-worklist-filter.test.js`.
  - Bruk supertest + eksisterende mønster fra `tests/admin-deviations.test.js`.
  - Test-cases (minimum):
    1. Default GET `/api/admin/deviations/worklist`: avvik med `quotes.sent_to_customer = true` UTELATES fra resultat
    2. Default GET: avvik med `quote_id IS NULL` INKLUDERES
    3. Default GET: avvik med `quote_id` satt og `sent_to_customer = false` INKLUDERES
    4. GET med `?includeSent=true`: avvik med sent_to_customer=true er nå INKLUDERT
    5. GET med `?includeSent=other`/`?includeSent=1`: filter aktivt (kun streng 'true' triggerer toggle)
  - Seed test-DB med minimum 3 deviation-quotes: én sent, én pending, én uten quote.

  **Must NOT do**:
  - Ikke modifiser `tests/admin-deviations.test.js` (eksisterende tester må stå urørt)
  - Ikke endre worklist-endpoint logikken — kun teste det T2 implementerer
  - Ikke parseInt på quote-id i seed-data

  **Recommended Agent Profile**:
  - **Category**: `unspecified-low`
    - Reason: Test-skriving med etablert mønster.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: F1-F4
  - **Blocked By**: T2

  **References**:
  - Eksisterende mønster: `tests/admin-deviations.test.js:34-58` — supertest-oppsett, `require('../src/routes/admin/deviations')` på linje 38, `describe('GET /api/admin/deviations')` på linje 57, test-eksempler på linje 58-82
  - A2-implementasjon: `src/routes/admin/deviations.js` (modifisert av T2)
  - Schema: `migrations/000-base-schema.sql:285-297` for quotes (særlig sent_to_customer på linje 294)

  **Acceptance Criteria**:
  - [ ] `tests/admin-deviations-worklist-filter.test.js` finnes
  - [ ] `npx jest tests/admin-deviations-worklist-filter.test.js` → alle 5 test-cases passerer
  - [ ] Eksisterende `tests/admin-deviations.test.js` passerer fortsatt (ingen regresjon)

  **Commit**: NO

---

## Final Verification Wave (MANDATORY — etter ALL implementasjon)

> 4 review-agenter parallelt. ALLE må APPROVE. Vis resultater til Tom-Erik og vent på eksplisitt "okay" før ferdigmarkering.

- [ ] F1. **Plan-compliance audit** — `oracle`
  Les planen end-to-end. For hver "Must Have": verifiser implementasjon eksisterer (les fil, sjekk endepunkt-rute, sjekk dropdown HTML). For hver "Must NOT Have": søk i codebase for forbudte mønstre (parseInt på `:quoteId`, nye hex-koder utenfor #B45309/#047857/#6B7280 + eksisterende badge-farger, mount-endringer i app.js/server.js, endringer i `font-size`/`font-family`, `max-width` på `.main-content` eller `body`). Sammenlign deliverables mot plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code quality review** — `unspecified-high`
  Kjør `npm test`. Review alle endrede filer for: `as any`/`@ts-ignore`, tomme catches, console.log i prod-kode (men IKKE den ene tilsiktede `console.warn` i PUT — den er ønsket), kommentert-ut-kode, ubrukte importer. Sjekk AI-slop: overdreven kommentering, over-abstraksjon, generiske navn (data/result/item/temp).
  Output: `Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Manuell QA-sjekkliste levering** — `unspecified-high`
  Generer sjekkliste-dokument til `.omo/evidence/v1.2-manual-qa-checklist.md`. IKKE utfør QA selv — lever sjekklisten klar til Tom-Erik. Dekk:
  - Alle 9 punkter i instruks-sjekkliste H (med eksakt klikk-sti, URL/endepunkt, og forventet resultat per punkt)
  - **Tom-Eriks tre ekstra betingelser**:
    1. **v1/v1.1 regresjon** — "Lag tilbud"-knapp, "Rediger tilbud"-deeplink (`?openQuote=<id>`) og rapport-lenke ("Se rapport") fungerer fortsatt som forventet. Dette er tredje runde på avvik.js/tilbud.js.
    2. **T5↔T6 klassekontrakt** — feilstavingssjekk: åpne devtools og bekreft at `.avvik-card` i worklist faktisk har klassen `worklist-card--wants-quote` / `worklist-card--fixed-on-site` / `worklist-card--unassessed` (eksakt disse navnene), og at venstre stripe vises med riktig farge.
    3. **C2 modal for sendte tilbud** — åpne et tilbud med `sent_to_customer=true` i rediger-modalen. Bekreft: (a) status-felt er skjult (ingen dropdown), (b) read-only badge vises med dato, (c) lagring endrer IKKE status i DB.
  - Inkluder: hvilke quotes/avvik å teste mot (state-eksempler med DB-query for å finne relevante rader), psql-kommandoer for å verifisere DB-effekt, serverlogg-hint for `console.warn`.
  Output: `Sjekkliste levert til .omo/evidence/v1.2-manual-qa-checklist.md | VERDICT: APPROVE/REJECT`

- [ ] F4. **Scope fidelity check** — `deep`
  For hver oppgave T1-T9: les "What to do", les faktisk diff (`git diff HEAD`). Verifiser 1:1 — alt som var spesifisert ble bygget; ingenting utover ble bygget. Sjekk "Must NOT do"-overholdelse. Detekter cross-task forurensning (T5 som rører T7s filer, etc.). Flagg ikke-redegjorte endringer.
  **Tom-Eriks tre ekstra betingelser (eksplisitt scope)**:
  1. **v1/v1.1 regresjon** — les avvik.js: bekreft at `_avvikWorklistCreateQuote`, `_avvikWorklistEditQuote`, og `_avvikWorklistSeeReport` (linje 446-450) er urørt. Les tilbud.js: bekreft at deeplink-fix (`window.history.replaceState` i `loadData`) fra forrige runde ikke er overskrevet.
  2. **T5↔T6 klassekontrakt** — grep avvik.js for `worklist-card--` og grep avvik.html `<style>`-blokken for `.worklist-card--`. Bekreft eksakt navnematch. Grep avvik.js for `worklist-card-customer` og `worklist-card-meta`, tilsvarende i CSS.
  3. **C2 modalvisning for sendte** — les tilbud.js render-kode: bekreft at condition er `sent_to_customer === true`, IKKE `status === 'sent'`. Bekreft at save-handler bevarer eksisterende `quote.status` når `#edit-status`-elementet mangler.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | v1/v1.1 regression [CLEAN/issues] | Class contract [MATCH/MISMATCH] | C2 modal [CORRECT/issues] | VERDICT`

---

## Commit Strategy

**Per instruks: Tom-Erik eier alle commits. Agent gjør IKKE `git add/commit/push`.**

Foreslått commit-gruppering (Tom-Erik kjører):
1. `feat(deviations): per-row quoteId + sent_to_customer worklist filter` — T1, T2, T9
2. `feat(quotes): mark-as-sent endpoint + PUT defensive warn` — T3, T4, T8
3. `feat(avvik-ui): triage disable + show-sent toggle + status stripe` — T5, T6
4. `feat(tilbud-ui): mark-as-sent button + status field hidden for sent` — T7

---

## Success Criteria

### Verification Commands
```bash
# Eksisterende tester må fortsatt passere
npm test
# Forventet: 0 failures, alle tidligere tester pluss 2 nye filer

# DB-state-verifikasjon (Tom-Erik kjører)
psql -h 127.0.0.1 -p 5434 -U postgres -d airtech_db -c "SELECT id, status, sent_to_customer, sent_date FROM quotes ORDER BY created_at DESC LIMIT 5;"
# Forventet: ingen rader med status='sent' AND sent_to_customer=false (etter at C1 brukes)
```

### Final Checklist (mappet til instruks-sjekkliste H)
- [ ] Triage-knapper disablet/skjult når `quote_id` finnes; "Rediger tilbud" aktiv
- [ ] Arbeidsliste filtrerer default på `sent_to_customer = false` (ikke status-streng)
- [ ] Toggle "vis også sendte" finnes (minimal — én knapp)
- [ ] "Marker som sendt"-knapp setter status + sent_to_customer + sent_date konsistent, uten e-post
- [ ] "Sendt" fjernet fra fri status-dropdown; andre valg beholdt; status-felt skjult når sendt — ingen visningsregresjon
- [ ] Statusstripe venstre på kort (eksisterende farger: #B45309/#047857/#6B7280)
- [ ] Kort-hierarki (primær kunde/prosjekt, sekundær adresse/kontakt) — kun font-weight, ingen ny font
- [ ] Max-width container ~1280px på worklist-card
- [ ] Ingen nye farger/fonter/DB-statuser introdusert
- [ ] Ingen mount-endringer i app.js/server.js. Ingen parseInt på VARCHAR
- [ ] Defensiv `console.warn` i PUT quotes.js når body.status='sent'
- [ ] Verbatim testoutput levert
