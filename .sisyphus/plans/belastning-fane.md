# Legg til "Belastning"-fane i Service-oversikt-modal

## TL;DR

> **Quick Summary**: Legg til en tredje fane "Belastning" i Service-oversikt-modalen som viser årsbasert kapasitetsutnyttelse fargekodet per måned. Belastning er ny default-fane.
>
> **Deliverables**:
> - `public/admin/planlegger.html` — ny knapp og view-container
> - `public/admin/assets/js/planlegger.js` — ny funksjon + utvidede eksisterende funksjoner
> - `public/admin/assets/css/planlegger.css` — nye stiler for load-grid
>
> **Estimated Effort**: Short
> **Parallel Execution**: NO — 3 filer med logiske avhengigheter. HTML og CSS kan gjøres parallelt, JS sist.
> **Critical Path**: HTML → JS → CSS → manuell QA

---

## Context

### Original Request
Iterasjon 1: Legg til en "Belastning"-fane i Service-oversikt-modalen med årsbasert kapasitetsvisning, fargekodet etter utnyttelse, med en hardkodet MONTHLY_CAPACITY = 30.

### Kodebase-funn (lest i sin helhet)

**planlegger.html (175 linjer):**
- `.view-toggle` har `#btn-calendar-view` (aktiv, første) og `#btn-technician-view`
- `.overview-body` har `#calendar-grid-view` og `#technician-list-view` (hidden)
- Statistikk-bar har 3 `stat-item`-elementer (linje 129–150)
- `#technician-legend` bruker `display: flex` når synlig

**planlegger.js (2260 linjer):**
- `overviewState` på linje 1836: `{ currentStartMonth, orders, technicians, currentView: 'calendar' }`
- `initOverviewModal()` linje 1850: `prevBtn`/`nextBtn` kaller `loadOverviewData()` uten `currentView`-sjekk
- `openOverviewModal()` linje 1912: setter `calendar-grid-view` display='grid', active på btn-calendar-view
- `loadOverviewData()` linje 1941: beregner 6-måneders vindu, henter data, kaller renderCurrentView
- `updatePeriodIndicator()` linje 1982: deaktiverer `prevBtn` basert på måneds-sammenligning (NB: må ikke gjelde load-view)
- `switchOverviewView()` linje 2021: kaller kun `renderCurrentView()` — må endres til `loadOverviewData()`
- `renderTechnicianLegend()` kalles i `loadOverviewData()` — vil sette legend synlig; i load-view må den skjules etterpå
- `escapeHtmlOverview()` finnes globalt

**planlegger.css (1974 linjer):**
- CSS-variabler: `--bg-light: #f9fafb`, `--border-color: #e5e7eb`, `--text-color: #1f2937`
- `.month-card` bruker `var(--bg-white)`, `var(--border-color)`, `var(--text-color)`
- Farger er hardkodet hex i eksisterende klasser (`.order-status-badge`, `.planner-instructions` etc.)

**orders.js (backend, uendret):**
- `dateFrom` og `dateTo` query-params støttes og filtrerer `scheduled_date`

### Tekniske fallgruver identifisert

1. **prevBtn disabled-logikk**: `updatePeriodIndicator()` deaktiverer `prevBtn` basert på måneds-sammenligning med "nå". I load-view brukes år, ikke måneder — denne logikken MÅ ikke gjelde load-view. Løsning: early return med `prevBtn.disabled = false` når `currentView === 'load'`.

2. **currentStartMonth mutasjon**: `prevBtn`/`nextBtn` kaller `.setMonth(±6)` direkte på state-objektet. I load-view skal dette IKKE kjøres — år-navigering bruker `currentYear±1` istedet. Løsning: conditionelle greiner i listener-koden i `initOverviewModal`.

3. **renderTechnicianLegend() i loadOverviewData()**: Kalles på linje 1973 og setter innhold. I load-view vil legenden få innhold men bør forbli skjult. Løsning: etter `renderTechnicianLegend()`-kallet, skjul legenden hvis `currentView === 'load'`.

4. **switchOverviewView kaller bare renderCurrentView()**: Spec krever at det kaller `loadOverviewData()` siden dato-vinduet er annerledes for load vs. kalender/tekniker. Endringen er kritisk for korrekt data.

5. **display-verdi for load-grid-view**: `.calendar-grid-view` CSS-klassen setter `display: grid`. Når vi viser `#load-grid-view` må vi sette `display = 'grid'` (ikke 'block') for at CSS-grid-layout skal fungere.

