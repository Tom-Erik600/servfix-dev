# v1.4 Avvik til omsetning — tilbudsstatus + dashboard

## TL;DR

> **Quick Summary**: To workstreams. Del A: dedikerte «Godkjent av kunde»/«Avvist av kunde»-knapper i
> tilbudsmodalen, konsistent med v1.2 mark-as-sent-mønsteret. Del B: to nye KPI-bokser på dashboard
> som synliggjør avvik-til-omsetning-pipelinen. Ingen ordregenerering, ingen nye DB-kolonner
> (approved_at finnes allerede), ingen nye farger.
>
> **Deliverables**:
> - `POST /api/quotes/:quoteId/mark-accepted` — setter `status='accepted'` + `approved_at=NOW()`
> - `POST /api/quotes/:quoteId/mark-rejected-customer` — setter `status='rejected_customer'`
> - Knapper med bekreft-dialog + toast i `tilbud.js` (vises kun for sendte, ubesvarte tilbud)
> - `accepted` + `rejected_customer` fjernet fra fri status-dropdown (A3)
> - Dashboard: «Tilbud venter på kunde» (klikk → tilbud.html) — ingen ny fetch
> - Dashboard: «Servicer med uhåndterte avvik» (klikk → avvik.html) — én fetch til i Promise.all
>
> **Parallel Execution**: Wave 1 (T1+T2 backend, T3 frontend-A, T4 dashboard) parallelt

---

## Context

### Original Request
v1.4 av "Avvik til omsetning". To deler: Del A — tilbudsstatus-knapper (godkjent/avvist av kunde),
Del B — dashboard-pipeline KPI-bokser. Arbeidsmodus: PLAN → vent på godkjenning → BUILD → rapporter.

### Read-first Summary

| Punkt | Fil:linje | Funn |
|-------|-----------|------|
| mark-as-sent mønster | `quotes.js:407-436` | Eksakt mønster for A1/A2 (SELECT 1 → 404, UPDATE RETURNING, respons) |
| approved_at kolonne | DB-sjekk | FINNES — `approved_at timestamp nullable`. A1 setter den. |
| PUT defensiv warn | `quotes.js:189-191` | Gjenbruk samme warn-mønster for nye statuser |
| rejectQuote | `tilbud.js:399-421` | Setter `rejected_admin` via PUT — "admin trakk tilbud" — SEPARAT fra `rejected_customer` |
| Knapp-betingelser | `tilbud.js:160-187` | Send/Marker-sendt vises for pending\|\|rejected; Avvis for ≠accepted&&≠rejected_customer |
| Status-badges | `tilbud.css:537-549` | `status-accepted` grønn, `status-rejected_customer` rød — FINNES ALLEREDE |
| A3 sikkerhetsventil | `tilbud.js:501` | C2 skjuler status-felt når `sent_to_customer===true` → accepted/rejected_customer alltid skjult |
| Dashboard Promise.all | `dashboard.js:12-18` | 5 fetches; quotes allerede hentet |
| populateKpiCards | `dashboard.js:136-251` | Beregner fra array; kaller `updateKpiElement` |
| makeKpiCardsClickable | `dashboard.js:253-304` | Per-ID cursor+click+hover pattern |
| B1 datakilde | `dashboard.js:241-243` | quotes-array allerede tilgjengelig — ingen ny fetch |
| B2 datakilde | — | worklist IKKE i Promise.all → legg til som 6. fetch |

---

## Key Decisions

### A2 — "Avvist av kunde" vs eksisterende "Avvis"
**Bekreftet SEPARATE:**
- Eksisterende "Avvis"-knapp (`rejectQuote`) → `rejected_admin` = "admin trakk tilbudet"
- Ny "Avvist av kunde" → `rejected_customer` = "kunden svarte nei"
Ingen sammenslåing. Begge knapper kan vises på sendte tilbud (admin kan trekke et tilbud kunde ikke har besvart ennå).

### A1 — approved_at
`approved_at`-kolonnen finnes i DB (`migrations/000-base-schema.sql` + bekreftet via `\d quotes`).
`mark-accepted` setter `status='accepted', approved_at=CURRENT_TIMESTAMP` i én UPDATE. Ingen ny kolonne.

