# v1.3 Avvik til omsetning — rettinger + konsistens

## TL;DR

> **Quick Summary**: Ren retting + konsistens mot eksisterende ServFix-mønstre. Ingen ny funksjonalitet.
> To rettinger fra v1.2 (R1: fjern max-width; R2: fjern severity-badge fra arbeidslista),
> seks konsistensfikser (K1-K6).
>
> **Deliverables**:
> - R1: `#avvik-worklist-card` max-width fjernet (dynamisk bredde igjen)
> - R2: Severity-badge borte fra arbeidsliste-kortene (avvikslista urørt)
> - K1: Status-dropdown sist i rediger-modalen (etter produkter)
> - K2: `.status-sent` badge grønn (gjenbruk `.status-accepted`-farger)
> - K3: «Se servicerapport» inn i `action-buttons-modern`-raden
> - K4: Arbeidsliste/Avviksliste som `planner-top-tab`-faner
> - K5: Kontaktperson-feltet har tekstetikett «Kontakt:»
> - K6: «Last ned PDF» viser loading-state (⚠️ se K6-beslutning under)
>
> **Parallel Execution**: YES — alle 4 implementasjonsoppgaver i én bølge (ulike filer)

---

## Context

### Original Request
v1.3-instruksjon levert av Tom-Erik: ren retting + konsistens. Ingen ny funksjonalitet.
- R1+R2: designgrep fra v1.2 som slo feil
- K1-K6: konsistenspolering funnet gjennom dev-testing
- Arbeidsmodus: PLAN → vent på godkjenning → BUILD → rapporter

### Read-first Summary (verbatim, komprimert)

| Punkt | Fil:linje | Funn |
|-------|-----------|------|
| R1 mål | `avvik.html:229` | `#avvik-worklist-card { max-width: 1280px; margin: 0 auto; }` — fjernes |
| R2 mål | `avvik.js:205` | `<span class="avvik-badge ${getSeverityBadgeClass...}>` i devRows — fjernes |
| K1 mål | `tilbud.js:473-491` | Status-felt mellom total-pris og produkter — flyttes til bunnen |
| K2 mål | `tilbud.css:531-535` | `.status-sent` er BLÅ (`#dbeafe/#1e40af`) — endres til grønn |
| K2 ref | `tilbud.css:537-541` | `.status-accepted` = grønn (`#d1fae5,#a7f3d0,#065f46,#10b981`) — gjenbruk |
| K3 mål | `tilbud.js:198-202` | "Se servicerapport" er `btn-modern btn-preview` men plassert utenfor action-raden |
| K4 nå | `avvik.html:254-257` | Inline-styled segmented control (`style="background:#1F2937"`) |
| K4 ref | `planlegger.css:2489-2523` | `planner-top-tab` / `planner-top-tab.active` — CSS-mønsteret som gjenbrukes |
| K4 JS | `avvik.js:298-316` | `setSeg()` bruker inline stilmanipulering — byttes til `classList.toggle('active')` |
| K4 default | `avvik.js:58` | `showView('worklist')` — allerede hardkodet; `tenantFlags.default_tab` gjelder kun planlegger |
| K5 mål | `avvik.js:226` | `👤 ${o.contact_name || '—'}` — prefiks mangler |
| K6 mål | `tilbud.js:297-317` | PDF-nedlasting har ingen loading-tilbakemelding |
| K6 tech | `service.js:4801` | `setLoading()` er DOM-koplet til `#loader`/`#loading-indicator` — ikke gjenbrukbar |

---

## ⚠️ K6-beslutning (krever Tom-Eriks eksplisitte godkjenning)

**Stopp-regelen ble utløst:** Teknikerappens `setLoading()` (`service.js:4801`) er tett koplet til
DOM-elementene `#loader`/`#loading-indicator` som ikke finnes i tilbud.html. Direkte gjenbruk er
ikke mulig.