6. **CSS-klassenavn vs. ID-er**: `#calendar-grid-view` bruker klassen `.calendar-grid-view` som har `display: grid` i CSS. `#load-grid-view` vil bruke klassen `.load-grid-view` som vi definerer med `display: grid`. Visibility-styringen gjøres via `element.style.display`.

---

## Work Objectives

### Core Objective
Legge til en "Belastning"-fane som default-visning i Service-oversikt-modalen, med årsbasert kapasitetsutnyttelse fargekodet per måned.

### Concrete Deliverables
- Ny knapp `#btn-load-view` som første element i `.view-toggle`
- Ny container `#load-grid-view` som første element i `.overview-body`
- `MONTHLY_CAPACITY`-konstant over `overviewState`
- `currentYear`-felt i `overviewState`
- Utvidet `initOverviewModal()` med load-knapp og år-navigering
- Utvidet `openOverviewModal()` med load som default
- Utvidet `loadOverviewData()` med år-fetch-logikk
- Utvidet `switchOverviewView()` med load-branch og loadOverviewData()-kall
- Utvidet `renderCurrentView()` med load-case
- Ny funksjon `renderLoadView()` med 12-måneds grid og peak-panel
- Utvidet `updatePeriodIndicator()` med år-visning
- Utvidet `updateOverviewStatistics()` med snitt-utnyttelse
- Nytt `#stat-utilization-wrapper` i HTML
- CSS for `.load-grid-view`, `.load-month-card` og tilhørende klasser

### Definition of Done
- [ ] `planlegger.html` validerer uten feil og nye elementer finnes i DOM
- [ ] Modal åpner med "Belastning" aktiv som default
- [ ] 12 måneder rendres korrekt i 6×2 grid
- [ ] Fargeterskler fungerer korrekt (<70% nøytral, 70–95% amber, >95% rød)
- [ ] Forrige/Neste navigerer år i load-view, måneder i andre views
- [ ] Alle 13 akseptansekriterier i spec bekreftet
- [ ] Ingen console-feil

### Must Have
- Belastning er default-fane ved modal-åpning
- Forrige/Neste navigerer år (ikke 6 måneder) i load-view
- `currentStartMonth` og `currentYear` er uavhengige (endrer seg ikke feil)
- `MONTHLY_CAPACITY = 30` med TODO-kommentar
- Peak-panel kun ved ≥1 måned >95%
- `#stat-utilization-wrapper` skjult i kalender- og tekniker-view

### Must NOT Have (Guardrails)
- Ikke endre `renderCalendarView`, `renderTechnicianView`, `getOrdersForMonth`, `renderMonthOrders`
- Ikke endre noen backend-fil
- Ikke introdusere nye npm-pakker
- Ikke endre databaseskjema eller migrasjoner
- Ikke refaktorere eksisterende kode utover det som er nødvendig
- Ikke flytte `MONTHLY_CAPACITY` til settings — det er iterasjon 2

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification er agent-executed.

### Test Decision
- **Infrastructure exists**: Uklar (ikke undersøkt eksplisitt for dette prosjektet, men spec sier ingen nye tester)
- **Automated tests**: NO (spec spesifiserer eksplisitt ingen nye tester)
- **Agent-Executed QA**: JA — Playwright brukes for browser-verifisering

### QA Policy
Hvert task har konkrete QA-scenarioer med eksakte selektorer og assertion-verdier, kjørt av den utøvende agenten.

---

## Execution Strategy

### Parallel Execution

```
Wave 1 (Parallelt — HTML og CSS er uavhengige av hverandre):
├── Task 1: HTML-endringer (planlegger.html) [quick]
└── Task 2: CSS-tillegg (planlegger.css) [quick]

Wave 2 (Etter Wave 1 — JS avhenger av riktig HTML-struktur):
└── Task 3: JavaScript-endringer (planlegger.js) [unspecified-high]

Wave FINAL (Etter Task 3):
└── Task 4: Manuell QA — alle 13 akseptansekriterier [unspecified-high + playwright]
```

### Agent Dispatch Summary
- **Wave 1**: T1 → `quick`, T2 → `quick`
- **Wave 2**: T3 → `unspecified-high`
- **Final**: T4 → `unspecified-high` med `playwright`-skill

---

## TODOs

