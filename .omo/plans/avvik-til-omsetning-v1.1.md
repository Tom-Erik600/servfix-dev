# Avvik til omsetning v1.1 — feilretting + polering

## TL;DR

> **Quick Summary**: Rett rotårsaken bak duplikat-tilbud (knappen reflekterer ikke at ordren har
> tilbud), berik arbeidslista med ordredata Lars trenger (prosjektnavn, besøksadresse,
> kontaktperson), default til arbeidsliste, og poler noen UI-detaljer. ALT additivt.
>
> **Deliverables**:
> - FIX 1: Worklist-GET eksponerer `quote_id` per ordre; avvik.js viser "Rediger tilbud" (deeplink) vs "Lag tilbud" betinget. Backend skiller 400 entydig.
> - FIX 2: Synlig in-modal feilbanner i tilbud.js (eksisterende form-bevaring suppleres).
> - FIX 3: Worklist returnerer + viser prosjektbeskrivelse + besøksadresse + kontaktperson per ordre.
> - P1: Default-visning = Arbeidsliste.
> - P2: Tydelig segmentert toggle.
> - P3: Norske status-etiketter (KUN hvis flere quote-statuser finnes — bindende stopp-sjekk først).
> - P4: Utfallsknapper stablet vertikalt på mobil.
>
> **Estimated Effort**: Medium
> **Parallel Execution**: YES — 2 bølger + verifiseringsbølge
> **Critical Path**: T1 (worklist-GET utvidet) → T3 (avvik.js render) → F1-F4 → din godkjenning

---

## Context

### Original Request
v1 deployet til dev (airtechdev) og manuelt testet. Kjernen virker ende-til-ende. Manuell testing
avdekket: én rotårsak (FIX 1), manglende ordredata for Lars (FIX 3), modal-robusthet (FIX 2),
og fire poleringspunkter (P1–P4).

### Verifiserte fakta (read-first)

**Worklist-GET** (`src/routes/admin/deviations.js:272-367`)
- Returnerer i dag per ordre: `order_id`, `customer_name`, `report_ids[]`, `has_products`, `deviations[]`, `stateCounts`.
- **MANGLER for v1.1**: `quote_id`, prosjektbeskrivelse, besøksadresse, kontaktperson.

**POST quote-from-order** (`deviations.js:600-683`)
- Filtrerer på `quote_id IS NULL` (l.631), 400 ved tomt resultat (l.638).
- Samme generiske 400 for to årsaker — må skilles entydig i FIX 1.

**avvik.js render** (`public/admin/assets/js/avvik.js:187-227`)
- "Lag tilbud"-knapp (l.217) rendres ubetinget. `worklistCreateQuote` (l.246) viser feilmelding i
  `#avvik-worklist-error` ved !res.ok — ingen modal-trigger fra worklist (modal-symptomet kommer
  via deeplink-stien hvis trigget der).

**tilbud.js PUT-flyt** (`tilbud.js:561-643`)
- !response.ok → throw → catch → `showToast` (l.638). Modal lukkes **ikke**, skjema beholdes,
  knapp restaureres i finally. ⇒ FIX 2 er i hovedsak allerede på plass; minimal tilleggssikring
  med synlig in-modal banner (toast er flyktig).

**Ordredata-kilde** (verifisert)
- `orders.customer_name` (kolonne).
- `orders.customer_data->>'physicalAddress'` (JSONB) — brukt av BÅDE admin (`orders.js:51`) og tekniker (`service.js:1262`).
- `orders.description` (kolonne) — prosjekt-/ordrebeskrivelse.
- Kontaktperson: LATERAL JOIN `customer_contacts cc ORDER BY is_report_recipient DESC, id ASC LIMIT 1`
  (`orders.js:74-83`) — admin-konsistent.

**Én ordre = én besøksadresse**: ✅ verifisert (enkeltverdier, ingen array). Plassering i kort-header.

**quote_id-aggregering**: `grp.quote_id = grp.quote_id || r.quote_id` i eksisterende JS-løkke (l.346) — første ikke-null vinner.