### A3 — dropdown etter fjerning
| Status | Handling | Begrunnelse |
|--------|---------|-------------|
| `pending` | BEHOLDES | Ingen dedikert endpoint-knapp |
| `rejected` | BEHOLDES | Ingen dedikert endpoint (eksisterende "Avvis" bruker fri PUT) |
| `rejected_admin` | BEHOLDES | Ingen dedikert endpoint |
| `accepted` | FJERNES | Dedikert knapp A1 |
| `rejected_customer` | FJERNES | Dedikert knapp A2 |

**Ingen visningsregresjon:** C2 (v1.2) skjuler status-feltet for `sent_to_customer===true`. Alle tilbud med `accepted`/`rejected_customer` er sendt → status-feltet er allerede skjult → dropdown vises aldri for disse.

### Ny knappevisning for sendte tilbud
Ny betingelses-tabell for `action-buttons-modern`:

| Knapp | Ny betingelse |
|-------|--------------|
| Send til kunde | `pending \|\| rejected` (uendret) |
| Marker som sendt | `pending \|\| rejected` (uendret) |
| **Godkjent av kunde** (ny) | `sent_to_customer === true && status === 'sent'` |
| **Avvist av kunde** (ny) | `sent_to_customer === true && status === 'sent'` |
| Avvis (admin) | `status !== 'accepted' && status !== 'rejected_customer'` (uendret) |

### B2 — Promise.all utvidelse
Legg til `fetch('/api/admin/deviations/worklist', { credentials: 'include' })` som 6. element
i `Promise.all`. Fallback: `if (!worklistResponse.ok) worklistData = { orders: [] }`. Count = `worklistData.orders?.length || 0`. Dette er samme fetch-mekanisme — bare én til i arrayen.

---

## Work Objectives

### Must Have
- `POST /api/quotes/:quoteId/mark-accepted` setter `status='accepted'` + `approved_at=NOW()`; 404 on missing; 200 med respons
- `POST /api/quotes/:quoteId/mark-rejected-customer` setter `status='rejected_customer'`; 404 on missing; 200
- Begge endepunkter i SAMME filer-mont-mønster som `mark-as-sent` (kun quotes.js, ingen nye app.js/server.js-endringer — eksisterende mount)
- «Godkjent av kunde»-knapp: vis kun for `sent_to_customer===true && status==='sent'`; confirm-dialog; toast; loadData()
- «Avvist av kunde»-knapp: samme betingelse; confirm-dialog; toast; loadData()
- `accepted` + `rejected_customer` fjernet fra status-dropdown; `pending`/`rejected`/`rejected_admin` beholdt
- dashboard.html: to nye `<div class="card kpi-card">` med IDs `kpi-tilbud-hos-kunde` og `kpi-avvik-uhåndtert`
- dashboard.js Promise.all: 6 fetches (worklist lagt til)
- `populateKpiCards`: beregner begge nye KPI-tall; kaller `updateKpiElement`
- `makeKpiCardsClickable`: to nye klikkbare bokser (tilbud.html + avvik.html)

### Must NOT Have
- INGEN ordregenerering/ny ordre ved godkjenning (eksplisitt v2-grense)
- INGEN nye DB-kolonner (approved_at finnes allerede)
- INGEN nye farger eller CSS-klasser (badge-klasser finnes allerede)
- INGEN parseInt på VARCHAR (quoteId er VARCHAR)
- INGEN commits fra agent
- INGEN separate fetch-kall utenfor Promise.all for B2
- INGEN endring av eksisterende "Avvis"-knapp (rejectQuote → rejected_admin)
- INGEN sammenslåing av "Avvist av kunde" og eksisterende "Avvis"
- INGEN ny app.js/server.js mount (quotes.js er allerede mountet på server.js:328)
- INGEN endring av eksisterende `kpi-tilbud-venter` (utenfor scope)

---

## Execution Strategy

```
Wave 1 (3 parallelle — ulike filer):
├── T1: src/routes/quotes.js — mark-accepted + mark-rejected-customer endepunkter
├── T2: public/admin/assets/js/tilbud.js — Del A knapper + A3 dropdown-fjerning
└── T3: public/admin/dashboard.html + dashboard.js — Del B KPI-bokser

Wave FINAL (2 parallelle):
├── F1: Plan-compliance + regression (oracle)
└── F2: Scope fidelity + QA-sjekkliste (unspecified-high)
→ Vis resultater → Vent på Tom-Eriks «okay»
```

### Dependency Matrix

| Task | Depends On | Blocks |
|------|------------|--------|
| T1 | — | F1, F2 |
| T2 | — | F1, F2 |
| T3 | — | F1, F2 |
| F1, F2 | T1-T3 | user okay |

