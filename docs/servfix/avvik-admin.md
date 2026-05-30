# Admin avvikshåndtering (deviations)

Dette dokumentet beskriver administrasjonsmodulen for avvikshåndtering i ServFix (fase 3 + 3.5). Modulen brukes til å følge opp avvik som er registrert av teknikere ute i felt, tildele utbedringsoppgaver, sette frister og generere eksportrapporter.

## Aktivering og tilgang

Modulen styres av flagg i tenantens `settings.json`.

*   **Flagg (module_flags):**
    *   `show_avvik_module`: Styrer synlighet i Admin UI.
    *   `enable_deviations_management`: Styrer behandling av avvik i backend.
*   **Aktivering:** Toggles i `innstillinger.html` via checkbox med id `show-avvik-module-toggle`. Begge flagg lagres samtidig via `POST /api/images/save-settings`.
*   **Autorisasjon:** Krever `req.session.isAdmin === true` og gyldig `tenantId`. Rutene er beskyttet av `adminTenant`-middleware.

**Merk:** Admin-API-et (`/api/admin/deviations`) er alltid tilgjengelig for administratorer, men selve rapportbehandlingen og synlighet i menyene krever at flaggene er aktivert.

## Datamodell

Modellen er definert i migrasjonen `2026-05-deviations-foundation.js`.

### Tabell: `deviations`
Hovedtabellen for et vedvarende avvik på et spesifikt utstyr/sjekkpunkt.

| Kolonne | Type | Beskrivelse |
| :--- | :--- | :--- |
| `id` | SERIAL | Primærnøkkel. |
| `equipment_id` | INT | FK til `equipment`. |
| `checklist_item_id` | VARCHAR | ID til sjekkpunktet fra malen. |
| `status` | VARCHAR | `open`, `assigned`, `in_progress`, `fixed_pending_verification`, `closed`. |
| `current_severity` | VARCHAR | `lav`, `medium`, `høy`. |
| `current_summary` | TEXT | Siste sammendrag av tilstand. |
| `opened_at` | TIMESTAMPTZ | Tidspunkt for første gangs registrering. |
| `assigned_to_user_id` | VARCHAR | FK til `technicians`. |
| `deadline` | DATE | Frist for utbedring. |
| `closure_mode` | VARCHAR | `fixed_on_visit`, `manual_close`, `accepted_by_customer`, `legacy_migrated`. |
| `closure_comment` | TEXT | Kommentar ved lukking. |

**Constraint:** Det kan kun finnes ett aktivt (ikke-lukket) avvik per kombinasjon av `equipment_id` og `checklist_item_id`.

### Tabell: `deviation_observations`
Hver gang en tekniker observerer et eksisterende avvik under en ny service, registreres en observasjon.

| Kolonne | Type | Beskrivelse |
| :--- | :--- | :--- |
| `deviation_id` | INT | FK til `deviations`. |
| `service_report_id` | VARCHAR | FK til service-rapporten observasjonen ble gjort i. |
| `observed_at` | TIMESTAMPTZ | Tidspunkt for observasjonen. |
| `comment` | TEXT | Teknikerens kommentar i sjekklisten. |
| `severity` | VARCHAR | Alvorlighetsgrad ved denne observasjonen. |

### Tabell: `avvik_images` (utvidet)
Bilder knyttet til avvik bruker den eksisterende `avvik_images`-tabellen, utvidet med:
*   `deviation_id`: Kobling til hovedavviket.
*   `deviation_observation_id`: Kobling til den spesifikke observasjonen bildet ble tatt under.

## API-kontrakt

Alle endepunkter er montert under `/api/admin/deviations`.

### 1. GET `/` (Hent liste)
Henter en liste over avvik med filtrering og paginering.

*   **Query-parametre:**
    *   `status`: Komma-separert liste (default: alle aktive statuser).
    *   `severity`: Komma-separert liste (`lav`, `medium`, `høy`).
    *   `equipmentId`: Filtrer på spesifikt utstyr.
    *   `dateFrom` / `dateTo`: Åpnet-dato intervall.
    *   `limit` / `offset`: For paginering (limit default 50, max 200).
    *   `sort`: `severity_desc_opened_asc` (default), `opened_desc`, `deadline_asc`.
*   **Respons:** `{ total, limit, offset, items: [...] }`

### 2. GET `/:id` (Hent detalj)
Returnerer fullstendig informasjon om et avvik, inkludert alle observasjoner og bilder.

*   **Respons:** Inkluderer `observations[]` og `images[]`.

### 3. PUT `/:id` (Oppdater)
Oppdaterer avvikets tilstand eller tildeling.