**Anbefalt minimal felles løsning:** Gjenbruk `showToast('⏳ ...', 'info')` + `btn.disabled = true`
— det eksisterende felles mønsteret begge apper allerede bruker for async-operasjoner.
- Konkret: `viewPdfBtn.innerHTML = '⏳ Genererer...'; viewPdfBtn.disabled = true;` → fetch → re-enable
- `showToast('⏳ Genererer PDF...', 'info')` vises under generering
- `showToast('Feil: ...', 'error')` ved feil (allerede på plass)
- `showToast` finnes allerede i tilbud.js — ingen ny komponent

**Tom-Erik: godkjenn K6 med showToast-løsning, eller ta det ut av v1.3-scope.**
Plan er generert med K6 inkludert. Svar «godkjent» for å gå videre til BUILD.

---

## Work Objectives

### Must Have
- R1: max-width-regelen fjernet fra avvik.html CSS
- R2: severity-badge-span fjernet fra devRows-template i avvik.js; avvikslista urørt
- K1: status-blokken (474-491) er sist i form-container, etter produkter
- K2: `.status-sent` bruker grønn bakgrunn/tekst/border identisk med `.status-accepted`-verdiene
- K3: "Se servicerapport"-knapp er i `action-buttons-modern`-divén (samme rad som andre knapper)
- K4: `#view-toggle` byttet med `planner-top-tabs`-struktur; `planner-top-tab`/`.active` CSS i `<style>`-blokk; `showView()` bruker `classList.toggle('active')` ikke inline-stil
- K5: kontaktfeltet viser «Kontakt: » prefiks (også når verdien er «—»)
- K6 (godkjent): PDF-knapp viser disabled + ⏳-tekst + toast under generering

### Must NOT Have
- INGEN endringer i compliance-avvikslista (tabell/badges/filtervisning)
- INGEN nye hex-verdier — kun gjenbruk av eksisterende (K2: nøyaktig `.status-accepted`-verdiene; K4: `#3b82f6`, `#e5e7eb`, `#6b7280`, `#f9fafb` fra planlegger.css-variabler)
- INGEN linking av planlegger.css i avvik.html — copy relevante CSS-regler til `<style>`-blokken
- INGEN ny fast bredde på #avvik-worklist-card (R1 fjerner; ingen erstatning)
- INGEN parseInt på VARCHAR
- INGEN commits fra agent (Tom-Erik eier alle commits)
- INGEN endringer i avvik-backend (deviations.js, quotes.js etc.)

---

## Execution Strategy

```
Wave 1 (alle 4 parallelle — ulike filer, ingen avhengigheter):
├── T1: avvik.html  — R1 + K4 HTML/CSS
├── T2: avvik.js    — R2 + K4 JS + K5
├── T3: tilbud.css  — K2
└── T4: tilbud.js   — K1 + K3 + K6

Wave FINAL (3 parallelle):
├── F1: Plan-compliance + regression check (oracle)
├── F2: Scope fidelity (unspecified-high)
└── F3: Manuell QA-sjekkliste (unspecified-high)
→ Vis resultater → Vent på Tom-Eriks «okay»
```

### Dependency Matrix

| Task | Depends On | Blocks |
|------|------------|--------|
| T1 | — | F1-F3 |
| T2 | — | F1-F3 |
| T3 | — | F1-F3 |
| T4 | — | F1-F3 |
| F1-F3 | T1-T4 | user okay |

---

## TODOs