---

## TODOs

- [ ] 1. `src/routes/quotes.js`: Nye endepunkter `mark-accepted` + `mark-rejected-customer`

  **What to do**:

  **A1 — `POST /:quoteId/mark-accepted`:**
  Plasser rett etter `mark-as-sent`-ruten (linje 407-436), FØR `send-to-customer` (linje 438).
  Mønster: identisk med `mark-as-sent` (linje 407-436), men:
  - UPDATE: `UPDATE quotes SET status='accepted', approved_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING approved_at`
  - Respons: `{ success:true, quoteId, status:'accepted', approved_at: result.rows[0].approved_at }`
  - console.error: `mark-accepted failed for ${quoteId}:`

  **A2 — `POST /:quoteId/mark-rejected-customer`:**
  Plasser rett etter A1-ruten. Mønster: identisk med `mark-as-sent`, men:
  - UPDATE: `UPDATE quotes SET status='rejected_customer' WHERE id=$1`
  - Respons: `{ success:true, quoteId, status:'rejected_customer' }`
  - console.error: `mark-rejected-customer failed for ${quoteId}:`

  Legg til defensiv `console.warn` i PUT-handleren (linje 189-191 har allerede warn for 'sent').
  Etter eksisterende linje 190, legg til:
  ```js
  if (status === 'accepted') {
      console.warn(`[WARN] PUT /api/quotes/${id} satt status='accepted' direkte. Bruk POST /api/quotes/${id}/mark-accepted.`);
  }
  if (status === 'rejected_customer') {
      console.warn(`[WARN] PUT /api/quotes/${id} satt status='rejected_customer' direkte. Bruk POST /api/quotes/${id}/mark-rejected-customer.`);
  }
  ```

  **Must NOT do**:
  - Ingen parseInt på `quoteId` — VARCHAR
  - Ingen ny mount i app.js/server.js (eksisterende mount på server.js:328 dekker det)
  - Ingen e-post/PDF-generering
  - Ingen ny ordre opprettes
  - Ingen ny DB-kolonne — `approved_at` finnes allerede

  **Recommended Agent Profile**: `unspecified-low`

  **Parallelization**: Wave 1, parallelt med T2, T3.

  **References**:
  - Mønster: `src/routes/quotes.js:407-436` (`mark-as-sent`)
  - Schema: `migrations/000-base-schema.sql:285-297` (quotes-kolonner inkl. approved_at)
  - PUT warn: `src/routes/quotes.js:189-191`

  **Acceptance Criteria**:
  - [ ] `POST /api/quotes/:quoteId/mark-accepted` → 200 `{ success:true, quoteId, status:'accepted', approved_at }`
  - [ ] `POST /api/quotes/:quoteId/mark-rejected-customer` → 200 `{ success:true, quoteId, status:'rejected_customer' }`
  - [ ] Begge → 404 `{ error: 'Tilbud ikke funnet' }` for ukjent quoteId
  - [ ] DB: `accepted` quote har `status='accepted'` og `approved_at IS NOT NULL`
  - [ ] DB: `rejected_customer` quote har `status='rejected_customer'`
  - [ ] Defensive warns lagt til i PUT for begge statuser
  - [ ] Ingen parseInt på quoteId noe sted i de nye rutene

  **Commit**: NO