- [x] 1. HTML-endringer i `planlegger.html`

  **What to do**:
  - Finn `.view-toggle`-blokken (linje 101–108 i planlegger.html). Legg til ny knapp som FØRSTE barn, FØR `#btn-calendar-view`:
    ```html
    <button class="view-btn active" data-view="load" id="btn-load-view">
        📊 Belastning
    </button>
    ```
  - På `#btn-calendar-view` (som nå er andre knapp): fjern klassen `active` og endre knapp-teksten til **"Årsmatrise"** (beholder id og data-view="calendar"):
    ```html
    <button class="view-btn" data-view="calendar" id="btn-calendar-view">
        🗓 Årsmatrise
    </button>
    ```
  - Finn `.overview-body`-blokken (linje 153–163). Legg til ny container som FØRSTE barn, FØR `#calendar-grid-view`:
    ```html
    <div class="load-grid-view" id="load-grid-view">
        <!-- Fylles dynamisk med JavaScript -->
    </div>
    ```
  - På `#calendar-grid-view` (som nå er andre barn): legg til `style="display: none;"` siden load nå er default.
  - Finn `.overview-stats`-blokken (linje 128–150). Legg til to nye `stat-item`-elementer ETTER de tre eksisterende — Kunder og Snitt utnyttelse:
    ```html
    <div class="stat-item" id="stat-kunder-wrapper">
        <span class="stat-icon">👥</span>
        <div class="stat-content">
            <span class="stat-value" id="stat-kunder">0</span>
            <span class="stat-label">Kunder</span>
        </div>
    </div>
    <div class="stat-item" id="stat-utilization-wrapper">
        <span class="stat-icon">📈</span>
        <div class="stat-content">
            <span class="stat-value" id="stat-utilization">0 %</span>
            <span class="stat-label">Snitt utnyttelse</span>
        </div>
    </div>
    ```

  **Must NOT do**:
  - Ikke endre noe annet i HTML-filen
  - Ikke endre `#technician-list-view` — den har allerede `style="display: none;"`
  - Ikke endre modal-struktur, klasser eller IDs som eksisterer

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Rent HTML-markup-arbeid, ingen logikk, 3 enkle innsettinger
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (med Task 2)
  - **Blocks**: Task 3 (JS avhenger av riktig HTML-struktur)
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `public/admin/planlegger.html:101-108` — eksisterende `.view-toggle`-blokk med to knapper
  - `public/admin/planlegger.html:128-150` — eksisterende `.overview-stats`-blokk med 3 stat-items
  - `public/admin/planlegger.html:153-163` — eksisterende `.overview-body`-blokk

  **Acceptance Criteria**:

  - [ ] `#btn-load-view` eksisterer i DOM og er første barn i `.view-toggle`
  - [ ] `#btn-load-view` har klassen `active`
  - [ ] `#btn-calendar-view` har IKKE klassen `active` og teksten er "Årsmatrise"
  - [ ] `#load-grid-view` eksisterer i DOM som første barn i `.overview-body`
  - [ ] `#calendar-grid-view` har `style="display: none;"`
  - [ ] `#stat-kunder-wrapper` og `#stat-kunder` eksisterer i `.overview-stats`
  - [ ] `#stat-utilization-wrapper` og `#stat-utilization` eksisterer i `.overview-stats`

  **QA Scenarios**:

  ```
  Scenario: Verifiser HTML-struktur etter endringer
    Tool: Bash (grep/cat)
    Steps:
      1. grep -n "btn-load-view" public/admin/planlegger.html
         → Forventer: én treff med class="view-btn active"
      2. grep -n "btn-calendar-view" public/admin/planlegger.html
         → Forventer: active er IKKE til stede på denne knappen
      3. grep -n "load-grid-view" public/admin/planlegger.html
         → Forventer: to treff (class og id)
      4. grep -n "calendar-grid-view" public/admin/planlegger.html
         → Forventer: inneholder display: none
      5. grep -n "stat-utilization" public/admin/planlegger.html
         → Forventer: to treff (wrapper og value)
    Expected Result: Alle grep-treff matcher forventet innhold
    Evidence: .sisyphus/evidence/task-1-html-grep.txt
  ```

  **Commit**: NO (grupperes med Task 2 og 3)

