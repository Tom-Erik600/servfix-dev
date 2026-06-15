# ServFix E2E Test Prompt

Bruk dette dokumentet som kontekst når du starter en ny AI-sesjon for å kjøre eller oppdatere E2E-tester.

---

## Kontekst

Du jobber med **ServFix** — et norsk admin-panel for serviceselskaper (luftbehandling / HMS).
Repo: `C:\apps\servfix-dev`
Test-miljø: `https://airtechdev.servfix.no` (tenant: `airtech_db`)

Teknologistack:
- Backend: Node.js / Express
- Frontend: Vanilla JS (ingen React/Vue)
- E2E-tester: Playwright TypeScript (`tests/e2e/`)
- API-tester: Jest + supertest (`tests/`)

---

## Moduler som er implementert (v1.0–v1.5)

### Avvik-arbeidsliste (`/admin/avvik.html`)
- Teknikere registrerer avvik under servicebesøk (outcome: `wants_quote` / `fixed_on_site` / `not_applicable`)
- Arbeidslisten grupperer avvik per ordre med KPI-tellere (klikkbare filter)
- Faner: Arbeidsliste (default) / Avviksliste
- A2-filter: skjuler avvik der tilknyttet tilbud er sendt (`sent_to_customer=true`)
- Toggle "Vis også sendte" viser filtrerte

### Tilbudsmodul (`/admin/tilbud.html`)
- Tilbud lages fra arbeidslista → deeplink `?openQuote=<id>`
- Statuser: `pending → sent → accepted / rejected_customer` (+ `rejected_admin` av admin)
- Dedikerte endepunkter: `POST /api/quotes/:id/mark-as-sent`, `mark-accepted`, `mark-rejected-customer`
- Fritt status-dropdown har kun: Venter, Avvist, Avvist av admin (Sendt/Godkjent/Avvist av kunde er dedikerte knapper)
- Sendte tilbud: status-felt skjult, readonly-badge vises
- Datoer vist: Opprettet (created_at), Godkjent av kunde (approved_at, kun accepted)

### Dashboard (`/admin/dashboard.html`)
- KPI-bokser inkl. "Tilbud venter på kunde" og "Servicer med uhåndterte avvik"

---

## E2E test-filer

```
tests/e2e/
├── README.md                    # Oppsett og kjøreinstrukser
├── playwright.config.ts         # Playwright-konfig
├── auth.setup.ts                # Login-setup (kjøres én gang)
├── avvik.spec.ts                # Avvik-flyt-tester
├── tilbud.spec.ts               # Tilbud-flyt-tester
└── .env.e2e                     # (lag selv, ikke commit) URL + credentials
```

---

## Kjøring

```bash
# Installer avhengigheter (én gang)
npm install --save-dev @playwright/test
npx playwright install chromium

# Lag .env.e2e med:
# E2E_BASE_URL=https://airtechdev.servfix.no
# E2E_ADMIN_EMAIL=<epost>
# E2E_ADMIN_PASSWORD=<passord>

# Kjør alle E2E-tester
npm run test:e2e

# Med synlig nettleser
npm run test:e2e:headed

# Trinnvis debug
npm run test:e2e:debug
```

---

## Vanlige oppgaver du kan be AI-agenten om

### Legg til ny E2E-test
> "Legg til en E2E-test i `tests/e2e/tilbud.spec.ts` som verifiserer at [beskriv scenario]."

### Fiks feilet test
> "Testen `[testnavn]` i `tests/e2e/avvik.spec.ts` feiler med feil [feilmelding]. Fiks den."

### Kjør og rapporter
> "Kjør `npm run test:e2e` og rapporter alle feil med skjermbilder."

### Oppdater testdata
> "Legg til et pending-tilbud i `airtech_db` som testdata for [testnavn]."

---

## Viktige regler

- **Ingen parseInt på VARCHAR**-IDer (quotes.id, orders.id er varchar(50))
- **Ingen commits** fra agent — Tom-Erik committer selv
- Testene skal fungere mot `https://airtechdev.servfix.no` (dev-miljø)
- Bruk `test.skip()` hvis nødvendig testdata mangler — ikke hardkod data
- CSS-klasser som er stabile å bruke: `.quote-item`, `.status-{status}`, `.action-buttons-modern`, `#worklist-orders`, `#worklist-counters`, `#view-worklist-btn`, `#view-list-btn`