- [ ] 2. `public/admin/assets/js/tilbud.js`: Del A knapper + A3 dropdown

  **What to do**:

  **A1/A2 — Nye handler-funksjoner** (legg til etter `window.markQuoteAsSent`, ca. linje 397):
  ```js
  window.acceptQuote = async function(quoteId) {
      if (!confirm('Marker tilbudet som godkjent av kunde?')) return;
      try {
          const response = await fetch(`/api/quotes/${quoteId}/mark-accepted`, {
              method: 'POST', credentials: 'include'
          });
          if (!response.ok) {
              const error = await response.json().catch(() => ({}));
              throw new Error(error.error || `Serverfeil: ${response.status}`);
          }
          showToast('Tilbud godkjent av kunde', 'success');
          await loadData();
      } catch (error) {
          console.error('Error accepting quote:', error);
          showToast('Feil: ' + error.message, 'error');
      }
  };

  window.rejectQuoteByCustomer = async function(quoteId) {
      const quote = allQuotes.find(q => q.id === quoteId);
      if (!confirm(`Marker tilbudet som avvist av ${quote?.customer?.name || 'kunde'}?`)) return;
      try {
          const response = await fetch(`/api/quotes/${quoteId}/mark-rejected-customer`, {
              method: 'POST', credentials: 'include'
          });
          if (!response.ok) {
              const error = await response.json().catch(() => ({}));
              throw new Error(error.error || `Serverfeil: ${response.status}`);
          }
          showToast('Tilbud avvist av kunde', 'success');
          await loadData();
      } catch (error) {
          console.error('Error rejecting quote by customer:', error);
          showToast('Feil: ' + error.message, 'error');
      }
  };
  ```

  **A1/A2 — Nye knapper i action-buttons-modern** (linje 160-187):
  Legg til ETTER "Marker som sendt"-blokken (linje 172-176), FØR "Avvis"-blokken (linje 177-181):
  ```js
  ${quote.sent_to_customer === true && quote.status === 'sent' ? `
      <button class="btn-modern btn-accept-customer" onclick="acceptQuote('${quote.id}')">
          ✅ Godkjent av kunde
      </button>
      <button class="btn-modern btn-reject-customer" onclick="rejectQuoteByCustomer('${quote.id}')">
          ❌ Avvist av kunde
      </button>
  ` : ''}
  ```
  Bruk eksisterende klasser `btn-accept-customer` og `btn-reject-customer` fra tilbud.css (de finnes allerede — sjekk linje ~1089-1111), ELLER bruk `btn-mark-sent` (grønn) for godkjent og `btn-reject` (rød) for avvist hvis de spesifikke klassene ikke finnes.

  **A3 — Fjern fra status-dropdown** (linje 512-517):
  Fjern disse to option-linjene:
  ```js
  <option value="accepted" ${quote.status === 'accepted' ? 'selected' : ''}>Godkjent</option>
  <option value="rejected_customer" ${quote.status === 'rejected_customer' ? 'selected' : ''}>Avvist av kunde</option>
  ```
  BEHOLD: `pending`, `rejected`, `rejected_admin`.

  **Must NOT do**:
  - Ikke endre `rejectQuote`-funksjonen (setter rejected_admin — separat)
  - Ikke endre eksisterende knapp-betingelser
  - Ikke parseInt på quoteId
  - Ikke endre `statusMap` (alle 6 statuser skal vises i liste-badge)
  - Ikke endre sent-status-badge (linje 150-157)

  **Recommended Agent Profile**: `unspecified-high`

  **Parallelization**: Wave 1, parallelt med T1, T3.

  **References**:
  - action-buttons-modern: `tilbud.js:160-187`
  - markQuoteAsSent (mønster): `tilbud.js:373-397`
  - Status-dropdown: `tilbud.js:511-519`
  - rejectQuote (røres ikke): `tilbud.js:399-421`

  **Acceptance Criteria**:
  - [ ] «Godkjent av kunde»-knapp vises kun for `sent_to_customer===true && status==='sent'`
  - [ ] «Avvist av kunde»-knapp vises på samme betingelse
  - [ ] `acceptQuote` kaller `POST /api/quotes/:id/mark-accepted` + toast «Tilbud godkjent av kunde»
  - [ ] `rejectQuoteByCustomer` kaller `POST /api/quotes/:id/mark-rejected-customer` + toast «Tilbud avvist av kunde»
  - [ ] `accepted` og `rejected_customer` er BORTE fra status-dropdown
  - [ ] `pending`, `rejected`, `rejected_admin` er fortsatt i dropdown
  - [ ] `rejectQuote` (rejected_admin) er uendret

  **Commit**: NO