### Beslutninger
- FIX 2 holdes minimalt: in-modal banner som supplement til toast (toast forsvinner; banner består).
- P3 er en **bindende stopp-sjekk** i build (jeg kan ikke kjøre DB i plan-modus).
- LATERAL JOIN gjenbrukes 1:1 fra `admin/orders.js:74-83` — ingen ny logikk.

---

## Work Objectives

### Core Objective
Eliminer duplikat-tilbud-rotårsaken, gi Lars ordredata han trenger i arbeidslista, og polere UX
slik at arbeidslista oppleves som standardvisningen den faktisk er — alt additivt.

### Concrete Deliverables
Per task under.

### Definition of Done
Hele leveranse-sjekklista i instruks Seksjon 10 er grønn, verifisert med verbatim testoutput +
manuell dev-verifisering av Tom-Erik.

### Must Have
- Worklist-GET returnerer `quote_id` + `project_description` + `visit_address` + kontaktfelter per ordre.
- Avvik.js viser "Rediger tilbud" (deeplink til tilbud.html) når `quote_id` finnes; "Lag tilbud" ellers.
- Backend skiller 400 entydig: "Ordren har allerede tilbud" vs "Ingen kvalifiserende avvik".
- Frontend håndterer evt. 400 grasiøst (ingen tom modal trigget fra worklist).
- Tilbud-modalen viser synlig in-modal feilbanner ved PUT-feil; skjemainnhold beholdes (allerede sant).
- Ordre-kort viser kunde + prosjektbeskrivelse + besøksadresse + kontaktperson (tom → "—").
- avvik.html laster med Arbeidsliste som default; toggle er tydelig segmentert.
- Status-etiketter rettet ELLER stopp+rapport hvis kun `pending` finnes.
- Utfallsknapper stablet vertikalt på mobil (≤768px), beholder side-ved-side på desktop.
- Endrede ruter montert i app.js OG server.js (gjelder kun hvis ny rute legges til — her endres kun eksisterende).

### Must NOT Have (Guardrails)
- ALDRI parseInt på `orders.id`/`technicians.id` (VARCHAR).
- ALDRI nye quote-statuser i DB. P3 er KUN label-fiks.
- ALDRI omskriving av modal-/worklist-logikk (kun målrettet fiks).
- ALDRI severity-overstyring i felt (V2-kandidat).
- ALDRI manuell fritt-grunnlag-tilbud med ordrevelger (utsatt til v2).
- ALDRI redesign av avvik.html/tilbud.html utover P1-P4.
- ALDRI montere ny rute kun ett sted.
- ALDRI commits.

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: YES (jest + dev-DB via cloud-sql-proxy).
- **Automated tests**: Backend additivt = utvid eksisterende `tests/admin-deviations.test.js`
  (worklist quote_id + project/address/contact, distinct 400). Frontend = statisk verifisering
  (node --check, mønster-troskap) — Tom-Erik tester manuelt i dev (per v1-flyt).

### QA Policy
- **Backend**: enhetstester med mock-pool. Verbatim jest-output som bevis i `.omo/evidence/`.
- **Migrasjon**: Ikke aktuelt — kun route/JS-endringer, ingen DB-schema-endring.
- **Frontend**: `node --check` + mønster-troskap mot lesings-funn. Tom-Erik dev-tester.
- **P3 stopp-sjekk**: SQL mot dev-DB FØR P3-edit. Resultat dokumenteres som bevis.

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Backend additivt — start umiddelbart):
├── T1: deviations.js worklist-GET — quote_id + project_description + visit_address + contact (unspecified-high)
└── T2: deviations.js quote-from-order — entydig 400 + maskinlesbar code (quick)