- [x] 2. CSS-tillegg i `planlegger.css`

  **What to do**:
  Legg til følgende blokk på SLUTTEN av `public/admin/assets/css/planlegger.css`, etter linje 1974:

  ```css
  /* ===== BELASTNING-VISNING ===== */

  .load-grid-view {
      display: flex;
      flex-direction: column;
      gap: 16px;
  }

  .load-section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 14px;
      font-weight: 600;
      color: var(--text-color);
  }

  .load-legend {
      display: flex;
      gap: 16px;
      font-size: 12px;
      font-weight: 400;
      color: var(--text-color);
  }

  .load-legend-item {
      display: flex;
      align-items: center;
      gap: 6px;
  }

  .load-legend-item::before {
      content: '';
      display: inline-block;
      width: 12px;
      height: 12px;
      border-radius: 3px;
      border: 1px solid var(--border-color);
      background: var(--bg-light);
  }

  .load-legend-item.medium::before {
      background: #fef3c7;
      border-color: #fde68a;
  }

  .load-legend-item.high::before {
      background: #fee2e2;
      border-color: #fecaca;
  }

  .load-cards-grid {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 12px;
  }

  @media (max-width: 768px) {
      .load-cards-grid {
          grid-template-columns: repeat(3, 1fr);
      }
  }

  .load-month-card {
      background: var(--bg-light);
      border: 1px solid var(--border-color);
      padding: 12px;
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      gap: 6px;
  }

  .load-month-card.low {
      /* nøytral — samme som default */
  }

  .load-month-card.medium {
      background: #fef3c7;
      color: #92400e;
      border-color: #fde68a;
  }

  .load-month-card.high {
      background: #fee2e2;
      color: #991b1b;
      border-color: #fecaca;
  }

  .load-month-card.peak {
      box-shadow: 0 0 0 2px #fca5a5;
  }

  .load-month-name {
      text-transform: uppercase;
      font-size: 11px;
      letter-spacing: 0.4px;
      opacity: 0.7;
  }

  .load-month-count-row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
  }

  .load-month-count {
      font-size: 22px;
      font-weight: 600;
      line-height: 1;
  }

  .load-month-pct {
      font-size: 12px;
      opacity: 0.8;
  }

  .load-month-bar {
      height: 4px;
      border-radius: 2px;
      background: rgba(0, 0, 0, 0.08);
      overflow: hidden;
  }

  .load-month-bar-fill {
      height: 100%;
      border-radius: 2px;
      background: currentColor;
  }

  .load-peak-panel {
      margin-top: 20px;
      background: #fee2e2;
      border: 1px solid #fecaca;
      border-radius: 12px;
      padding: 16px 20px;
      color: #991b1b;
  }

  .load-peak-panel h4 {
      margin: 0 0 12px 0;
      font-size: 15px;
      font-weight: 600;
      color: #991b1b;
  }

  .load-peak-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 8px;
  }

  .load-peak-tech {
      background: white;
      padding: 8px 12px;
      border-radius: 6px;
      border: 1px solid #fecaca;
      display: flex;
      flex-direction: column;
      gap: 2px;
  }

  .load-peak-tech-name {
      font-size: 13px;
      font-weight: 600;
      color: #991b1b;
  }

  .load-peak-tech-count {
      font-size: 12px;
      color: #b91c1c;
  }

  .load-peak-meta {
      font-size: 12px;
      color: #b91c1c;
      margin-bottom: 8px;
  }
  ```

  **Must NOT do**:
  - Ikke endre eksisterende CSS-klasser eller -variabler
  - Ikke introdusere nye CSS-variabler (bruk `var(--bg-light)`, `var(--border-color)` som allerede finnes)
  - Ikke hardkode farger for nøytral-tilstanden (bruk variabler)
  - Ikke endre mediaquery-bruddpunkter for eksisterende klasser

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Rent CSS-append-arbeid, ingen logikk, ingen konflikter med eksisterende stiler
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (med Task 1)
  - **Blocks**: Task 3 (indirekte — JS bruker disse klassene)
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `public/admin/assets/css/planlegger.css:1609-1646` — `.month-card` og `.month-card-header` for stil-referanse
  - `public/admin/assets/css/planlegger.css:1-19` — CSS-variabler definert i `:root`
  - `public/admin/assets/css/planlegger.css:1860-1876` — `.order-status-badge.in-progress` for fargebruk-mønster (amber)

  **Acceptance Criteria**:

  - [ ] `.load-cards-grid` definert med `grid-template-columns: repeat(6, 1fr)`
  - [ ] `.load-section-header` har `display: flex` og `justify-content: space-between`
  - [ ] `.load-legend-item.medium::before` har `background: #fef3c7`
  - [ ] `.load-legend-item.high::before` har `background: #fee2e2`
  - [ ] `.load-month-card.medium` har `background: #fef3c7`
  - [ ] `.load-month-card.high` har `background: #fee2e2`
  - [ ] `.load-month-card.peak` har `box-shadow` med `#fca5a5`
  - [ ] `@media (max-width: 768px)` endrer `.load-cards-grid` til `repeat(3, 1fr)`

  **QA Scenarios**:

  ```
  Scenario: Verifiser CSS-innhold etter append
    Tool: Bash (grep)
    Steps:
      1. grep -n "BELASTNING-VISNING" public/admin/assets/css/planlegger.css
         → Forventer: én treff nær slutten av filen
      2. grep -n "repeat(6, 1fr)" public/admin/assets/css/planlegger.css
         → Forventer: én treff i .load-grid-view
      3. grep -n "fef3c7" public/admin/assets/css/planlegger.css
         → Forventer: én treff i .load-month-card.medium
      4. grep -n "fee2e2" public/admin/assets/css/planlegger.css
         → Forventer: to treff (high og peak-panel)
    Expected Result: Alle grep bekrefter korrekt innhold
    Evidence: .sisyphus/evidence/task-2-css-grep.txt
  ```

  **Commit**: NO (grupperes med Task 1 og 3)