- [ ] 3. `public/admin/dashboard.html` + `dashboard.js`: Del B KPI-bokser

  **What to do**:

  **dashboard.html — To nye KPI-bokser:**
  Legg til ETTER eksisterende 5. boks (`kpi-venter-fakturering`, linje 41-44), inne i `<div class="kpi-grid">`:
  ```html
  <div class="card kpi-card" id="kpi-tilbud-hos-kunde-card">
      <span class="kpi-value" id="kpi-tilbud-hos-kunde">0</span>
      <span class="kpi-label">Tilbud venter på kunde</span>
  </div>
  <div class="card kpi-card" id="kpi-avvik-uhåndtert-card">
      <span class="kpi-value" id="kpi-avvik-uhåndtert">0</span>
      <span class="kpi-label">Servicer med uhåndterte avvik</span>
  </div>
  ```
  Bruk NØYAKTIG samme `class="card kpi-card"` og `class="kpi-value"` / `class="kpi-label"` som eksisterende bokser.

  **dashboard.js — 6. fetch i Promise.all (linje 12-18):**
  Endre `Promise.all`-kallet til å inkludere:
  ```js
  fetch('/api/admin/deviations/worklist', { credentials: 'include' })
  ```
  som 6. element. Håndter i destructuring:
  ```js
  const [ordersResponse, customersResponse, techniciansResponse, reportsResponse, quotesResponse, worklistResponse] = await Promise.all([...]);
  ```
  Hent data sikkert (fallback ved feil):
  ```js
  let worklistData = { orders: [] };
  if (worklistResponse && worklistResponse.ok) {
      worklistData = await worklistResponse.json().catch(() => ({ orders: [] }));
  }
  ```
  Send `worklistData` til `populateDashboard` → `populateKpiCards`.

  **dashboard.js — `populateKpiCards` (linje 136):**
  Legg til `worklistData` som parameter. Beregn:
  ```js
  const tilbudHosKunde = Array.isArray(quotes)
      ? quotes.filter(q => q.sent_to_customer === true && q.status === 'sent').length
      : 0;
  const avvikUhåndtert = worklistData.orders?.length || 0;
  ```
  Kall `updateKpiElement`:
  ```js
  updateKpiElement('kpi-tilbud-hos-kunde', tilbudHosKunde);
  updateKpiElement('kpi-avvik-uhåndtert', avvikUhåndtert);
  ```

  **dashboard.js — `makeKpiCardsClickable` (linje 253):**
  Legg til to nye blokker på slutten av funksjonen (samme mønster som eksisterende):
  ```js
  // Tilbud venter på kunde
  const tilbudHosKundeKort = document.querySelector('#kpi-tilbud-hos-kunde').closest('.kpi-card');
  if (tilbudHosKundeKort) {
      tilbudHosKundeKort.style.cursor = 'pointer';
      tilbudHosKundeKort.classList.add('clickable');
      tilbudHosKundeKort.addEventListener('click', () => { window.location.href = '/admin/tilbud.html'; });
      tilbudHosKundeKort.addEventListener('mouseenter', () => { tilbudHosKundeKort.style.backgroundColor = '#f8fafc'; });
      tilbudHosKundeKort.addEventListener('mouseleave', () => { tilbudHosKundeKort.style.backgroundColor = ''; });
  }
  // Servicer med uhåndterte avvik
  const avvikKort = document.querySelector('#kpi-avvik-uhåndtert').closest('.kpi-card');
  if (avvikKort) {
      avvikKort.style.cursor = 'pointer';
      avvikKort.classList.add('clickable');
      avvikKort.addEventListener('click', () => { window.location.href = '/admin/avvik.html'; });
      avvikKort.addEventListener('mouseenter', () => { avvikKort.style.backgroundColor = '#f8fafc'; });
      avvikKort.addEventListener('mouseleave', () => { avvikKort.style.backgroundColor = ''; });
  }
  ```

  **Must NOT do**:
  - Ingen separate fetch-kall utenfor Promise.all
  - Ikke endre eksisterende `kpi-tilbud-venter`
  - Ingen nye CSS-klasser i HTML (kun `card kpi-card`, `kpi-value`, `kpi-label`)
  - Ingen nye farger
  - Ikke bryte eksisterende bokser ved å endre `populateDashboard`-signaturen feil

  **Recommended Agent Profile**: `unspecified-high`

  **Parallelization**: Wave 1, parallelt med T1, T2.

  **References**:
  - dashboard.html KPI-grid: `dashboard.html:24-45`
  - Promise.all: `dashboard.js:12-18`
  - populateKpiCards: `dashboard.js:136-251`
  - makeKpiCardsClickable: `dashboard.js:253-304`
  - updateKpiElement: `dashboard.js:306-314`

  **Acceptance Criteria**:
  - [ ] To nye `class="card kpi-card"`-bokser i dashboard.html med riktige IDs
  - [ ] Promise.all har 6 fetches; worklist er nr. 6
  - [ ] `populateKpiCards` beregner `tilbudHosKunde` og `avvikUhåndtert`
  - [ ] `updateKpiElement` kalles for begge nye IDs
  - [ ] Begge bokser er klikkbare (tilbud.html / avvik.html)
  - [ ] Fallback: worklist-feil gir 0 (ingen crash)
  - [ ] Eksisterende 5 KPI-bokser og deres beregninger er uendret

  **Commit**: NO