Wave 2 (Frontend + UX — etter Wave 1):
├── T3: avvik.js renderWorklistOrders — quote_id-betinget knapp + nye ordredata-felter (visual-engineering)
├── T4: avvik.html + avvik.js — default Worklist + segmentert toggle (P1+P2) (quick)
├── T5: tilbud.js — in-modal feilbanner ved PUT-feil (FIX 2) (quick)
├── T6: service.js — utfallsknapper stablet vertikalt på mobil (P4) (quick)
└── T7: tilbud.js — P3 status-etiketter (BLOKKERT av bindende stopp-sjekk først) (quick)

Wave FINAL (etter ALLE tasks — 4 parallelle reviews, så din godkjenning):
├── F1: Plan-compliance audit (oracle)
├── F2: Kodekvalitet (unspecified-high)
├── F3: Reell manuell QA — Tom-Erik gjør dette (no-op her; Tom-Erik tester i dev)
└── F4: Scope-troskap (deep)

Critical Path: T1 → T3 → F1-F4 → godkjenning
Parallel Speedup: ~50% vs sekvensielt
Max Concurrent: 5 (Wave 2)
```

### Dependency Matrix

- **T1**: avh. ingen → blokkerer T3
- **T2**: avh. ingen → blokkerer T3
- **T3**: avh. T1, T2 → blokkerer ingen
- **T4**: avh. ingen → blokkerer ingen
- **T5**: avh. ingen → blokkerer ingen
- **T6**: avh. ingen → blokkerer ingen
- **T7**: avh. ingen (men bindende stopp-sjekk SQL kjøres først) → blokkerer ingen

### Agent Dispatch Summary
- **Wave 1**: T1→`unspecified-high`, T2→`quick`
- **Wave 2**: T3→`visual-engineering`, T4-T7→`quick`
- **FINAL**: F1→`oracle`, F2→`unspecified-high`, F3→Tom-Erik, F4→`deep`

---

## TODOs

- [ ] 1. `src/routes/admin/deviations.js` — Worklist-GET utvidet med quote_id + ordredata

  **What to do**:
  - Utvid SELECT i `GET /worklist` (l.292-322) ADDITIVT:
    - `d.quote_id` AS `quoteId` (per rad).
    - `o.description` AS `orderDescription` (per rad — samme for hver avvik på ordren).
    - `o.customer_data->>'physicalAddress'` AS `visitAddress`.
    - `pc.name` AS `contactName`, `pc.phone` AS `contactPhone`, `pc.email` AS `contactEmail` — via
      LATERAL JOIN KOPIERT 1:1 fra `src/routes/admin/orders.js:74-83`:
      ```sql
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
      ```
  - I JS-aggregeringsløkken (l.336-358), legg til på `grp`-objektet ved første rad per ordre:
    `project_description, visit_address, contact_name, contact_phone, contact_email, quote_id: null`.
    Deretter i løkken: `if (r.quoteId && !grp.quote_id) grp.quote_id = r.quoteId;` (første ikke-null vinner).
  - Respons-kontrakt (additivt — eksisterende felter uendret):
    ```json
    {
      "counters": {...},
      "orders": [{
        "order_id": "...", "customer_name": "...", "report_ids": [...], "has_products": ...,
        "deviations": [...], "stateCounts": {...},
        "quote_id": "QUOTE-..." | null,
        "project_description": "..." | null,
        "visit_address": "..." | null,
        "contact_name": "..." | null,
        "contact_phone": "..." | null,
        "contact_email": "..." | null
      }]
    }
    ```

  **Must NOT do**: Ikke parseInt på `order_id`. Ikke endre eksisterende felter. Ikke endre filter-WHERE.

  **Recommended Agent Profile**: `unspecified-high` — sammensatt SQL med LATERAL JOIN-gjenbruk.

  **Parallelization**: Wave 1 · Blocks: T3 · Blocked By: None.

  **References**:
  - `src/routes/admin/deviations.js:272-367` — worklist-GET (innstikkspunkter).
  - `src/routes/admin/orders.js:74-83` — LATERAL JOIN-mønster å kopiere 1:1.
  - `src/routes/admin/orders.js:51` — `customer_data->>'physicalAddress' as delivery_address` (samme pattern).
  - `public/app/assets/js/service.js:1261-1266` — tekniker-side bekrefter samme datafelter.

  **Acceptance Criteria**:
  - [ ] Utvid eksisterende `tests/admin-deviations.test.js` worklist-test til å assertere de nye feltene i respons.
  - [ ] Test: rad med `quote_id` satt → `grp.quote_id` = den verdien.
  - [ ] Test: to rader på samme ordre, første med null, andre med satt → `grp.quote_id` = andres verdi.
  - [ ] Verbatim testoutput.

  **QA Scenarios**:
  ```
  Scenario: Worklist returnerer nye felter (happy)
    Tool: Bash (curl) + SQL seed (utføres av Tom-Erik i dev)
    Steps:
      1. Sett quote_id på et avvik via SQL.
      2. curl GET /api/admin/deviations/worklist -b <admin>.
    Expected Result: tilhørende ordre har quote_id satt og project_description/visit_address/contact_name fra ordren.
    Evidence: .omo/evidence/task-1-worklist-extended.json (Tom-Erik manuell test)
  ```

  **Commit (forslag)**: `feat(admin/deviations): expose quote_id + order metadata in worklist` · fil: `src/routes/admin/deviations.js` (+ test)

- [ ] 2. `src/routes/admin/deviations.js` — Entydig 400 i quote-from-order

  **What to do**:
  - I `POST /quote-from-order/:orderId` (l.600-683), splitt den eksisterende 400-sjekken (l.636-639) i to:
    1. Eget for-spørring: `SELECT 1 FROM deviations d JOIN service_reports sr ON sr.id = d.opened_in_report_id WHERE sr.order_id=$1 AND d.outcome='wants_quote' AND d.outcome_handled_at IS NULL AND d.quote_id IS NOT NULL LIMIT 1` for å oppdage "har allerede tilbud".
    2. Hvis treff → 400 med `{ error: 'Ordren har allerede et tilbud', code: 'ALREADY_QUOTED' }`.
    3. Hvis ikke, og hovedfilteret returnerer tomt → 400 med `{ error: 'Ingen kvalifiserende avvik (ønsker tilbud) for denne ordren', code: 'NO_QUALIFYING_DEVIATIONS' }`.
  - Maskinlesbar `code` lar frontend håndtere de to grasiøst uten å parse fritekst.
  - Alt annet i endepunktet uendret (transaksjon, INSERT, UPDATE av quote_id).

  **Must NOT do**: Ikke endre transaksjonslogikk eller INSERT/UPDATE. Ikke parseInt på orderId.

  **Recommended Agent Profile**: `quick` — to-grenet validering.

  **Parallelization**: Wave 1 · Blocks: T3 (frontend leser code) · Blocked By: None.

  **References**:
  - `src/routes/admin/deviations.js:600-683` — endepunktet (innstikkspunkt l.636).

  **Acceptance Criteria**:
  - [ ] Test: alle wants_quote har quote_id → 400 med `code:'ALREADY_QUOTED'`.
  - [ ] Test: ingen wants_quote → 400 med `code:'NO_QUALIFYING_DEVIATIONS'`.
  - [ ] Test: gyldig opprettelse → 201 (regresjon).
  - [ ] Verbatim testoutput.

  **Commit (forslag)**: `feat(admin/deviations): distinguish already-quoted from no-deviations (400 code)` · fil: `src/routes/admin/deviations.js` (+ test)

- [ ] 3. `public/admin/assets/js/avvik.js` — Betinget knapp + ordredata på kort

  **What to do**:
  - I `renderWorklistOrders` (l.187-227):
    1. Knapp-rendering (l.217-218): bytt fra ubetinget "Lag tilbud" til:
       ```js
       o.quote_id
         ? `<button class="avvik-btn avvik-btn-primary" type="button" onclick="_avvikWorklistEditQuote('${escHtml(o.quote_id)}')">Rediger tilbud</button>`
         : `<button class="avvik-btn avvik-btn-primary" type="button" onclick="_avvikWorklistCreateQuote('${escHtml(o.order_id)}')">Lag tilbud</button>`
       ```
    2. Ordre-kort-header (l.212-215): legg til prosjektbeskrivelse + besøksadresse + kontaktperson
       som egne linjer (kompakt). Mønster:
       ```js
       <div style="font-size:13px; color:#374151; margin-top:4px;">
         ${o.project_description ? `<div>${escHtml(o.project_description)}</div>` : ''}
         <div>📍 ${escHtml(o.visit_address || '—')}</div>
         <div>👤 ${escHtml(o.contact_name || '—')}${o.contact_phone ? ` · ${escHtml(o.contact_phone)}` : ''}</div>
       </div>
       ```
       Tomme felter → "—" (aldri ødelagt rad).
  - Legg til global handler:
    ```js
    window._avvikWorklistEditQuote = (quoteId) => {
      window.location.href = `/admin/tilbud.html?openQuote=${encodeURIComponent(quoteId)}`;
    };
    ```
    Plasseres ved siden av eksisterende `_avvikWorklist*`-handlers (l.429-432).
  - Oppdater `worklistCreateQuote` (l.246-266) for entydig 400-håndtering: ved !res.ok, parse
    `body.code`. Hvis `ALREADY_QUOTED` → re-fetch worklist (slik at knappen oppdateres til "Rediger tilbud").
    Hvis annet → vis `body.error` i `#avvik-worklist-error` som i dag.

  **Must NOT do**: Ikke endre andre worklist-handlers (Ikke aktuelt, Håndtert, Se rapport). Ikke
  parseInt på `order_id`/`quote_id`. Ikke åpne modal direkte i avvik.js (deeplink-mønsteret beholdes).

  **Recommended Agent Profile**: `visual-engineering` — UI-render + state-betinget knapp + ordredata-felter.

  **Parallelization**: Wave 2 · Blocks: ingen · Blocked By: T1, T2.

  **References**:
  - `public/admin/assets/js/avvik.js:187-227` — render-funksjon.
  - `:246-266` — worklistCreateQuote.
  - `:429-432` — handler-registrering.
  - Worklist-respons fra T1 + 400-kontrakt fra T2.

  **Acceptance Criteria**:
  - [ ] Statisk: `node --check` grønn.
  - [ ] Statisk: ny handler `_avvikWorklistEditQuote` registrert globalt.
  - [ ] Statisk: knapp rendres betinget av `o.quote_id` (grep-bekreftet).
  - [ ] Tom-Erik dev-test: ordre uten tilbud viser "Lag tilbud"; etter opprettelse oppdateres til "Rediger tilbud" som åpner riktig tilbud.

  **Commit (forslag)**: `feat(admin/avvik): conditional edit/create button + order metadata on worklist cards` · fil: `public/admin/assets/js/avvik.js`