- [ ] 1. `public/admin/avvik.html`: R1 fjern max-width + K4 erstatt view-toggle med planner-faner

  **What to do**:

  **R1:** Fjern HELE linje 229:
  ```css
  #avvik-worklist-card { max-width: 1280px; margin: 0 auto; }
  ```
  Bare den linjen. Resten av `/* Worklist v1.2 */`-blokken (stripe, hierarki, toggle-bar) beholdes.

  **K4 CSS:** Legg til følgende CSS-regler I SLUTTEN av `<style>`-blokken (etter eksisterende
  `.worklist-toggle-bar`-regler, før `</style>`), basert på `planlegger.css:2489-2523`:
  ```css
  /* Arbeidsliste/Avviksliste faner (Planlegger-mønster) */
  .avvik-view-tabs {
      display: flex;
      gap: 4px;
      margin-bottom: 0;
      border-bottom: 2px solid #E5E7EB;
      padding-bottom: 0;
  }
  .avvik-view-tab {
      display: inline-flex;
      align-items: center;
      padding: 9px 20px;
      border: none;
      background: transparent;
      color: #6B7280;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      margin-bottom: -2px;
      border-radius: 6px 6px 0 0;
      transition: color 0.15s, border-color 0.15s, background 0.15s;
  }
  .avvik-view-tab:hover  { color: #111827; background: #F9FAFB; }
  .avvik-view-tab.active { color: #3b82f6; border-bottom-color: #3b82f6; font-weight: 600; }
  ```
  Merk: bruker egne klasser (`avvik-view-tab`) for å unngå navnekollisjon med planlegger.

  **K4 HTML:** Erstatt `#view-toggle`-divén (linje 254-257) med:
  ```html
  <div class="avvik-view-tabs" id="view-toggle">
      <button type="button" class="avvik-view-tab active" id="view-worklist-btn">Arbeidsliste</button>
      <button type="button" class="avvik-view-tab" id="view-list-btn">Avviksliste</button>
  </div>
  ```
  Merk: IDs `view-worklist-btn` og `view-list-btn` er bevart (referert i avvik.js:302-303).
  `Arbeidsliste` starter med `active`-klassen (hardkodet default).

  **Must NOT do**:
  - Ikke fjerne noe annet fra `/* Worklist v1.2 */`-blokken
  - Ikke legge til max-width på noe annet element
  - Ikke endre HTML utenfor `#view-toggle`-divén
  - Ikke bruke nye hex-koder (de 4 som brukes: `#E5E7EB, #6B7280, #111827, #F9FAFB, #3b82f6` er alle eksisterende i planlegger.css/avvik.html)

  **Recommended Agent Profile**: `quick`

  **Parallelization**: Wave 1, parallelt med T2, T3, T4. Blocks: F1-F3.

  **References**:
  - Mål: `avvik.html:229` (R1), `avvik.html:254-257` (K4)
  - Mønster: `planlegger.css:2489-2523` (CSS-kilde)

  **Acceptance Criteria**:
  - [ ] `#avvik-worklist-card { max-width: 1280px; margin: 0 auto; }` er borte fra filen
  - [ ] `.avvik-view-tabs` og `.avvik-view-tab` CSS-regler finnes i `<style>`-blokken
  - [ ] `#view-toggle` har klassen `avvik-view-tabs` (ikke inline-stil)
  - [ ] Knappene har klassen `avvik-view-tab` og IDs `view-worklist-btn`/`view-list-btn`
  - [ ] `Arbeidsliste`-knappen starter med `active`-klassen

  **Commit**: NO

