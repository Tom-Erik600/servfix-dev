# v1.5 Avvik til omsetning — finpuss

## TL;DR

> **Quick Summary**: Ren UI-polering — fem punkter. P5 + badge + tellerklikk er allerede bygget
> direkte (siden sist). Gjenstår: P1 (datoer i tilbudsdetaljer), P2 (rydd ordre-header),
> P3 (fane-plassering), P4 (Eksporter-plassering). INGEN ny funksjonalitet, INGEN ny backend-henting.
>
> **Allerede levert (utenfor plan):**
> - «Timer/produkter ført»-badge fjernet fra arbeidsliste-kortene
> - Alle 3 tellerkort klikkbare (filtrerer lista; klikk igjen = vis alle)
> - «Oppdater»-knapp fjernet fra avvik.html
>
> **Gjenstår i denne planen:**
> - P1: `quote.created_at` som «Opprettet»-dato + `approved_at` som «Godkjent»-dato (accepted)
> - P2: Fjern `· Ordre PROJ-...` fra kortets header (besøksnr finnes ikke i DB)
> - P3: Flytt faner til under tittel, som planlegger
> - P4: Eksporter-knapp naturlig plassert etter P3

---

## Antatte defaults (Tom-Erik kan overstyre ved godkjenning)

| Punkt | Spørsmål | Default-valg |
|-------|----------|--------------|
| P1 servicerapport-dato | Ikke tilgjengelig uten ny fetch. Bruke `quote.created_at` som proxy? | **JA** — viser «Opprettet: [dato]» (når tilbudet ble laget). Ikke «servicerapport-dato», men nyttig og tilgjengelig |
| P2 besøksnr | Finnes ikke i DB. Bare fjerne PROJ-...? | **JA** — fjern ordrenummer, ingen erstatning |

---

## Work Objectives

### Must Have
- P1: «Opprettet»-dato (`quote.created_at`) vises i tilbudsdetaljer
- P1: «Godkjent»-dato (`quote.approved_at`) vises kun for tilbud med `status === 'accepted'`
- P1: Dato-format gjenbruker eksisterende `toLocaleDateString('no-NO', { day:'numeric', month:'short', year:'numeric' })`
- P2: ` · Ordre ${o.order_id}` fjernet fra `avvik.js:220`
- P3: `.avvik-view-tabs` er en SEPARAT div ETTER `avvik-hero-top`, ikke inni den
- P4: Eksporter-knapp er eneste handling i `avvik-hero-top` (høyre) etter at faner og Oppdater er fjernet

### Must NOT Have
- INGEN ny backend-henting (P1 bruker kun data som allerede er i `quote`-objektet)
- INGEN nye farger
- INGEN endring av eksisterende fane-STIL (kun plassering endres, `avvik-view-tab`-klassen forblir)
- INGEN endring av filterpanelet (`avvik-filters`)
- INGEN parseInt på VARCHAR
- INGEN commits fra agent

---

## Execution Strategy

```
Wave 1 (2 parallelle — ulike filer):
├── T1: public/admin/assets/js/tilbud.js  — P1 datoer
└── T2: public/admin/avvik.js + avvik.html — P2 + P3 + P4

Wave FINAL (1 review):
└── F1: Scope + regression + verbatim testoutput
→ Vent på Tom-Eriks «okay»
```

---

## TODOs