- [ ] 4. `public/admin/avvik.html` + `avvik.js` — Default Worklist + segmentert toggle (P1+P2)

  **What to do**:
  - **avvik.js**: i `initialize()` (l.54-58), kall `showView('worklist')` etter `loadDeviations()`
    (eller modifiser slik at default-tilstand er worklist uten å bryte refresh-knappen).
    Enkleste: ETTER `setupEventListeners()` + `loadDeviations()`, kall `showView('worklist')` som
    siste linje i `initialize()`.
  - **avvik.html**: stylesett de to toggle-knappene (`#view-list-btn`, `#view-worklist-btn`) som
    segmentert toggle:
    - Inline-stil eller minimal CSS-blokk i `<style>`-seksjonen: én container med
      `border:1px solid #D1D5DB; border-radius:8px; overflow:hidden;`, hver knapp uten egen border,
      aktiv knapp med bakgrunn `#1F2937` + hvit tekst, inaktiv med hvit bakgrunn + grå tekst.
    - I avvik.js `showView` (l.279-291): juster klasse-toggling tilsvarende (allerede setter
      `avvik-btn-primary`/`avvik-btn-outline` — beholdes; bare segmentert wrapper rundt + styling).
  - Hold rent layout-/CSS-arbeid — ingen logikkendring utover default-view.

  **Must NOT do**: Ikke endre worklist-/list-renderfunksjoner. Ikke endre filter-/eksport-knapper.

  **Recommended Agent Profile**: `quick` — kun init-linje + CSS/markup-justering.

  **Parallelization**: Wave 2 · Blocks: ingen · Blocked By: None.

  **References**:
  - `public/admin/assets/js/avvik.js:54-58` (initialize), `:279-291` (showView).
  - `public/admin/avvik.html:239-241` (hero-knapper).

  **Acceptance Criteria**:
  - [ ] Statisk: `initialize()` ender med `showView('worklist')`.
  - [ ] Statisk: segmentert wrapper-element rundt toggle-knappene (grep-bekreftet).
  - [ ] Tom-Erik dev-test: avvik.html laster med arbeidsliste vist; toggle leser som ett valg, ikke to handlinger.

  **Commit (forslag)**: `feat(admin/avvik): default to worklist view + segmented toggle` · filer: `public/admin/avvik.html`, `public/admin/assets/js/avvik.js`