---

## Final Verification Wave (MANDATORY)

> 2 review-agenter parallelt. Begge må APPROVE. Vis resultater, vent på Tom-Eriks «okay».

- [ ] F1. **Plan-compliance + regression** — `oracle`
  Verifiser:
  - `mark-accepted`: setter `status='accepted'` OG `approved_at` (kolonne finnes). Ingen parseInt.
  - `mark-rejected-customer`: setter `status='rejected_customer'`. Ingen parseInt.
  - Nye knapper vises KUN for `sent_to_customer===true && status==='sent'`
  - `accepted`/`rejected_customer` BORTE fra dropdown; `pending`/`rejected`/`rejected_admin` til stede
  - `rejectQuote` (rejected_admin) UENDRET
  - Dashboard: 6 fetches i Promise.all; worklist som nr. 6
  - Nye KPI-beregninger bruker eksisterende mekanisme (`updateKpiElement`)
  - **Regression**: v1.2 `markQuoteAsSent` (linje ~380), C2 betinget status-felt (linje ~501), deeplink `history.replaceState` (linje ~29) — alle urørt
  - Must NOT: ingen parseInt, ingen ny ordre, ingen nye DB-kolonner, ingen ny CSS, ingen app.js/server.js mount
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Regression [CLEAN] | VERDICT`

- [ ] F2. **Scope fidelity + QA-sjekkliste** — `unspecified-high`
  **Scope:** kun T1-T3 endret; `git diff --name-only` bekrefter kun quotes.js, tilbud.js, dashboard.html, dashboard.js.
  **QA-sjekkliste** til `.omo/evidence/v1.4-manual-qa-checklist.md` (Tom-Erik utfører):
  1. «Godkjent av kunde»-knapp vises på sendt, ubesvart tilbud — trykk → confirm → toast «Tilbud godkjent av kunde» → tilbud i liste viser grønn «Godkjent»-badge
  2. «Avvist av kunde»-knapp på samme tilbud — trykk → confirm → toast «Tilbud avvist av kunde» → rød badge
  3. Status-dropdown: åpne rediger på et pending-tilbud → bekreft «Godkjent» og «Avvist av kunde» er BORTE; «Venter», «Avvist», «Avvist av admin» finnes
  4. Eksisterende «Avvis»-knapp: trykk på sendt tilbud → toast «Tilbud avvist av admin» → `rejected_admin` i DB
  5. Dashboard: to nye bokser vises; «Tilbud venter på kunde» klikk → tilbud.html; «Servicer med uhåndterte avvik» klikk → avvik.html
  6. DB-verifikasjon: `SELECT id, status, approved_at FROM quotes WHERE status='accepted' LIMIT 3;` — `approved_at IS NOT NULL`
  7. v1.2 regresjon: deeplink, mark-as-sent, C2 status-felt for sendte fungerer fortsatt
  Output: `Tasks [N/N] | Sjekkliste levert | VERDICT`

---

## Commit Strategy (Tom-Erik kjører)
1. `feat(quotes): mark-accepted + mark-rejected-customer endpoints`
2. `feat(tilbud-ui): godkjent/avvist-av-kunde buttons + dropdown cleanup`
3. `feat(dashboard): tilbud-hos-kunde + avvik-uhåndtert KPI boxes`

---

## Final Checklist
- [ ] «Godkjent av kunde»-knapp: vises kun for sendte, setter accepted + approved_at + toast
- [ ] «Avvist av kunde»-knapp: vises kun for sendte, setter rejected_customer + toast
- [ ] Skilt fra eksisterende «Avvis» (rejected_admin)
- [ ] accepted + rejected_customer fjernet fra dropdown; resten beholdt
- [ ] accepted/rejected_customer viser eksisterende grønn/rød badge
- [ ] Dashboard: «Tilbud venter på kunde» (klikk → tilbud.html)
- [ ] Dashboard: «Servicer med uhåndterte avvik» (klikk → avvik.html)
- [ ] Begge i eksisterende KPI-format; B1 uten ny fetch, B2 via Promise.all
- [ ] Ingen ordregenerering, ingen ny DB-kolonne, ingen ny farge
- [ ] Ingen parseInt. Ingen app.js/server.js mount. Tester passerer.