- [x] 3. JavaScript-endringer i `planlegger.js`

  **What to do**:

  Gjør følgende endringer i `public/admin/assets/js/planlegger.js` **nøyaktig i denne rekkefølgen**. Ingen nye utility-funksjoner eller hjelpeabstraksjoner — all logikk inline.

  ---

  **3a — Legg til konstant over `overviewState` (linje ~1835):**

  Finn linjen rett over `const overviewState = {` og legg til:
  ```javascript
  const MONTHLY_CAPACITY = 30; // TODO: flytt til tenant-settings i iterasjon 2
  ```

  ---

  **3b — Endre default `currentView` i `overviewState` (linje ~1836):**

  ```javascript
  // FØR:
  currentView: 'calendar'
  // ETTER:
  currentView: 'load'
  ```

  ---

  **3c — Endre `openOverviewModal()` (linje ~1912):**

  Finn blokken som setter calendar som aktiv visning. Erstatt den med:
  ```javascript
  overviewState.currentView = 'load';
  document.getElementById('load-grid-view').style.display = 'block';
  document.getElementById('calendar-grid-view').style.display = 'none';
  document.getElementById('technician-list-view').style.display = 'none';
  document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('btn-load-view').classList.add('active');
  ```
  Behold all annen logikk i funksjonen uendret (datoer, kall til `loadOverviewData()`, osv.).

  ---

  **3d — Endre `switchOverviewView()` (linje ~2021):**

  Funksjonen må:
  1. Skjule alle tre view-containere
  2. Vise riktig container for valgt view
  3. Sette `overviewState.currentView`
  4. Oppdatere `.active` på view-knappene
  5. Kalle `loadOverviewData()` (ikke `renderCurrentView()`)

  ```javascript
  function switchOverviewView(view) {
      overviewState.currentView = view;

      document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
      document.getElementById(`btn-${view}-view`).classList.add('active');

      document.getElementById('load-grid-view').style.display = 'none';
      document.getElementById('calendar-grid-view').style.display = 'none';
      document.getElementById('technician-list-view').style.display = 'none';

      if (view === 'load') {
          document.getElementById('load-grid-view').style.display = 'block';
      } else if (view === 'calendar') {
          document.getElementById('calendar-grid-view').style.display = 'grid';
      } else if (view === 'technician') {
          document.getElementById('technician-list-view').style.display = 'block';
      }

      loadOverviewData();
  }
  ```

  ---

  **3e — Endre `initOverviewModal()` — klikklyttere for view-knapper (linje ~1850):**

  Finn stedet der `prevBtn` og `nextBtn` sin click-handler settes opp. Legg til disse tre lyttere rett etter:
  ```javascript
  document.getElementById('btn-load-view').addEventListener('click', () => switchOverviewView('load'));
  document.getElementById('btn-calendar-view').addEventListener('click', () => switchOverviewView('calendar'));
  document.getElementById('btn-technician-view').addEventListener('click', () => switchOverviewView('technician'));
  ```

  ---

  **3f — Endre `initOverviewModal()` — prevBtn/nextBtn-navigasjon:**

  Finn klikk-handlerene for `prevBtn` og `nextBtn`. Wrap den eksisterende logikken med en `if/else`:

  ```javascript
  prevBtn.addEventListener('click', () => {
      if (overviewState.currentView === 'load') {
          const y = overviewState.currentStartMonth.getFullYear();
          overviewState.currentStartMonth = new Date(y - 1, 0, 1);
      } else {
          overviewState.currentStartMonth = new Date(overviewState.currentStartMonth);
          overviewState.currentStartMonth.setMonth(overviewState.currentStartMonth.getMonth() - 6);
      }
      loadOverviewData();
  });

  nextBtn.addEventListener('click', () => {
      if (overviewState.currentView === 'load') {
          const y = overviewState.currentStartMonth.getFullYear();
          overviewState.currentStartMonth = new Date(y + 1, 0, 1);
      } else {
          overviewState.currentStartMonth = new Date(overviewState.currentStartMonth);
          overviewState.currentStartMonth.setMonth(overviewState.currentStartMonth.getMonth() + 6);
      }
      loadOverviewData();
  });
  ```
  Fjern den eksisterende prevBtn/nextBtn-koden og erstatt med blokken over.

  ---

  **3g — Endre `updatePeriodIndicator()` (linje ~1982):**

  Legg til tidlig retur-blokk **øverst** i funksjonen (før eksisterende logikk). Periodeindikator viser årstallet, og navigasjonsknappene oppdateres dynamisk til å vise naboårene:
  ```javascript
  if (overviewState.currentView === 'load') {
      const year = overviewState.currentStartMonth.getFullYear();
      periodIndicator.textContent = year.toString();
      prevBtn.textContent = `← ${year - 1}`;
      nextBtn.textContent = `${year + 1} →`;
      prevBtn.disabled = false;
      return;
  }
  ```

  ---

  **3h — Endre `loadOverviewData()` — datointervall og legend-skjuling (linje ~1941):**

  **Del 1 — datointervall:** Finn stedet der `dateFrom` og `dateTo` beregnes. Legg til en `if`-blokk *over* den eksisterende utregningen:
  ```javascript
  let dateFrom, dateTo;
  if (overviewState.currentView === 'load') {
      const year = overviewState.currentStartMonth.getFullYear();
      dateFrom = `${year}-01-01`;
      dateTo = `${year}-12-31`;
  } else {
      // eksisterende 6-månederslogikk her (flytt, ikke dupliser)
      // dateFrom = ...
      // dateTo = ...
  }
  ```

  **Del 2 — legend-skjuling:** Finn kallet til `renderTechnicianLegend()` inne i `loadOverviewData()`. Legg til rett etter:
  ```javascript
  if (overviewState.currentView === 'load') {
      document.getElementById('technician-legend').style.display = 'none';
  }
  ```

  **Del 3 — kall renderLoadView:** Finn stedet der `renderCurrentView()` kalles (eller der `renderCalendarView()`/`renderTechnicianView()` velges). Legg til `load`-grenen:
  ```javascript
  if (overviewState.currentView === 'load') {
      renderLoadView();
  } else {
      renderCurrentView(); // eller den eksisterende forgreningen
  }
  ```

  ---

  **3i — Legg til ny funksjon `renderLoadView()` etter `loadOverviewData()`:**

  ```javascript
  function renderLoadView() {
      const year = overviewState.currentStartMonth.getFullYear();
      const orders = overviewState.orders;
      const techs = overviewState.technicians;

      // Tell ordrer per måned (0 = januar)
      const counts = new Array(12).fill(0);
      orders.forEach(order => {
          if (!order.scheduled_date) return;
          const d = new Date(order.scheduled_date);
          if (d.getFullYear() === year) counts[d.getMonth()]++;
      });

      // Tell unike kunder
      const customerSet = new Set();
      orders.forEach(order => {
          if (order.customer_id) customerSet.add(order.customer_id);
      });
      const statKunder = document.getElementById('stat-kunder');
      if (statKunder) statKunder.textContent = customerSet.size;

      // Bygg månedskort
      let cardsHTML = '';
      const peakMonthData = []; // måneder over 95%

      counts.forEach((count, i) => {
          const pct = MONTHLY_CAPACITY > 0 ? Math.round((count / MONTHLY_CAPACITY) * 100) : 0;
          let cls = 'low';
          if (pct >= 95) cls = 'high';
          else if (pct >= 70) cls = 'medium';
          const isPeak = pct >= 95;
          const barWidth = Math.min(pct, 100);

          cardsHTML += `<div class="load-month-card ${cls}${isPeak ? ' peak' : ''}">
              <div class="load-month-name">${escapeHtmlOverview(monthNames[i])}</div>
              <div class="load-month-count-row">
                  <span class="load-month-count">${count}</span>
                  <span class="load-month-pct">${pct}%</span>
              </div>
              <div class="load-month-bar">
                  <div class="load-month-bar-fill" style="width:${barWidth}%"></div>
              </div>
          </div>`;

          if (isPeak) peakMonthData.push({ name: monthNames[i], index: i, count, pct });
      });

      // Bygg peak-panel for ALLE måneder over 95%
      let peakPanelsHTML = '';
      peakMonthData.forEach(pm => {
          // Tell unike kunder og ordrer per tekniker denne måneden
          const pmCustomers = new Set();
          const techCounts = {};
          techs.forEach(t => { techCounts[t.id] = 0; });

          orders.forEach(order => {
              if (!order.scheduled_date) return;
              const d = new Date(order.scheduled_date);
              if (d.getFullYear() === year && d.getMonth() === pm.index) {
                  if (order.customer_id) pmCustomers.add(order.customer_id);
                  if (order.technician_id != null && techCounts[order.technician_id] !== undefined) {
                      techCounts[order.technician_id]++;
                  }
              }
          });

          const techItems = techs
              .filter(t => techCounts[t.id] > 0)
              .sort((a, b) => techCounts[b.id] - techCounts[a.id])
              .map(t => `<div class="load-peak-tech">
                  <span class="load-peak-tech-name">${escapeHtmlOverview(t.name)}</span>
                  <span class="load-peak-tech-count">${techCounts[t.id]} oppdrag</span>
              </div>`).join('');

          peakPanelsHTML += `<div class="load-peak-panel">
              <h4>⚠ ${escapeHtmlOverview(pm.name)} — overbelastet (${pm.pct}%)</h4>
              <div class="load-peak-meta">${pm.count} oppdrag · ${pmCustomers.size} kunder</div>
              <div class="load-peak-grid">${techItems}</div>
          </div>`;
      });

      // Legg alt inn i containeren
      document.getElementById('load-grid-view').innerHTML = `
          <div class="load-section-header">
              <span>Belastning per måned</span>
              <div class="load-legend">
                  <span class="load-legend-item low">under 70 %</span>
                  <span class="load-legend-item medium">70–95 %</span>
                  <span class="load-legend-item high">over 95 %</span>
              </div>
          </div>
          <div class="load-cards-grid">${cardsHTML}</div>
          ${peakPanelsHTML}
      `;

      // Oppdater snitt-utnyttelse
      const totalOrders = counts.reduce((a, b) => a + b, 0);
      const avgPct = Math.round((totalOrders / (MONTHLY_CAPACITY * 12)) * 100);
      const statEl = document.getElementById('stat-utilization');
      if (statEl) statEl.textContent = avgPct + ' %';
  }
  ```

  ---

  **Must NOT do**:
  - Ikke endre `renderCalendarView()`, `renderTechnicianView()`, `getOrdersForMonth()`, `renderMonthOrders()` eller andre eksisterende rendering-funksjoner
  - Ikke refaktorer `loadOverviewData()` utover de spesifiserte punktene
  - Ikke flytt `MONTHLY_CAPACITY` til settings.json eller GCS (iterasjon 2)
  - Ikke legg til `console.log` i produksjonskode
  - Ikke endre backend-filer

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Krever nøyaktig kirurgisk edit av en 2260-linjers JS-fil med fallgruver — trenger grundig lesing av eksisterende kode før endring
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 (etter Wave 1)
  - **Blocks**: Final Verification
  - **Blocked By**: Task 1 (HTML), Task 2 (CSS)

  **References**:

  **Pattern References**:
  - `public/admin/assets/js/planlegger.js:1836` — `overviewState` — les hele objektet før endring
  - `public/admin/assets/js/planlegger.js:1850` — `initOverviewModal()` — les prevBtn/nextBtn-lyttere i sin helhet
  - `public/admin/assets/js/planlegger.js:1912` — `openOverviewModal()` — les hele funksjonen for å identifisere nøyaktig hva som setter calendar som aktiv
  - `public/admin/assets/js/planlegger.js:1941` — `loadOverviewData()` — les hele funksjonen for å forstå dataflyt, dateFrom/dateTo-beregning og renderCurrentView-kall
  - `public/admin/assets/js/planlegger.js:1982` — `updatePeriodIndicator()` — les for å forstå prevBtn.disabled-logikken
  - `public/admin/assets/js/planlegger.js:2021` — `switchOverviewView()` — les eksisterende implementasjon i sin helhet
  - `public/admin/assets/js/planlegger.js` — søk etter `monthNames` og `escapeHtmlOverview` for å bekrefte at de finnes og er globale

  **Acceptance Criteria**:

  - [ ] `MONTHLY_CAPACITY` er definert rett over `overviewState`
  - [ ] `overviewState.currentView` er `'load'` ved initialisering
  - [ ] Modal åpner med load-view aktiv (calendar skjult)
  - [ ] Klikk på `#btn-calendar-view` bytter til kalender-visning
  - [ ] Klikk på `#btn-technician-view` bytter til tekniker-visning
  - [ ] Klikk på `#btn-load-view` bytter tilbake til belastning-visning
  - [ ] Forrige/Neste navigerer per år i load-view, per 6 måneder i andre views
  - [ ] Periodeindikator viser kun årstall i load-view (f.eks. "2025")
  - [ ] `technician-legend` er skjult i load-view
  - [ ] 12 månedskort rendres i `#load-grid-view`
  - [ ] Måneder < 70% får klassen `low`, 70–95% `medium`, > 95% `high`
  - [ ] Peak-panel vises kun hvis ≥1 måned > 95%
  - [ ] `#stat-utilization` viser gjennomsnittlig utnyttelse i prosent

  **QA Scenarios**:

  ```
  Scenario: Modal åpner med Belastning som default
    Tool: Playwright
    Preconditions: Dev-server kjører på http://localhost:5434. Minst én ordre finnes.
    Steps:
      1. Naviger til http://localhost:5434/admin/planlegger.html
      2. Klikk på et serviceelement for å åpne Service-oversikt-modal
      3. Sjekk at #btn-load-view har klassen "active"
      4. Sjekk at #load-grid-view er synlig (ikke display:none)
      5. Sjekk at #calendar-grid-view er skjult (display:none eller ikke synlig)
      6. Sjekk at periodeindikator viser et årstall (f.eks. "2025")
      7. Tell antall .load-month-card-elementer — forventer nøyaktig 12
    Expected Result: 12 månedskort, load-tab aktiv, kalender skjult, årstall i indikator
    Evidence: .sisyphus/evidence/task-3-modal-default.png

  Scenario: Fane-navigasjon frem og tilbake
    Tool: Playwright
    Preconditions: Modal er åpen i load-view
    Steps:
      1. Klikk på #btn-calendar-view
         → #calendar-grid-view vises, #load-grid-view skjules, #btn-calendar-view er aktiv
      2. Klikk på #btn-technician-view
         → #technician-list-view vises, kalender skjules, #btn-technician-view er aktiv
      3. Klikk på #btn-load-view
         → #load-grid-view vises igjen, de andre skjules, #btn-load-view er aktiv
    Expected Result: Alle tre faner bytter korrekt, ingen feil i console
    Evidence: .sisyphus/evidence/task-3-tab-switching.png

  Scenario: År-navigasjon i load-view
    Tool: Playwright
    Preconditions: Modal er åpen i load-view, periodeindikator viser inneværende år (f.eks. "2025")
    Steps:
      1. Klikk på Forrige-knappen
         → Periodeindikator endres til "2024"
         → 12 månedskort oppdateres
      2. Klikk på Neste-knappen
         → Periodeindikator endres tilbake til "2025"
    Expected Result: År endres korrekt, data lastes på nytt, ingen console-feil
    Evidence: .sisyphus/evidence/task-3-year-nav.png

  Scenario: Fargesetting av månedskort
    Tool: Playwright
    Preconditions: Modal er åpen. Test med kjent datasett: måneder med 0 ordre (low), ~25 ordre (medium), ~30+ ordre (high)
    Steps:
      1. Finn et månedskort med 0 ordre → bekreft klassen er "load-month-card low"
      2. Hvis månedskort med pct >= 70 finnes → bekreft klasse inneholder "medium" eller "high"
      3. Sjekk at .load-month-count viser riktig antall ordrer
    Expected Result: Klasser matcher terskelreglene (< 70% = low, 70–95% = medium, > 95% = high)
    Evidence: .sisyphus/evidence/task-3-color-coding.png
  ```

  **Commit**: YES (etter alle tre tasks)
  - Message: `feat(planlegger): add belastning load-view tab to service-overview modal`
  - Files: `public/admin/planlegger.html`, `public/admin/assets/js/planlegger.js`, `public/admin/assets/css/planlegger.css`
  - Pre-commit: ingen automatiske tester — kjør manuell QA manuelt