- [ ] 5. `public/admin/assets/js/tilbud.js` — In-modal feilbanner ved PUT-feil (FIX 2)

  **What to do**:
  - I `openEditModal` (l.409+), legg til ETT skjult `<div id="edit-quote-error" style="display:none; ...">` øverst i `formContainer.innerHTML`-malen — bare et tomt feilbanner-element med stil for synlighet.
  - I `saveBtn.onclick` catch-block (l.636-642): FØR `showToast(...)`-kallet, sett
    ```js
    const errBanner = document.getElementById('edit-quote-error');
    if (errBanner) { errBanner.textContent = `Lagring feilet: ${error.message}`; errBanner.style.display = 'block'; }
    ```
  - I starten av `saveBtn.onclick` (l.561-566), nullstill banneret: `errBanner.style.display='none'; errBanner.textContent='';`
  - showToast beholdes (kortvarig + global feedback). Banner består til neste lagre-forsøk eller modal-lukking.
  - Modal lukkes IKKE ved feil (allerede sant — ingen endring der).

  **Must NOT do**: Ikke endre suksess-stien. Ikke endre PUT-kontrakten. Ikke tøm `formContainer` ved feil.

  **Recommended Agent Profile**: `quick` — ett banner-element + to event-grener.

  **Parallelization**: Wave 2 · Blocks: ingen · Blocked By: None.

  **References**:
  - `public/admin/assets/js/tilbud.js:561-643` — saveBtn-flyt.
  - `:409-559` — openEditModal/innerHTML-mal.

  **Acceptance Criteria**:
  - [ ] Statisk: `<div id="edit-quote-error">` finnes i innerHTML-malen.
  - [ ] Statisk: banner settes ved catch + nullstilles ved start av onclick.
  - [ ] Tom-Erik dev-test: simuler 500 → banner synlig, skjema beholdt, modal åpen.

  **Commit (forslag)**: `feat(admin/tilbud): in-modal error banner on save failure` · fil: `public/admin/assets/js/tilbud.js`