- [ ] 2. `public/admin/assets/js/avvik.js`: R2 fjern severity-badge + K4 showView + K5 kontakt

  **What to do**:

  **R2:** Fjern severity-badge-spann fra `devRows`-template. I linje 205:
  ```js
  <span class="avvik-badge ${getSeverityBadgeClass(d.severity)}">${escHtml(formatSeverityLabel(d.severity))}</span>
  ```
  Fjern HELE denne linjen. Ingenting erstatter den — rad-layout justerer seg naturlig.

  **K4 showView:** Erstatt `setSeg()`-hjelpefunksjonen og dens kall (linje 308-314) med:
  ```js
  document.getElementById('view-worklist-btn')?.classList.toggle('active', isWorklist);
  document.getElementById('view-list-btn')?.classList.toggle('active', !isWorklist);
  ```
  `setSeg()`-funksjonen selv (linje 308-313) kan fjernes når den ikke lenger kalles.
  Resten av `showView()` (display-toggling, loadWorklist-kall) beholdes uendret.

  **K5 kontakt:** I linje 226:
  ```js
  <div>👤 ${escHtml(o.contact_name || '—')}${o.contact_phone ? ` · ${escHtml(o.contact_phone)}` : ''}</div>
  ```
  Endre til:
  ```js
  <div>Kontakt: ${escHtml(o.contact_name || '—')}${o.contact_phone ? ` · ${escHtml(o.contact_phone)}` : ''}</div>
  ```
  Fjern 👤-ikonet, erstatt med tekstlabel «Kontakt: ». Konsistent: adressen bruker 📍 inline.
  Alternativt: behold 👤 og legg til tekst: `👤 Kontakt: ...`. Tom-Erik velger; standard anbefaling: ren tekst.

  **Must NOT do**:
  - Ikke fjerne severity-badge fra avvikslista (tabellrenderingen i `renderTable()` — urørt)
  - Ikke endre andre deler av `devRows`-template
  - Ikke endre `loadWorklist()` eller filtreringslogikk
  - Ikke endre `setupEventListeners()` utover fjerning av `setSeg` og ClassList-oppdatering

  **Recommended Agent Profile**: `unspecified-low`

  **Parallelization**: Wave 1, parallelt med T1, T3, T4.

  **References**:
  - R2: `avvik.js:205`
  - K4: `avvik.js:298-316` (`showView`-funksjon)
  - K5: `avvik.js:226`

  **Acceptance Criteria**:
  - [ ] Linje 205: severity-badge-span er borte
  - [ ] `renderTable()` (avvikslista) er urørt — severity-badge finnes fortsatt der (linje 339)
  - [ ] `showView()` bruker `classList.toggle('active', ...)` i stedet for `setSeg()`
  - [ ] `setSeg()`-funksjonen eksisterer ikke lenger (eller er ubrukt)
  - [ ] Kontaktfeltet viser «Kontakt: » i stedet for 👤 (eller «👤 Kontakt: »)

  **Commit**: NO

- [ ] 3. `public/admin/assets/css/tilbud.css`: K2 endre .status-sent fra blå til grønn

  **What to do**:
  Erstatt `.status-sent`-blokken (linje 531-535):
  ```css
  .status-sent {
      background: linear-gradient(135deg, #dbeafe, #bfdbfe);
      color: #1e40af;
      border-color: #3b82f6;
  }
  ```
  Med:
  ```css
  .status-sent {
      background: linear-gradient(135deg, #d1fae5, #a7f3d0);
      color: #065f46;
      border-color: #10b981;
  }
  ```
  Verdiene er identisk med `.status-accepted` (linje 537-541) — ren gjenbruk, ingen nye hex-koder.

  **Must NOT do**:
  - Ikke endre `.status-accepted` eller noen annen statusfarge
  - Ikke innføre nye hex-koder
  - Ikke endre `.sent-status-card` (linje 1114) — den er allerede grønn

  **Recommended Agent Profile**: `quick`

  **Parallelization**: Wave 1, parallelt med T1, T2, T4.

  **References**:
  - Mål: `tilbud.css:531-535`
  - Kilde-verdier: `tilbud.css:537-541` (`.status-accepted`)

  **Acceptance Criteria**:
  - [ ] `.status-sent` har `background: linear-gradient(135deg, #d1fae5, #a7f3d0)`
  - [ ] `.status-sent` har `color: #065f46`
  - [ ] `.status-sent` har `border-color: #10b981`
  - [ ] `.status-accepted` er uendret

  **Commit**: NO