---

## Final Verification Wave

- [x] F1. **Akseptansekriterier-sjekk** — `unspecified-high` med `playwright`-skill
  Åpne nettleseren mot `http://localhost:5434/admin/planlegger.html`. Kjør gjennom alle 13 akseptansekriterier i spec-dokumentet. Dokumenter hvert punkt som PASS/FAIL med screenshot-bevis. Sjekk at `console` er ren.
  Output: `AC1-AC13: [PASS/FAIL per punkt] | Console: [CLEAN/ERRORS] | VERDICT: APPROVE/REJECT`

---

## Commit Strategy

- **1**: `feat(planlegger): add belastning load-view tab to service-overview modal` — planlegger.html, planlegger.js, planlegger.css

---

## Success Criteria

### Verification Commands
```bash
# Ingen automatiske tester — manuell QA mot dev-server
# Bekreft dev-server kjører:
# node server.js  (eller tilsvarende, port 5434)
```

### Final Checklist
- [ ] Belastning-fanen er default ved modal-åpning
- [ ] 12 måneder vises i 6×2 grid
- [ ] Farger matcher tersklene (<70%, 70–95%, >95%)
- [ ] Forrige/Neste navigerer riktig type periode per view
- [ ] Bytte mellom faner fungerer uten datatap eller feil
- [ ] ESC lukker modal
- [ ] Ingen console-feil