- [ ] 6. `public/app/assets/js/service.js` — Utfallsknapper stablet vertikalt på mobil (P4)

  **What to do**:
  - I `outcomeChoiceHTML(itemId)` (innført i v1, gated til OUTCOME_ITEM_TYPES):
    finn den container-div'en med `display:flex; gap:8px;` og endre `flex-wrap:wrap` til
    bruk av media query via inline-stil eller liten CSS-klasse: knappene skal stables under 768px.
  - Enkleste tilnærming: bruk en CSS-klasse `outcome-choice-stack` på containeren, og injiser én
    `<style>`-blokk i samme JS-fil eller bruk eksisterende CSS:
    - Container: `flex-direction:row` (default).
    - Media: `@media (max-width:768px) { .outcome-choice-stack { flex-direction:column; align-items:stretch; } .outcome-choice-stack .outcome-btn { width:100%; } }`
  - Plassering av CSS: enten i én eksisterende stilark eller injisert via en lett `<style>`-streng
    i en init-funksjon (foreslår injisering hvis ingen stilark er passende — én engangs-injeksjon ved init).

  **Must NOT do**: Ikke endre lagre-/serialiseringslogikk. Ikke endre hvilke knapper som finnes eller hva de gjør.

  **Recommended Agent Profile**: `quick` — CSS-/layout-justering.

  **Parallelization**: Wave 2 · Blocks: ingen · Blocked By: None.

  **References**:
  - `public/app/assets/js/service.js` — `outcomeChoiceHTML` (søk på "outcome-choice").

  **Acceptance Criteria**:
  - [ ] Statisk: container har klasse `outcome-choice-stack` (eller tilsvarende).
  - [ ] Statisk: media-query for ≤768px finnes.
  - [ ] Tom-Erik dev-test (mobil viewport): knappene stables vertikalt; desktop uendret.

  **Commit (forslag)**: `style(service): stack outcome buttons vertically on mobile` · fil: `public/app/assets/js/service.js`