- [ ] 1. `public/admin/assets/js/tilbud.js`: P1 — vis «Opprettet»- og «Godkjent»-datoer

  **What to do**:

  Les `tilbud.js` rundt linje 208-216 (Ordre-detail-section) og linje 246-250 (status-area i detaljpanelet).

  **P1a — «Opprettet»-dato:** Legg til en ny `detail-section` rett ETTER eksisterende Ordre-seksjon (linje 208-211):
  ```js
  ${quote.created_at ? `
      <div class="detail-section">
          <span class="detail-label">Opprettet</span>
          <div class="detail-value">${new Date(quote.created_at).toLocaleDateString('no-NO', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
      </div>
  ` : ''}
  ```

  **P1b — «Godkjent»-dato:** Legg til ny `detail-section` rett ETTER P1a (kun vis for `status === 'accepted'`):
  ```js
  ${quote.status === 'accepted' && quote.approved_at ? `
      <div class="detail-section">
          <span class="detail-label">Godkjent av kunde</span>
          <div class="detail-value">${new Date(quote.approved_at).toLocaleDateString('no-NO', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
      </div>
  ` : ''}
  ```

  **Must NOT do**:
  - Ingen ny fetch
  - Ikke endre eksisterende seksjoner
  - Ikke parseInt på noe

  **Recommended Agent Profile**: `quick`
  **Parallelization**: Wave 1, parallelt med T2.

  **References**:
  - Innsettingspunkt: `tilbud.js:208-211` (Ordre-seksjon)
  - Dato-format-mønster: `tilbud.js:153` (`toLocaleDateString('no-NO', ...)`)
  - `quote.created_at` og `quote.approved_at` er tilgjengelig via `...dbQuote`-spread i `transformQuoteForFrontend` (`quotes.js:47`)

  **Acceptance Criteria**:
  - [ ] Alle tilbud viser «Opprettet: [dato]» i detaljer
  - [ ] Tilbud med `status='accepted'` viser «Godkjent av kunde: [dato]»
  - [ ] Tilbud uten `approved_at` viser IKKE «Godkjent av kunde»-seksjon

  **Commit**: NO

- [ ] 2. `public/admin/assets/js/avvik.js` + `avvik.html`: P2 fjern ordrenummer + P3 flytt faner + P4 Eksporter

  **What to do**:

  **P2 — fjern ordrenummer fra kortets header:**
  Les `avvik.js` rundt linje 220. Fjern denne ene linjen:
  ```js
  <span style="font-size:13px; color:#6B7280;"> · Ordre ${escHtml(o.order_id)}</span>
  ```

  **P3 — flytt faner til under tittel (planlegger-plassering):**
  I `avvik.html`, flytt `<div class="avvik-view-tabs" id="view-toggle">...</div>` (2 linjer) UT av `avvik-hero-top` og inn som en ny separat div ETTER `avvik-hero-top` (men fortsatt inni `avvik-hero`).

  Nåværende struktur (avvik.html):
  ```html
  <div class="avvik-hero-top">
      <div>(tittel)</div>
      <button id="avvikExportBtn">Eksporter</button>
      <div class="avvik-view-tabs" id="view-toggle">  ← FLYTT HERFRA
          <button id="view-worklist-btn">Arbeidsliste</button>
          <button id="view-list-btn">Avviksliste</button>
      </div>
  </div>
  <div class="avvik-filters">...</div>
  ```

  Målstruktur:
  ```html
  <div class="avvik-hero-top">
      <div>(tittel)</div>
      <button id="avvikExportBtn">Eksporter</button>
  </div>
  <div class="avvik-view-tabs" id="view-toggle">  ← HIT (separat div, inni avvik-hero)
      <button id="view-worklist-btn">Arbeidsliste</button>
      <button id="view-list-btn">Avviksliste</button>
  </div>
  <div class="avvik-filters">...</div>
  ```

  **P4 — Eksporter-plassering:**
  Etter P3 er `avvik-hero-top` allerede: tittel (venstre) + Eksporter (høyre). Dette er allerede den naturlige planlegger-lignende plasseringen. Ingen ytterligere endring nødvendig utover P3 — P4 løses automatisk.

  **Must NOT do**:
  - Ikke endre `avvik-view-tab`-CSS (kun flytte HTML-element)
  - Ikke endre IDs `view-worklist-btn` og `view-list-btn`
  - Ikke røre `avvik-filters` eller andre seksjoner

  **Recommended Agent Profile**: `unspecified-low`
  **Parallelization**: Wave 1, parallelt med T1.

  **References**:
  - P2: `avvik.js:220` (ordrenummer-span)
  - P3: `avvik.html:271-282` (avvik-hero-top-blokken)

  **Acceptance Criteria**:
  - [ ] ` · Ordre PROJ-...` vises ikke lenger i kortets header
  - [ ] `.avvik-view-tabs` er en selvstendig div ETTER `avvik-hero-top` (ikke inni)
  - [ ] Fane-funksjonaliteten (showView, classList.toggle) er uendret
  - [ ] Eksporter-knapp er eneste knapp i `avvik-hero-top` ved siden av tittel

  **Commit**: NO

---

## Final Verification Wave

- [ ] F1. **Scope + regression** — `unspecified-high`
  Kjør `npm test`. Les alle endrede filer. Verifiser:
  - T1: `quote.created_at` vises; `quote.approved_at` kun for accepted; ingen ny fetch
  - T2: ordrenummer-span borte fra avvik.js; `.avvik-view-tabs` er separat div i avvik.html
  - Pre-eksisterende fikser (badge, tellerklikk, Oppdater) er intakte
  - Ingen parseInt, ingen nye farger, ingen mount-endringer
  Output: `Tests [N pass/fail] | Scope [N/N] | VERDICT: APPROVE/REJECT`

---

## Success Criteria

- [ ] P1: «Opprettet»-dato + «Godkjent av kunde»-dato (kun accepted) i tilbudsdetaljer
- [ ] P2: PROJ-...-nummer fjernet fra arbeidsliste-kortets header
- [ ] P3: Faner under tittel-linjen, som planlegger
- [ ] P4: Eksporter eneste knapp i hero-top
- [ ] Badge, tellerklikk, Oppdater-fjerning (allerede bygget) intakte
- [ ] Ingen ny backend-henting, ingen nye farger, ingen parseInt
- [ ] `npm test` passerer (226 pass baseline)