- [ ] 4. `public/admin/assets/js/tilbud.js`: K1 flytt status + K3 flytt rapport-knapp + K6 PDF-loading

  **What to do**:

  **K1 — Flytt status-blokken til bunnen av modal:**
  I `openEditModal()` (`tilbud.js:434`), form-HTMLen starter ca. linje 454. Gjeldende rekkefølge:
  1. Beskrivelse (ca. 457-460)
  2. Estimerte timer (462-465)
  3. Total pris eks. MVA (467-471)
  4. **Status-blokken** (473-491) ← FLYTT HIT til bunnen
  5. Produkter/Materialer (493-...)
  6. Total-display

  Ny rekkefølge:
  1. Beskrivelse
  2. Estimerte timer
  3. Total pris eks. MVA
  4. Produkter/Materialer
  5. Total-display
  6. **Status-blokken** ← ETTER total-display

  Ta hele den betingede blokken (fra `${quote.sent_to_customer === true ?` til sluttende `\`}`) og flytt den til etter total-display-blokken. Ingen endring i innhold.

  **K3 — Flytt "Se servicerapport" inn i action-buttons-modern:**
  Gjeldende (tilbud.js:195-203): "Se servicerapport"-knapp er i detail-section for Ordre, ETTER `<div class="detail-value">` for ordrenummeret.

  Flytt knappen (linjene 198-202) inn i `action-buttons-modern`-divén (ca. linje 160-182), som et nytt siblingelement ETTER de eksisterende knappene (etter `btn-reject` / før `</div>`). Fjern `style="margin-top:8px;"` siden den nå er i en flex-rad.

  Ny plassering:
  ```js
  ${quote.order_id && quote.report_ids && quote.report_ids.length > 0 ? `
      <button type="button" class="btn-modern btn-preview" onclick="viewServiceReportForQuote('${quote.id}')">
          📄 Se servicerapport
      </button>
  ` : ''}
  ```
  (identisk innhold, bare uten `style="margin-top:8px;"` og plassert i action-buttons-modern)

  **K6 — PDF-nedlasting loading-state:**
  I `generateQuotePDF` (linje 282), der `viewPdfBtn.onclick` settes (ca. linje 297):
  ```js
  viewPdfBtn.onclick = async () => {
  ```
  Endre til:
  ```js
  viewPdfBtn.onclick = async () => {
      const originalHtml = viewPdfBtn.innerHTML;
      viewPdfBtn.disabled = true;
      viewPdfBtn.innerHTML = '⏳ Genererer...';
      showToast('Genererer PDF...', 'info');
      try {
          const response = await fetch(`/api/quotes/${quoteId}/pdf`, {
              credentials: 'include'
          });
          if (!response.ok) throw new Error('PDF generation failed');
          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `tilbud-${quoteId}.pdf`;
          document.body.appendChild(a);
          a.click();
          window.URL.revokeObjectURL(url);
          document.body.removeChild(a);
      } catch (error) {
          console.error('PDF download error:', error);
          showToast('Kunne ikke laste ned PDF', 'error');
      } finally {
          viewPdfBtn.disabled = false;
          viewPdfBtn.innerHTML = originalHtml;
      }
  };
  ```

  **Must NOT do**:
  - Ikke endre innholdet i status-blokken (kun flytt)
  - Ikke endre knappeklasser for "Se servicerapport" (beholder `btn-modern btn-preview`)
  - Ikke endre `sendQuoteToCustomer`-funksjonen
  - Ikke parseInt på quoteId
  - Ikke endre det eksisterende "Sendt"-badget i detalj-headeren (linje 150-157)

  **Recommended Agent Profile**: `unspecified-high`

  **Parallelization**: Wave 1, parallelt med T1, T2, T3.

  **References**:
  - K1: `tilbud.js:454-510` (form-HTML i openEditModal)
  - K3: `tilbud.js:160-203` (action-buttons-modern + detail-section Ordre)
  - K6: `tilbud.js:282-325` (generateQuotePDF)

  **Acceptance Criteria**:
  - [ ] Status-blokken (sent_to_customer-betinget) er ETTER produkter i form-rekken
  - [ ] Timer/pris/produkter er sammenhengende uten status mellom
  - [ ] "Se servicerapport"-knapp er i `action-buttons-modern`-divén (ikke i detail-section)
  - [ ] "Se servicerapport" har ikke `style="margin-top:8px;"` lenger
  - [ ] `viewPdfBtn.onclick` disabler knappen og viser «⏳ Genererer...» under generering
  - [ ] Knappen re-enableres i `finally`-blokk uansett utfall
  - [ ] `showToast('Genererer PDF...', 'info')` kalles ved start

  **Commit**: NO

---

## Final Verification Wave (MANDATORY — etter ALL implementasjon)