- [ ] 7. `public/admin/assets/js/tilbud.js` — P3 status-etiketter (BLOKKERT av stopp-sjekk)

  **What to do**:
  - **BINDENDE STOPP-SJEKK FØRST**: utfører kjører:
    ```bash
    psql -h localhost -p 5434 -U postgres -d airtech_db -c "SELECT DISTINCT status FROM quotes ORDER BY status;"
    ```
    (eller via node-helper).
    - Hvis resultatet KUN inneholder `pending` → **STOPP og rapporter til Tom-Erik**. Ikke
      bygg videre. Det er livsløps-diskusjon for v2.
    - Hvis flere statuser finnes (sent/accepted/rejected/...) → fortsett:
  - I `getStatusText` (tilbud.js:249-259), rett norske etiketter:
    - `pending` → "Under arbeid"
    - `sent` → "Sendt – venter på kunde"
    - `accepted` → "Godkjent" (uendret)
    - `rejected_customer` → "Avvist av kunde" (uendret)
    - `rejected_admin` → "Avvist av admin" (uendret)
    - `rejected` → "Avvist" (uendret)
  - I edit-modal status-select (tilbud.js:427-434), oppdater synlige etiketter tilsvarende
    (sjekk at VALUE-attributtene IKKE endres — kun synlig tekst).
  - Verifiser at samme status-strenger ikke brukes andre steder (grep).

  **Must NOT do**: Ikke endre value-strenger. Ikke legge til nye statuser. Ikke endre DB.

  **Recommended Agent Profile**: `quick` — ren label-fiks.

  **Parallelization**: Wave 2 · Blocks: ingen · Blocked By: Stopp-sjekk-resultat.

  **References**:
  - `public/admin/assets/js/tilbud.js:249-259` (getStatusText), `:427-434` (status-options).

  **Acceptance Criteria**:
  - [ ] Stopp-sjekk-resultat dokumentert som bevis (SQL-output verbatim).
  - [ ] Statisk: kun synlige tekster endret; VALUE-strenger uendret.
  - [ ] Statisk grep: status-strenger ikke duplisert annet sted (eller alle steder oppdatert).
  - [ ] Tom-Erik dev-test: tilbudslista viser nye etiketter; edit-modal viser nye etiketter; ingen status-relatert logikk brutt.

  **Commit (forslag)**: `feat(admin/tilbud): clearer Norwegian quote status labels` · fil: `public/admin/assets/js/tilbud.js`

---

## Final Verification Wave (etter ALLE tasks — ALLE må APPROVE)

> Ikke kryss av F1–F4 før Tom-Eriks eksplisitte "okay". Verbatim bevis fra `.omo/evidence/`.