*   **Body (valgfrie felt):**
    *   `status`: Endre status. Hvis `closed`, er `closureMode` påkrevd.
    *   `assignedToUserId`: Tildel tekniker. Setter `assigned_at` automatisk ved første tildeling.
    *   `deadline`: Sett utbedringsfrist.
    *   `currentSeverity`: Endre alvorlighet (normaliseres: high -> høy, low -> lav).
    *   `closureMode` / `closureComment`: Brukes ved lukking.
*   **Statuskoder:** 200 OK, 400 Ugyldig data, 404 Ikke funnet.

### 4. GET `/export` (Eksport)
Genererer CSV eller PDF av avvikene.

*   **Parametre:**
    *   `format`: `csv` eller `pdf` (påkrevd).
    *   `scope`: `filtered` (bruker samme filtre som listen) eller `all`.
*   **CSV-kolonner:** `id`, `equipmentName`, `checklistItemLabel`, `status`, `severity`, `openedAt`, `daysOpen`, `assignedToName`, `deadline`, `observationCount`, `closedAt`, `closureMode`, `closureComment`.
*   **PDF:** Genereres via Puppeteer. A4 portrett, én side per avvik (kort-format), inkluderer inntil 20 observasjoner og 6 bilder inlinet.

## Status-livsløp

1.  **open:** Opprettet av tekniker i felt (nytt avvik).
2.  **assigned:** Tildelt en tekniker av admin.
3.  **in_progress:** Arbeid påbegynt.
4.  **fixed_pending_verification:** Markert som utbedret av tekniker, men ikke verifisert av admin/kunde.
5.  **closed:** Endelig lukket.

**Automatisering:** Hvis en tekniker markerer et sjekkpunkt som OK under et senere besøk, kan systemet automatisk sette status til `closed` med mode `fixed_on_visit`.

## Admin UI og Selektorer (for E2E-testing)

Siden er tilgjengelig på `/admin/avvik.html`.

| Element | Selektor | Type |
| :--- | :--- | :--- |
| Filter Status | `#filter-status` | `select[multiple]` |
| Filter Alvorlighet | `#filter-severity` | `select[multiple]` |
| Filter Dato Fra/Til | `#filter-date-from`, `#filter-date-to` | `input[type="date"]` |
| Filter Sortering | `#filter-sort` | `select` |
| Søk-knapp | `button[onclick="applyFilters()"]` | Button |
| Tabell-body | `#deviations-table-body` | Tbody |
| Tabell-rad | `tr[data-id]` | Row (anbefalt `data-testid`) |
| Detaljpanel | `#avvik-detail-panel` | Overlay |
| Tildel-dialog | `#dialog-assign` | Dialog |
| Tekniker-valg | `#assign-technician` | Select |
| Deadline-input | `#deadline-input` | Date input |
| Lukk-dialog | `#dialog-close` | Dialog |
| Eksport-knapp | `#avvikExportBtn` | Button |
| Eksport-submit | `#avvikExportSubmit` | Button |

## E2E-testing og Verifikasjon

### Testoppsett
Systemet bruker Jest 30 og Supertest for integrasjonstester. Databasen mockes (`jest.mock('../src/config/database')`) for å unngå sideeffekter.

**Kommandoer:**
*   `npm test`: Kjører alle tester.
*   `npx jest tests/admin-deviations.test.js`: Kjører spesifikke avvikstester.
*   `npm run cloud-proxy-test`: Starter proxy mot test-databasen på port 5433.

### Boilerplate for API-test (Jest/Supertest)
```javascript
const request = require('supertest');
const app = require('../server'); // Eller en dedikert test-app setup

describe('Admin Deviations API', () => {
  it('skal hente liste over åpne avvik', async () => {
    const res = await request(app)
      .get('/api/admin/deviations?status=open')
      .set('Cookie', ['admin_session=...']); // Krever gyldig session
    expect(res.status).toBe(200);
    expect(res.body.items).toBeDefined();
  });
});
```

### Anbefalte test-scenarier
1.  **Listevisning:** Gitt at det finnes 3 avvik, når admin åpner siden, skal tabellen vise 3 rader.
2.  **Filtrering:** Gitt avvik med ulik alvorlighet, når admin velger "Høy", skal kun høy-alvorlighet vises.
3.  **Tildeling:** Gitt et åpent avvik, når admin velger en tekniker og lagrer, skal avviket få status `assigned` og `assigned_to_user_id` oppdateres i DB.
4.  **Lukking:** Gitt et avvik, når admin lukker med `manual_close`, skal `closed_at` settes og avviket forsvinne fra standard-listen.
5.  **Eksport:** Verifiser at `/api/admin/deviations/export?format=csv` returnerer en fil med riktige headere og UTF-8 BOM.
6.  **Sikkerhet:** Verifiser at en tekniker-session får `401` eller `403` ved forsøk på å aksessere `/api/admin/deviations`.