> 3 review-agenter parallelt. ALLE må APPROVE. Vis resultater og vent på Tom-Eriks «okay».

- [ ] F1. **Plan-compliance + regresjon** — `oracle`
  Les planen end-to-end. Verifiser for hvert punkt:
  - R1: `#avvik-worklist-card` mangler max-width-regel
  - R2: severity-badge BORTE i `devRows`; FINNES i `renderTable()` (avvikslista)
  - K2: `.status-sent` er grønn (`#d1fae5/#a7f3d0/#065f46/#10b981`), ikke blå
  - K4: `showView()` bruker `classList.toggle`, ikke inline-stil
  - K3: "Se servicerapport" er i `action-buttons-modern`; NOT i `detail-section`
  - K1: status-blokken er ETTER produkter i form
  - K5: «Kontakt: » prefiks eksisterer
  - K6: `viewPdfBtn` disables + toast vises
  Sjekk Must NOT: ingen parseInt, ingen nye hex, ingen planlegger.css link, ingen endringer i avvikslista.
  **Tom-Eriks 3 betingelser fra v1.2**: bekreft deeplink (`history.replaceState` linje ~29), `markQuoteAsSent` (linje ~373) og C2-betinget status-felt (linje ~473) er urørt.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Regression [CLEAN] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Scope fidelity** — `unspecified-high`
  For T1-T4: les diff og bekreft ingen out-of-scope endringer. Sjekk spesielt:
  - T1: kun max-width fjernet + tab CSS/HTML byttet — ikke annet i avvik.html
  - T2: kun severity-badge linje fjernet + showView oppdatert + kontakt-prefiks — avvikslista urørt
  - T3: kun `.status-sent`-blokken endret — ingen andre CSS-regler
  - T4: kun status-flytt + rapport-knapp-flytt + PDF-loading — ikke annet i tilbud.js
  Output: `Tasks [N/4 compliant] | VERDICT: APPROVE/REJECT`

- [ ] F3. **Manuell QA-sjekkliste** — `unspecified-high`
  Generer sjekkliste til `.omo/evidence/v1.3-manual-qa-checklist.md` (Tom-Erik utfører).
  Dekk alle 8 sjekkliste-punkter med klikk-stier og forventet resultat.
  Inkluder: (a) bekreft arbeidslista fyller bredden uten gap til venstre, (b) ingen "Medium"-badge på avvik i arbeidslista, (c) tilbudsliste: SENDT-badge er grønn, (d) "Se servicerapport" i samme rad som andre knapper, (e) fane-tabs ser ut som planlegger-fanene, (f) kontakt viser «Kontakt: », (g) PDF-nedlasting viser loading-state.
  Output: `Sjekkliste levert til .omo/evidence/v1.3-manual-qa-checklist.md | VERDICT: APPROVE`

---

## Commit Strategy

**Per instruks: Tom-Erik eier alle commits. Agent gjør IKKE `git add/commit/push`.**

Foreslått gruppering:
1. `fix(avvik): remove max-width, severity badge; add planner-style tabs; contact label` — T1, T2
2. `fix(tilbud): status badge green; report btn in action row; status field last; PDF loading` — T3, T4

---

## Success Criteria

### Final Checklist
- [ ] R1: arbeidslista fyller full bredde (ingen max-width skjevhet)
- [ ] R2: severity-badge borte fra arbeidsliste; avvikslista urørt
- [ ] K1: status-dropdown sist i rediger-modalen
- [ ] K2: SENDT-badge er grønn
- [ ] K3: «Se servicerapport» i action-buttons-raden
- [ ] K4: faner ser ut som planlegger-fanene
- [ ] K5: «Kontakt: » vises i arbeidsliste-kortene
- [ ] K6: PDF-nedlasting viser loading-tilstand
- [ ] Ingen nye farger/fonter introdusert
- [ ] Ingen parseInt på VARCHAR
- [ ] `npm test` passerer (226 pass som baseline; de 3 planner-clusters-feilene er pre-eksisterende)