- [ ] F1. **Plan-compliance** — `oracle`
  Les v1.1-planen + instruksen. For hver "Must Have": verifiser at den finnes. For hver "Must NOT
  Have": søk forbudt mønster (parseInt på VARCHAR, nye DB-statuser, omskriving, ut-av-scope). Sjekk
  at endrede ruter ikke trenger ny montering (kun eksisterende endepunkter utvides).
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Kodekvalitet** — `unspecified-high`
  Kjør `npx jest tests/admin-deviations.test.js tests/deviations-service.test.js` — alle må passere.
  Gjennomgå diff for AI-slop, ubrukte imports, omskriving forkledd som fiks.
  Output: `Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Manuell QA** — `Tom-Erik` (dev)
  Per v1-flyten: Tom-Erik tester manuelt i dev. Tester ENDE-TIL-ENDE:
  1. Lag tilbud fra arbeidslista → kort oppdateres til "Rediger tilbud".
  2. Klikk "Rediger tilbud" → tilbud.html åpner med modalen på riktig tilbud.
  3. Forsøk lagre med ugyldig data → in-modal banner vises, skjema beholdt.
  4. avvik.html laster på Arbeidsliste; toggle leses som valg.
  5. Ordre-kort viser kunde + prosjekt + adresse + kontakt; tomme felter → "—".
  6. Mobilvisning av service: utfallsknapper stablet.
  7. P3 status-etiketter (hvis bygget) leselige.
  Output: Tom-Eriks dev-test-rapport.

- [ ] F4. **Scope-troskap** — `deep`
  For hver task: les "Hva skal gjøres" vs faktisk diff. Verifiser 1:1. Flagg ut-av-scope-bygging
  (severity-felt, nye statuser, manuell fritt-grunnlag, redesign).
  Output: `Tasks [N/N compliant] | Unaccounted [CLEAN/N] | VERDICT`

---

## Commit Strategy

Tom-Erik eier alle commits via `git add -p`. Hver task leverer:
- Per-fil diff-oversikt.
- Foreslått commit-melding (Conventional Commits).
- Verbatim test-/verifiseringsoutput.

Foreslåtte commits (gruppert per task):

```
feat(admin/deviations): expose quote_id + order metadata in worklist
feat(admin/deviations): distinguish already-quoted from no-deviations (400 code)
feat(admin/avvik): conditional edit/create button + order metadata on cards
feat(admin/avvik): default to worklist view + segmented toggle
feat(admin/tilbud): in-modal error banner on save failure
style(service): stack outcome buttons vertically on mobile
feat(admin/tilbud): clearer Norwegian quote status labels   # KUN hvis stopp-sjekk grønn
```

---

## Success Criteria

### Verification Commands
```bash
# Backend regresjon
npx jest tests/admin-deviations.test.js tests/deviations-service.test.js
# P3 stopp-sjekk (FØR T7)
psql -h localhost -p 5434 -U postgres -d airtech_db -c "SELECT DISTINCT status FROM quotes ORDER BY status;"
# Syntakssjekk frontend
node --check public/admin/assets/js/avvik.js
node --check public/admin/assets/js/tilbud.js
node --check public/app/assets/js/service.js
```

### Final Checklist (instruks Seksjon 10)
- [ ] Worklist-GET returnerer quote_id + prosjektbeskrivelse + besøksadresse + kontaktperson.
- [ ] Ordre med tilbud viser "Rediger tilbud" (deeplink).
- [ ] Ordre uten tilbud viser "Lag tilbud" som før.
- [ ] Gjentatt opprettelse umulig fra UI; evt. 400 håndteres grasiøst.
- [ ] Lagre-feil beholder skjemainnhold + viser melding (in-modal banner).
- [ ] Ordre-kort viser kunde + prosjekt + adresse + kontakt (tom → "—").
- [ ] avvik.html default Arbeidsliste; toggle tydelig.
- [ ] Status-etiketter rettet (eller stoppet+rapportert).
- [ ] Utfallsknapper stablet på mobil.
- [ ] Endrede ruter krever ingen ny montering (kun eksisterende utvides).
- [ ] Ingen parseInt på VARCHAR. Ingen nye DB-statuser.
- [ ] Verbatim testoutput levert.
