# Deviations-modul: Statusrapport rekognosering (read-only)

## TL;DR

> **Quick Summary**: Diagnose hvorfor `airtechdev.deviations` var tom etter Tom-Eriks live-test, og kartlegg status på fase 1 (DB), fase 2 (backend), og fase 3 (admin-UI) for deviations-modulen i Servfix Cloud. Ren analyse — null endringer.
>
> **Deliverables**:
> - Statusrapport printet inline i chat
> - Markdown-kopi lagret i `.omo/reports/deviations-status-{YYYY-MM-DD}.md`
> - Klar diagnose av root cause (eller eksplisitt liste over gjenværende kandidater hvis ikke entydig)
> - Konkret anbefaling om neste steg (fiks fase 2 vs. start fase 3)
>
> **Estimated Effort**: Medium (30-45 min eksekvering)
> **Parallel Execution**: YES — 3 waves
> **Critical Path**: W1.1 (env preflight) → W2 (hypotese-tester parallelt) → W3.1 (syntese + rapport) → F1-F4

---

## Context

### Original Request
Tom-Erik har bygget en avvikshåndteringsmodul i tre faser. Fase 1 (DB-skjema) og fase 2 (backend) skal være ferdig, men i siste live-test mot dev registrerte han 2 avvik og ferdigstilte rapportene, og `deviations`-tabellen hadde 0 rader. Han trenger en presis statusrapport før han planlegger fase 3 (admin-UI).

### Interview Summary

**Avklart i intervju**:
- Miljø: **dev** (ikke test som original-prompten sa)
- Cloud SQL proxy port: **5434** (admin-startet av Tom-Erik, ikke planen)
- GCP project: **servfix-dev**
- Kodebase: **C:\apps\servfix-dev** (current workdir)
- Tenant-scope: **kun `airtechdev`** (eneste relevante i dev)
- Test-prosedyre Tom-Erik brukte: **Frontend UI** (tekniker fyller ut + ferdigstiller)
- Test-tidspunkt: **ukjent** → bruk bredt vindu (14 dager) og rapporter åpent
- Avviks-felt-shape i `checklist_data`: **ukjent** → Sisyphus oppdager fra `deviationsService.js`-kildekode først
- Rapport-format: **inline i chat + markdown-fil i `.omo/reports/`**

**Forhånds-probing (allerede gjort i intervju)**:
- `src/services/deviationsService.js` EKSISTERER
- `src/routes/reports.js` EKSISTERER
- `tests/deviations-service.test.js` EKSISTERER
- `src/routes/admin/deviations.js` EKSISTERER IKKE → fase 3 ikke startet
- `src/routes/admin/` mappen finnes (andre admin-ruter)
- `public/admin/` mappen finnes (kan inneholde påbegynt UI)
- `package.json`: jest brukes, ingen dev-proxy-script (kun `cloud-proxy-test` for port 5433)
- `.github/copilot-instructions.md`: "deviation handling with images" markert som HØYRISIKO

### Metis Review — Critical Findings Incorporated

**Strukturell endring fra implementasjon-plan til diagnose-plan**:
- Wave 2 organiseres som **hypotese-tester**, ikke tasks
- Hver hypotese har eksplisitt evidens-krav (sitert artefakt) og short-circuit-logikk
- Plan har eksplisitte STOPP-kriterier (proxy nede, ingen data, wrong project, etc.)

**Hypoteser som testes (H1 først — billigst og mest sannsynlig)**:
- **H1**: Migrasjon kjørte aldri på `airtechdev`
- **H2**: Feature-flag `enable_deviations_management` er av i settings.json
- **H3**: Hook (`processReportDeviations`) er ikke kalt fra `POST /:reportId/complete`
- **H4**: Hook er fire-and-forget (mangler `await`) → silent swallow av feil
- **H5**: `checklist_data` matcher ikke shape som `processReportDeviations` forventer
- **H6**: Silent exception (synlig kun i Cloud Logging)
- **H7**: Kode er endret etter testen ble kjørt (git history på service-filen)

**Write-prevention guardrails** (eksplisitt):
- Alle DB-kall starter med SELECT/EXPLAIN
- `SET default_transaction_read_only = on;` ved session-start hvis tilgjengelig
- Ingen migrasjon/seed/restart/IAM
- Ingen kildekode-edits, selv "fix typo" eller "legg til manglende await"
- Hvis bug funnet: dokumentér med fil:linje i rapport, STOPP der

**Jest-sikkerhetssjekk**: Les `tests/deviations-service.test.js` først for å bekrefte mocks. Hvis ekte DB-tilkobling: SKIP test-kjøring og rapportér hvorfor.

---

## Work Objectives

### Core Objective
Levere en presis, evidens-basert statusrapport på deviations-modulens fase 1, 2 og 3 i dev-miljøet, med klar diagnose av hvorfor live-testen ikke skapte deviation-rader, og konkret anbefaling om neste steg — uten å gjøre noen endringer.

### Concrete Deliverables
- **Markdown-rapport**: `.omo/reports/deviations-status-{YYYY-MM-DD}.md` (samme dato som kjøring) med 5 hovedseksjoner: Fase 1 DB-status, Fase 2 kode-status, Fase 2 funksjonell verifisering, Fase 3 forberedelser, Anbefalt neste steg
- **Inline output**: Hele rapporten printet i samtalen så Tom-Erik kan lese den direkte
- **Diagnose**: Hvert testet hypotese (H1-H7) merkes som Confirmed / Probable / Possible / Ruled Out, med sitert evidens
- **Evidens-vedlegg**: Verbatim query-output, kode-snippets, log-linjer — ingen parafrasering

### Definition of Done
- [ ] Rapport-fil eksisterer på riktig sti: `Test-Path .omo\reports\deviations-status-*.md` returnerer True
- [ ] Rapport inneholder alle 5 seksjoner
- [ ] Hver hypotese (H1-H7) har eksplisitt confidence-level + sitert evidens
- [ ] Rapport printes inline i samtalen
- [ ] Final-statement: "No DB writes, no source edits, no deploys, no IAM changes were performed" — verbatim
- [ ] Git-status er ren etter eksekvering: `git status --porcelain` viser KUN nye filer under `.omo/reports/` (og evt. `.omo/evidence/`)

### Must Have
- Eksplisitt verifisering at `airtechdev`-schema/database eksisterer på port 5434 før noen DB-spørringer
- Eksplisitt verifisering at `gcloud config get-value project` er `servfix-dev` før noen gcloud-kall
- Schema-dump (`\d deviations`, `\d deviation_observations`) verbatim i rapport
- Hook-trace: eksakt fil:linje for hvor `processReportDeviations` importeres og kalles i `reports.js`
- Sjekk om hook-kallet er `await`-et eller fire-and-forget — eksplisitt rapportert
- Migrasjonssjekk: liste migrasjonsfiler relevante for deviations + sjekk om de er kjørt (knex_migrations eller tilsvarende)
- Settings.json feature-flag-verdi for `airtechdev`
- For hver av hypotesene H1-H7: enten Confirmed/Ruled Out med evidens, eller Probable/Possible med begrunnelse

### Must NOT Have (Guardrails — HARD CONSTRAINTS)
- **INGEN DB-skrivinger** av noen art (ingen INSERT/UPDATE/DELETE/TRUNCATE/DROP/CREATE/ALTER, ingen migrasjons-kommandoer)
- **INGEN kildekode-endringer** — ikke engang "small fixes" som å legge til `await` eller fikse typos
- **INGEN deploys** til noe miljø
- **INGEN IAM-endringer**
- **INGEN restart** av services, containers eller proxy
- **INGEN nye filer** utenom rapport i `.omo/reports/` og evt. evidens i `.omo/evidence/`
- **INGEN git mutations** (commit, stash, checkout, branch, push)
- **INGEN `npm install`** eller `package.json`-endringer
- **INGEN test eller production-DB-tilgang** — kun `airtechdev` på port 5434
- **INGEN GCS-skriving** — kun read (cat/ls)
- **INGEN scope-utvidelse**: Ikke begynne å skrive admin-endepunkt eller frontend, selv om det åpenbart "mangler"
- **INGEN gjetting**: Hvis noe er uklart eller mangler, STOPP og rapportér som blocker — ikke fabrikker en konklusjon

### Spec Framework Integration
> Ingen SDD-framework (OpenSpec, Spec Kit) detektert i repo. Seksjonen er N/A. Repoet har `/specs`-mappe per copilot-instructions, men dette er ikke et SDD-framework og brukes ikke for plan-generering.

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — all verifikasjon er agent-eksekvert via konkrete bash/psql/gcloud-kommandoer.

### Test Decision
- **Infrastructure exists**: YES (jest)
- **Automated tests**: Eksisterende test (`tests/deviations-service.test.js`) kjøres KUN hvis den bekreftes å bruke mocks. Ingen nye tester skrives — dette er analyse, ikke implementasjon.
- **Agent-Executed QA**: ALWAYS — hver task har konkrete kommandoer med forventet output

### QA Policy
Hver task har QA Scenarios med eksakt verktøy + steg + assertions + evidens-sti.
- **DB-sjekker**: `psql` (Bash) — output saved to `.omo/evidence/`
- **Filsystem-sjekker**: `Test-Path` / `Get-Content` / `Select-String` (Bash) — output captured
- **GCP-sjekker**: `gcloud` — output captured
- **Kode-trace**: ast_grep_search / grep — output captured
- **Rapport-verifisering**: Read tool på `.omo/reports/`-fil + assertion på innhold

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Preflight — MÅ være grønn før Wave 2a starter):
└── W1.1: Environment preflight (proxy, gcloud, schema, bucket, source files)

Wave 2a (Uavhengige hypotese-tester — 7 PARALLELLE etter W1.1):
├── W2.1: H1 — Migrasjon-verifisering (knex_migrations + migrasjonsfiler)
├── W2.2: H2 — Feature-flag verifisering (settings.json fra GCS)
├── W2.3: DB schema-verifisering (tables, constraints, indexes) på airtechdev
├── W2.4: Backend kode-lesing (deviationsService.js + reports.js hook + middleware)
├── W2.6: Jest test-sikkerhetssjekk + kjøring (kun hvis mocks)
├── W2.8: H6 — Cloud Logging-sjekk (bredt vindu, 14 dager)
└── W2.9: H7 — Git history på service-filen

Wave 2b (Avhengige hypotese-tester — 3 PARALLELLE etter W2a):
├── W2.5: H3 + H4 — Hook trace og await-sjekk (avhenger av W2.4)
├── W2.7: H5 — Live data-sjekk + checklist_data shape-match (avhenger av W2.4)
└── W2.10: Fase 3 forberedelses-kartlegging (admin-routes, public/admin, QA-spec) — uavhengig, men plassert her for å balansere Wave 2a-størrelse

Wave 3 (Syntese + rapport — etter ALLE W2-tasks):
└── W3.1: Generer statusrapport (markdown-fil + print inline)

Wave FINAL (4 parallelle reviews — etter W3.1):
├── F1: Plan compliance audit (oracle) — sjekk Must Have/Must NOT Have
├── F2: Code quality review (unspecified-high) — N/A for analyse, sjekker kun at INGEN kode-endringer ble gjort
├── F3: Real manual QA (unspecified-high) — verifiserer rapportens innhold mot evidens
└── F4: Scope fidelity check (deep) — sjekker at planen ble fulgt, ingen scope creep

Critical Path: W1.1 → W2.4 (kode-lesing) → W2.5 eller W2.7 (lengste W2b) → W3.1 → F1-F4 → user okay
Parallel Speedup: ~65% vs sekvensiell (7 + 3 vs ett-og-ett)
Max Concurrent: 7 (Wave 2a)
```

### Dependency Matrix

- **W1.1**: depends on — none — blocks W2.1-W2.10
- **W2.1 (H1 migrasjon)**: depends on W1.1 — blocks W3.1
- **W2.2 (H2 feature-flag)**: depends on W1.1 — blocks W3.1
- **W2.3 (DB schema)**: depends on W1.1 — blocks W3.1
- **W2.4 (kode-lesing)**: depends on W1.1 — blocks W2.5, W3.1
- **W2.5 (H3+H4 hook trace)**: depends on W2.4 — blocks W3.1
- **W2.6 (jest)**: depends on W1.1 — blocks W3.1
- **W2.7 (live data + H5)**: depends on W1.1, W2.4 (trenger felt-shape fra service-fil) — blocks W3.1
- **W2.8 (H6 logging)**: depends on W1.1 — blocks W3.1
- **W2.9 (H7 git history)**: depends on W1.1 — blocks W3.1
- **W2.10 (fase 3 probe)**: depends on W1.1 — blocks W3.1
- **W3.1 (rapport)**: depends on ALL W2 — blocks F1-F4
- **F1-F4**: depends on W3.1 — blocks user okay

### Agent Dispatch Summary

- **Wave 1**: 1 task — W1.1 → `quick`
- **Wave 2a**: 7 tasks (parallelle) — alle → `unspecified-low`
- **Wave 2b**: 3 tasks (parallelle, etter W2a) — W2.5 → `unspecified-high`, W2.7 → `unspecified-high`, W2.10 → `unspecified-low`
- **Wave 3**: 1 task — W3.1 → `writing` (rapport-syntese)
- **Wave FINAL**: 4 tasks — F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [ ] 1. Wave 1 — Environment preflight (proxy, gcloud, schema, bucket, source files)

  **What to do**:
  - Verifiser at Cloud SQL proxy svarer på `localhost:5434`: `pg_isready -h localhost -p 5434` (eller `Test-NetConnection localhost -Port 5434` på Windows).
  - Verifiser gcloud aktivt prosjekt: `gcloud config get-value project` → må returnere `servfix-dev`.
  - Verifiser gcloud auth: `gcloud auth list` → må vise en aktiv konto.
  - List databaser tilgjengelig på 5434: `psql -h localhost -p 5434 -U postgres -l` (eller hvilken user Tom-Erik bruker — prøv standard først).
  - Verifiser at databasen som tilsvarer airtechdev finnes — noter eksakt navn (kan være `airtechdev`, `airtech_dev`, `airtechdev_db`, eller schema i felles DB).
  - List GCS buckets: `gcloud storage ls` → bekreft `gs://servfix-files-dev/` (eller variant) finnes.
  - Verifiser at alle disse filene eksisterer: `src/services/deviationsService.js`, `src/routes/reports.js`, `tests/deviations-service.test.js`.
  - Skriv preflight-resultat til `.omo/evidence/w1-preflight.txt`.

  **Must NOT do**:
  - Forsøke å starte proxy hvis den er nede — STOPP og rapporter blocker
  - Re-autentisere gcloud hvis auth feiler — STOPP og rapporter
  - Gjette på database-navn hvis ingen variant matcher airtechdev — STOPP og spør Tom-Erik
  - Liste GCS-innhold utover bucket-navn (ikke `ls` inne i bucketen ennå, kun toppnivå)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Sjekkliste-aktig preflight med klare ja/nei-resultater, lite kompleksitet
  - **Skills**: []
    - Ingen skill nødvendig — bash + psql + gcloud er nok

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1 (sekvensiell)
  - **Blocks**: ALLE W2-tasks (W2.1 til W2.10)
  - **Blocked By**: None — start immediately

  **References**:
  - `package.json:cloud-proxy-test` — eksisterende proxy-script for test (port 5433). Ingen tilsvarende for dev — Tom-Erik kjører proxy eksternt på 5434.
  - Draft-fil: `.omo/drafts/deviations-status-recon.md` — alle miljø-beslutninger

  **WHY**: Hele resten av planen avhenger av at miljøet er på plass. Hvis preflight feiler er det INGEN POENG å fortsette — vi vil bare produsere feil-output. Fail fast.

  **Acceptance Criteria**:
  - [ ] `.omo/evidence/w1-preflight.txt` eksisterer og inneholder output av alle 6 sjekker
  - [ ] Hver sjekk markert PASS/FAIL eksplisitt
  - [ ] Hvis noen FAIL: rapport-fil indikerer blocker og ingen W2-tasks startes
  - [ ] Hvis alle PASS: airtechdev-database-navnet er notert eksplisitt for bruk i W2.1-W2.7

  **QA Scenarios**:

  ```
  Scenario: Happy path — alt grønt
    Tool: Bash (powershell)
    Preconditions: Tom-Erik har proxy oppe på 5434, gcloud autentisert, alle filer på plass
    Steps:
      1. Kjør pg_isready -h localhost -p 5434 → forventet exit code 0
      2. Kjør gcloud config get-value project → forventet "servfix-dev"
      3. Kjør psql -h localhost -p 5434 -U postgres -l → liste databaser, finn airtechdev-variant
      4. Kjør gcloud storage ls → finn servfix-files-dev bucket
      5. Kjør Test-Path src/services/deviationsService.js, src/routes/reports.js, tests/deviations-service.test.js → alle True
      6. Skriv samlet output til .omo/evidence/w1-preflight.txt
    Expected Result: Fil eksisterer, alle 6 sjekker viser PASS, airtechdev-navn notert
    Failure Indicators: Noen sjekk viser FAIL, eller airtechdev ikke funnet
    Evidence: .omo/evidence/w1-preflight.txt

  Scenario: Proxy nede — graceful stop
    Tool: Bash (powershell)
    Preconditions: Proxy ikke startet (port 5434 lukket)
    Steps:
      1. Kjør pg_isready -h localhost -p 5434 → forventet non-zero exit
      2. STOPP planen, marker W1.1 som BLOCKED
      3. Rapportér til Tom-Erik: "Proxy svarer ikke på 5434. Vennligst start cloud-sql-proxy mot servfix-dev og gjenstart."
    Expected Result: Plan stopper med klar melding, ingen W2-tasks forsøkes
    Evidence: .omo/evidence/w1-preflight-blocker.txt
  ```

  **Evidence to Capture**:
  - [ ] `.omo/evidence/w1-preflight.txt` (alle 6 sjekker)
  - [ ] Eksakt airtechdev-database-navn (for senere bruk)

  **Commit**: NO

- [ ] 2. Wave 2 — H1: Migrasjon-verifisering (kjørte migrasjonen på airtechdev?)

  **What to do**:
  - Finn migrasjonsfiler relevante for deviations: `Get-ChildItem migrations\ -Recurse | Select-String -List -Pattern "deviation|avvik"` (eller tilsvarende glob).
  - Les hver funnet fil og noter: filnavn, hva den oppretter (tabeller, constraints, indexes).
  - Verifiser at migrasjons-tracking-tabellen finnes på airtechdev: vanlige navn er `knex_migrations`, `pg_migrations`, `schema_migrations`. Kjør `\dt` på airtechdev og finn det.
  - Query migrasjons-tabellen: `SELECT name, batch, migration_time FROM <tracking_table> WHERE name ILIKE '%deviation%' OR name ILIKE '%avvik%' ORDER BY migration_time DESC;`
  - Sammenlign: matcher kjørte migrasjoner mot funne filer?
  - Skriv resultat til `.omo/evidence/w2-h1-migrations.txt`.

  **Must NOT do**:
  - Kjøre `knex migrate:latest`, `npm run migrate`, eller noen migrasjons-kommando
  - INSERT/UPDATE/DELETE i migrasjons-tabellen
  - Endre migrasjonsfiler

  **Recommended Agent Profile**:
  - **Category**: `unspecified-low`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (med W2.2-W2.10)
  - **Parallel Group**: Wave 2a
  - **Blocks**: W3.1
  - **Blocked By**: W1.1

  **References**:
  - Forventede migrasjonsmapper: sjekk `migrations/`, `src/migrations/`, `db/migrations/`
  - Hvis prosjektet bruker knex: `knexfile.js` viser konfigurasjon
  - Hvis raw SQL: `*.sql`-filer

  **WHY**: Hvis migrasjonen aldri kjørte på airtechdev, finnes ikke `deviations`-tabellen, og INSERT vil throw — sannsynligvis fanget i try/catch (basert på "ble ikke synlig"). Dette er **billigst-å-teste hypotesen** og må sjekkes først.

  **Acceptance Criteria**:
  - [ ] Liste over deviation-relaterte migrasjonsfiler i `.omo/evidence/w2-h1-migrations.txt`
  - [ ] Output fra migrasjons-tracking-tabellen verbatim
  - [ ] Eksplisitt konklusjon: H1 Confirmed (ikke kjørt) / Ruled Out (kjørt) / Possible (kan ikke avgjøres pga X)
  - [ ] Hvis Confirmed: STOPP videre hypotese-testing er IKKE påkrevd, men rapporter at H1 er root cause

  **QA Scenarios**:

  ```
  Scenario: H1 Ruled Out — migrasjon kjørte
    Tool: Bash (powershell + psql)
    Preconditions: W1.1 PASS, airtechdev-navn kjent
    Steps:
      1. Get-ChildItem migrations/ | Select-String "deviation" → liste filer
      2. psql -h localhost -p 5434 -d <airtechdev> -c "\dt" → finn tracking-tabell
      3. psql -c "SELECT * FROM knex_migrations WHERE name ILIKE '%deviation%';" → rader returnert
      4. Skriv til .omo/evidence/w2-h1-migrations.txt med verbatim output
    Expected Result: Migrasjoner listet både som filer og som kjørt, H1 = Ruled Out
    Evidence: .omo/evidence/w2-h1-migrations.txt

  Scenario: H1 Confirmed — migrasjon kjørte ikke
    Tool: Bash (powershell + psql)
    Preconditions: W1.1 PASS
    Steps:
      1. Finn migrasjonsfiler — finnes
      2. Query tracking-tabell — tom for deviation-rader
    Expected Result: H1 = Confirmed, dette er root cause
    Evidence: .omo/evidence/w2-h1-migrations.txt med "CONFIRMED" header
  ```

  **Evidence to Capture**:
  - [ ] `.omo/evidence/w2-h1-migrations.txt`

  **Commit**: NO

- [ ] 3. Wave 2 — H2: Feature-flag verifisering (enable_deviations_management for airtechdev)

  **What to do**:
  - List innhold i tenant-mappen for airtechdev i GCS: `gcloud storage ls gs://servfix-files-dev/tenants/airtechdev/assets/` (eller hvilken sti som er konvensjonen).
  - Hvis settings.json finnes: `gcloud storage cat gs://servfix-files-dev/tenants/airtechdev/assets/settings.json`
  - Søk i output etter `enable_deviations_management` og noter verdi (true/false/undefined).
  - Søk også etter relaterte flagg: `module_flags`, `deviations`, `avvik`.
  - Hvis settings.json ikke finnes på denne stien: prøv andre stier (rot, eller `tenants/airtechdev/config/`) og rapportér hva som finnes.
  - Skriv resultat til `.omo/evidence/w2-h2-feature-flag.txt`.

  **Must NOT do**:
  - Modifisere settings.json
  - Skrive til GCS
  - Liste innhold dypere enn nødvendig (ikke `ls -r` på hele bucket)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-low`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2a
  - **Blocks**: W3.1
  - **Blocked By**: W1.1

  **References**:
  - Original-prompt nevnte `gs://servfix-files-test/tenants/demo/assets/settings.json` — analog sti for dev/airtechdev
  - `module_flags.enable_deviations_management` er feltet som styrer hooken (per original-prompt)

  **WHY**: Hvis flagget er false eller manglende, vil `processReportDeviations` early-return uten å skrive noe (per design). Dette er den nest-billigste hypotesen å teste.

  **Acceptance Criteria**:
  - [ ] Verdi for `enable_deviations_management` notert verbatim (eller "field not found")
  - [ ] Verbatim output av relevant del av settings.json
  - [ ] Eksplisitt konklusjon: H2 Confirmed (flagg av) / Ruled Out (flagg på) / Possible (kan ikke finne settings.json)

  **QA Scenarios**:

  ```
  Scenario: H2 Ruled Out — flagg er aktivt
    Tool: Bash (gcloud)
    Preconditions: W1.1 PASS, bucket-navn bekreftet
    Steps:
      1. gcloud storage cat gs://servfix-files-dev/tenants/airtechdev/assets/settings.json
      2. Parse JSON, finn module_flags.enable_deviations_management
      3. Verifiser verdi == true
    Expected Result: H2 = Ruled Out, flagg er aktivt
    Evidence: .omo/evidence/w2-h2-feature-flag.txt

  Scenario: H2 Confirmed — flagg av
    Steps: samme, men verdi er false eller manglende
    Expected Result: H2 = Confirmed, dette er root cause
    Evidence: .omo/evidence/w2-h2-feature-flag.txt
  ```

  **Evidence to Capture**:
  - [ ] `.omo/evidence/w2-h2-feature-flag.txt`

  **Commit**: NO

- [ ] 4. Wave 2 — DB schema-verifisering (deviations, deviation_observations, avvik_images-kobling)

  **What to do**:
  - Mot airtechdev-DB, kjør disse psql-kommandoene og lagre output verbatim:
    - `\dt` (liste alle tabeller — bekreft deviations + deviation_observations finnes)
    - `\d deviations` (kolonner, typer, defaults)
    - `\d deviation_observations` (kolonner, typer)
    - `\d avvik_images` (sjekk om deviation_id og deviation_observation_id-kolonner finnes)
    - Constraints: `SELECT conname, contype, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'deviations'::regclass;`
    - Indekser: `SELECT indexname, indexdef FROM pg_indexes WHERE tablename IN ('deviations','deviation_observations','avvik_images');`
  - Verifiser:
    - EXCLUDE-constraint på deviations for (equipment_id, checklist_item_id) for åpne avvik?
    - CHECK-constraint på severity som tillater `lav`, `medium`, `høy`?
    - Indekser som forventet (PK + relevante FK + søke-indexes)?
  - Skriv all output verbatim til `.omo/evidence/w2-schema.txt`.

  **Must NOT do**:
  - DDL (CREATE/ALTER/DROP)
  - INSERT/UPDATE/DELETE for å teste constraints
  - Hopp over verbatim-kravet — output må være eksakt som psql gir det

  **Recommended Agent Profile**:
  - **Category**: `unspecified-low`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2a
  - **Blocks**: W3.1
  - **Blocked By**: W1.1

  **References**:
  - Original-prompt spesifiserer kravene: EXCLUDE-constraint, severity CHECK, `avvik_images.deviation_id` + `deviation_observation_id`

  **WHY**: Bekrefter at fase 1 er på plass og dokumenterer det med verbatim DB-output. Også grunnlag for å avvise/bekrefte H1 (hvis tabellene IKKE finnes, går H1 fra Probable → Confirmed).

  **Acceptance Criteria**:
  - [ ] `.omo/evidence/w2-schema.txt` inneholder verbatim output av `\dt`, `\d deviations`, `\d deviation_observations`, `\d avvik_images`, constraints-query, indexes-query
  - [ ] Eksplisitt PASS/FAIL per krav: tables exist, deviation_id-kolonner i avvik_images, EXCLUDE-constraint, severity CHECK, expected indexes
  - [ ] Hvis tables IKKE finnes: marker H1 som Confirmed og kryss-referer

  **QA Scenarios**:

  ```
  Scenario: Schema fullt på plass
    Tool: Bash (psql)
    Preconditions: W1.1 PASS, airtechdev-navn kjent
    Steps:
      1. psql -d <airtechdev> -c "\dt" → liste, bekreft deviations + deviation_observations
      2. psql -d <airtechdev> -c "\d deviations" → output verbatim
      3. (osv. for hver kommando over)
      4. Konkatener alt til .omo/evidence/w2-schema.txt
    Expected Result: Alle tabeller og constraints finnes, alle krav PASS
    Evidence: .omo/evidence/w2-schema.txt

  Scenario: Tables mangler
    Tool: Bash (psql)
    Steps:
      1. \dt viser ingen deviations-tabell
      2. Markér H1 = Confirmed
    Expected Result: Diagnose peker mot manglende migrasjon
    Evidence: .omo/evidence/w2-schema.txt med "TABLES MISSING" header
  ```

  **Evidence to Capture**:
  - [ ] `.omo/evidence/w2-schema.txt`

  **Commit**: NO

- [ ] 5. Wave 2 — Backend kode-lesing (deviationsService.js + reports.js + middleware-scan)

  **What to do**:
  - Les `src/services/deviationsService.js` end-to-end. Noter:
    - Eksporterte funksjoner (særlig `processReportDeviations`)
    - Hvilket felt + verdi i checklist_data som regnes som "avvik" (eksakt path og verdi)
    - Sjekker den `enable_deviations_management`-flagget? Hvor i koden?
    - Logger den? Hvilke log-strenger? (For W2.8 Cloud Logging-søk)
    - Hvilke DB-spørringer kjøres? Bruker den connection pool, transaction, eller fire-and-forget?
    - Try/catch — hva fanges og hvordan håndteres feil?
  - Les `src/routes/reports.js`, spesielt `POST /:reportId/complete`-handleren. Noter:
    - Importeres `processReportDeviations`? Linjenummer.
    - Hvor i handleren kalles det? Før/etter RETURNING fra UPDATE? Linjenummer.
    - Er kallet `await`-et eller fire-and-forget? Linjenummer.
    - Er det try/catch rundt det?
  - Scan for andre relevante filer:
    - `Get-ChildItem src\middleware\ -Recurse` — finnes deviation-relatert middleware?
    - `Get-ChildItem src\models\ -Recurse -ErrorAction SilentlyContinue` — finnes deviation-modell?
    - `Select-String -Path src\**\*.js -Pattern "deviation|avvik" -List` — finnes andre referanser?
  - Skriv strukturert oppsummering til `.omo/evidence/w2-code-read.md` med:
    - Hovedfunn per fil
    - Kode-snippets verbatim (særlig hook-kallet i reports.js og felt-shape-detection i service)
    - Liste over alle deviation-relaterte filer

  **Must NOT do**:
  - Endre noen av filene
  - Hopp over verbatim-krav på snippets

  **Recommended Agent Profile**:
  - **Category**: `unspecified-low`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2a
  - **Blocks**: W3.1
  - **Blocked By**: W1.1 (output forbruker av W2.5 og W2.7 i Wave 2b)
  - **Blocks**: W2.5 (hook trace bygger på denne), W2.7 (data shape bygger på denne), W3.1
  - **Blocked By**: W1.1

  **References**:
  - `src/services/deviationsService.js`, `src/routes/reports.js`, `tests/deviations-service.test.js`
  - Existing routes for inspiration: andre filer i `src/routes/`

  **WHY**: Etablerer grunnsannheten om hva koden faktisk gjør — premiss for å diagnostisere hvorfor live-testen feilet. Output brukes av W2.5 (hook trace), W2.7 (data shape), og rapporten.

  **Acceptance Criteria**:
  - [ ] `.omo/evidence/w2-code-read.md` eksisterer
  - [ ] Per fil: liste funksjoner + linjenummer
  - [ ] Verbatim snippet av hook-kallet i `reports.js` (5-10 linjer rundt det)
  - [ ] Verbatim snippet av deviation-detection i `deviationsService.js`
  - [ ] Eksplisitt notert: felt+verdi som identifiserer "avvik" i checklist_data
  - [ ] Eksplisitt notert: er hook-kallet awaited (YES/NO)
  - [ ] Liste over alle deviation-relaterte filer funnet

  **QA Scenarios**:

  ```
  Scenario: Full code-trace
    Tool: Read tool + ast_grep_search + Bash (Select-String)
    Preconditions: W1.1 PASS
    Steps:
      1. Read src/services/deviationsService.js (hele filen)
      2. Read src/routes/reports.js (hele filen eller minimum hele complete-handleren)
      3. ast_grep_search lang=javascript pattern="processReportDeviations($$$)" — alle kall
      4. Select-String -Path src/**/*.js -Pattern "deviation|avvik" -List
      5. Skriv strukturert markdown til .omo/evidence/w2-code-read.md
    Expected Result: Fil eksisterer, inneholder verbatim snippets, alle felt notert
    Evidence: .omo/evidence/w2-code-read.md

  Scenario: Fil korrupt eller uventet shape
    Steps:
      1. Hvis service-filen ikke har processReportDeviations: rapportér som blocker for diagnose
    Expected Result: Marker som Possible H3 (hook eksisterer ikke i koden) og fortsett
    Evidence: .omo/evidence/w2-code-read.md med "UNEXPECTED" header
  ```

  **Evidence to Capture**:
  - [ ] `.omo/evidence/w2-code-read.md`

  **Commit**: NO

- [ ] 6. Wave 2 — H3 + H4: Hook trace og await-sjekk

  **What to do**:
  - Bygg på W2.4-output. Bekreft eksplisitt H3 og H4:
  - **H3**: Er `processReportDeviations` faktisk importert OG kalt i `POST /:reportId/complete`-handleren?
    - Bruk `ast_grep_search` lang=javascript pattern=`const $X = require('$$$deviationsService$$$')` ELLER `import $X from '$$$deviationsService$$$'`
    - ast_grep_search pattern=`processReportDeviations($$$)` i `src/routes/reports.js`
    - Verifiser at kallet er INNE i complete-handleren (ikke i en annen handler)
  - **H4**: Er kallet `await`-et?
    - Søk verbatim på linjen: er det `await processReportDeviations(...)` eller bare `processReportDeviations(...)`?
    - Hvis ingen `await` og funksjonen returnerer Promise: fire-and-forget → feil swallowes
  - Verifiser også: er det try/catch rundt det? (Fail-safe rapportert i original-prompt)
    - Hvis try/catch UTEN logging: feil kan være helt skjult
    - Hvis try/catch MED logging: skal være synlig i Cloud Logging (W2.8)
  - Skriv strukturert konklusjon til `.omo/evidence/w2-h3-h4-hook.md`.

  **Must NOT do**:
  - Endre koden, selv om manglende await er funnet
  - Anta await-status uten å sjekke verbatim

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Krever forsiktig kode-analyse + korrelasjon mellom await + try/catch + logging-mønster
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (avhenger av W2.4)
  - **Parallel Group**: Wave 2b (parallelt med W2.7, W2.10; etter W2.4)
  - **Blocks**: W3.1
  - **Blocked By**: W2.4

  **References**:
  - W2.4 output: `.omo/evidence/w2-code-read.md`
  - `src/routes/reports.js` (verbatim re-read av complete-handleren)

  **WHY**: Metis identifiserte at fire-and-forget (manglende `await`) er en HIGH-severity-mulighet som perfekt forklarer "0 rader, ingen feil". Dette er den mest forklarende hypotesen hvis H1+H2 er Ruled Out.

  **Acceptance Criteria**:
  - [ ] H3-status: Confirmed / Ruled Out / Possible — med verbatim kode-snippet (3-5 linjer rundt funn) sitert i evidens-fil
  - [ ] H4-status: Confirmed / Ruled Out / Possible — med verbatim kode-snippet (linje med eller uten `await`) sitert i evidens-fil
  - [ ] Possible-utfall brukes hvis: hook-kallet finnes i koden men i en uvanlig wrapper (f.eks. helper-funksjon eller higher-order), så await-status ikke kan avgjøres entydig, eller kode-strukturen avviker fra forventet shape
  - [ ] Try/catch-status og logging-status notert med verbatim snippet
  - [ ] Hvis H4 Confirmed: konkluder at silent fire-and-forget er Probable root cause

  **QA Scenarios**:

  ```
  Scenario: H4 Confirmed (fire-and-forget)
    Tool: ast_grep_search + Read
    Preconditions: W2.4 ferdig
    Steps:
      1. ast_grep_search lang=javascript pattern="processReportDeviations($$$)" — finn kall
      2. Read 3 linjer rundt kallet i reports.js
      3. Verifiser: ingen "await" foran kallet
    Expected Result: H4 = Confirmed, rapport viser snippet
    Evidence: .omo/evidence/w2-h3-h4-hook.md

  Scenario: H3 + H4 begge Ruled Out (korrekt await + kall finnes)
    Steps: samme, men "await processReportDeviations(...)" er funnet
    Expected Result: Begge Ruled Out, fortsett til H5/H6
    Evidence: .omo/evidence/w2-h3-h4-hook.md
  ```

  **Evidence to Capture**:
  - [ ] `.omo/evidence/w2-h3-h4-hook.md`

  **Commit**: NO

- [ ] 7. Wave 2 — Jest test-sikkerhetssjekk + (mulig) kjøring

  **What to do**:
  - Les `tests/deviations-service.test.js` end-to-end FØRST.
  - Identifiser DB-bruk:
    - Bruker den `jest.mock(...)` for å mocke DB?
    - Importerer den ekte connection-pool?
    - Bruker den in-memory test-DB (sqlite, pg-mem)?
    - Setter den opp/river ned data via `beforeEach`/`afterEach`?
  - **Beslutning**:
    - Hvis mocks: SAFE — kjør `npm test -- tests/deviations-service.test.js`, capture output
    - Hvis ekte DB-tilkobling: SKIP kjøring, rapportér eksplisitt hvorfor (write-prevention guardrail)
    - Hvis usikker: SKIP kjøring og rapportér usikkerhet
  - Skriv resultat til `.omo/evidence/w2-jest.txt` med:
    - Beslutning (RAN / SKIPPED) + begrunnelse
    - Hvis RAN: full test-output (pass/fail per test)
    - Hvis SKIPPED: hva som ble observert i test-filen som førte til skip

  **Must NOT do**:
  - Kjøre testen uten å verifisere mocks først
  - Kjøre full `npm test` (HØYRISIKO-område, kjør KUN deviations-service.test.js)
  - Endre test-filen

  **Recommended Agent Profile**:
  - **Category**: `unspecified-low`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2a
  - **Blocks**: W3.1
  - **Blocked By**: W1.1

  **References**:
  - `tests/deviations-service.test.js`
  - `package.json:test`: `jest tests/ --testPathIgnorePatterns=tenant-security`

  **WHY**: Metis flagget HIGH risk: hvis testen treffer ekte DB, bryter vi write-prevention. Test-eksistens og pass/fail er nyttig diagnose-info, men bare hvis trygt å kjøre.

  **Acceptance Criteria**:
  - [ ] `.omo/evidence/w2-jest.txt` eksisterer
  - [ ] Eksplisitt beslutning: RAN (med output) eller SKIPPED (med begrunnelse)
  - [ ] Hvis RAN: antall pass/fail rapportert

  **QA Scenarios**:

  ```
  Scenario: Tests mocket — trygt å kjøre
    Tool: Read + Bash (npm)
    Preconditions: W1.1 PASS
    Steps:
      1. Read tests/deviations-service.test.js → finn jest.mock-kall for DB
      2. Bekreft at ekte pg/knex ikke brukes
      3. npm test -- tests/deviations-service.test.js
      4. Capture full output til .omo/evidence/w2-jest.txt
    Expected Result: Test-output med pass/fail per test
    Evidence: .omo/evidence/w2-jest.txt

  Scenario: Ekte DB — SKIP
    Steps:
      1. Read test-fil → finn ekte pg/knex import uten mock
      2. SKIP test-kjøring
      3. Rapportér i fil hvorfor
    Expected Result: Ingen test kjørt, klar begrunnelse
    Evidence: .omo/evidence/w2-jest.txt med "SKIPPED" header
  ```

  **Evidence to Capture**:
  - [ ] `.omo/evidence/w2-jest.txt`

  **Commit**: NO

- [ ] 8. Wave 2 — H5: Live data-sjekk (nylige reports + checklist_data shape match)

  **What to do**:
  - På airtechdev, query nylige rapporter (bredt vindu, siden test-tidspunkt er ukjent):
    - `SELECT id, equipment_id, status, completed_at, created_at, updated_at FROM service_reports WHERE created_at > NOW() - INTERVAL '14 days' ORDER BY created_at DESC LIMIT 20;`
    - Noter status-fordeling (completed vs draft vs annet)
    - Filtrér deretter på `status = 'completed' AND completed_at > NOW() - INTERVAL '14 days'`
  - Hvis ingen rapporter siste 14 dager: STOPP, marker H5 og hele diagnostikken som BLOCKED — Tom-Erik må reprodusere
  - Hvis rapporter funnet: pluk de 2-3 nyeste completed-rapportene og query `checklist_data`:
    - `SELECT id, checklist_data FROM service_reports WHERE id IN (...) AND status = 'completed';`
  - **Match-sjekk** (krever W2.4-output med felt-shape som "avvik" identifiseres ved):
    - For hver rapport: parse `checklist_data` JSON
    - Søk etter items som matcher avviks-shape (eks: `status === 'avvik'`, `value === false`, eller hva W2.4 fant)
    - Tell antall matches per rapport
  - Skriv resultat til `.omo/evidence/w2-h5-data-shape.txt` med:
    - Rapport-IDs + status + timestamps
    - Verbatim `checklist_data` for 2-3 nyeste
    - Per rapport: antall items som matcher avviks-shape
    - Konklusjon: H5 Confirmed (mismatch) / Ruled Out (data har avvik-items)

  **Must NOT do**:
  - INSERT/UPDATE i service_reports
  - Modifisere checklist_data
  - Anta felt-shape uten å bruke W2.4-output

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Krever korrelasjon mellom kode (W2.4) og data (DB-query) + JSON-parsing
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (avhenger av W2.4)
  - **Parallel Group**: Wave 2b (parallelt med W2.5, W2.10; etter W2.4)
  - **Blocks**: W3.1
  - **Blocked By**: W1.1, W2.4

  **References**:
  - W2.4 output: `.omo/evidence/w2-code-read.md` (felt-shape)
  - Original-prompt SQL-eksempel

  **WHY**: Metis sa dette er **sannsynligvis mest sannsynlige root cause**: hvis frontend lagrer avvik som en annen shape enn `processReportDeviations` forventer (eks: `status: "deviation"` vs `status: "avvik"`), vil hooken kjøre uten å finne noe og rapportere 0 inserts uten feil.

  **Acceptance Criteria**:
  - [ ] `.omo/evidence/w2-h5-data-shape.txt` eksisterer
  - [ ] Antall completed reports siste 14 dager rapportert (med verbatim psql-output fra SELECT-spørringen)
  - [ ] Hvis 0: BLOCKED-flagg satt i rapport
  - [ ] Hvis ≥1: verbatim `checklist_data` JSON for de 2-3 nyeste completed reports er sitert i evidens-fil (ikke parafrasert, ikke trunkert utover rimelig formatering)
  - [ ] Per rapport: antall avviks-shape-matches notert, med eksempel-item som matcher (verbatim) eller ikke-matcher (verbatim første item) for å vise sammenligning
  - [ ] Konklusjon: H5 Confirmed / Ruled Out / Possible (med begrunnelse)

  **QA Scenarios**:

  ```
  Scenario: H5 Confirmed — data mismatch
    Tool: Bash (psql) + W2.4-output
    Preconditions: W1.1 PASS, W2.4 ferdig (felt-shape kjent)
    Steps:
      1. psql -c "SELECT id, status, completed_at FROM service_reports WHERE created_at > NOW() - INTERVAL '14 days' ORDER BY created_at DESC LIMIT 20"
      2. Filtrér completed, pluk 2-3 nyeste
      3. psql -c "SELECT checklist_data FROM service_reports WHERE id = X"
      4. Parse JSON, søk på shape fra W2.4
      5. 0 matches → H5 Confirmed
    Expected Result: Klar mismatch dokumentert med eksempler
    Evidence: .omo/evidence/w2-h5-data-shape.txt

  Scenario: H5 Ruled Out
    Steps: samme, men matches > 0 finnes — så hooken skulle ha skapt rader
    Expected Result: H5 Ruled Out, problemet ligger andre steder (H6 silent exception?)
    Evidence: .omo/evidence/w2-h5-data-shape.txt

  Scenario: BLOCKED — ingen reports
    Steps: Query returnerer 0 rader
    Expected Result: Rapporter blocker, anbefal Tom-Erik å reprodusere testen
    Evidence: .omo/evidence/w2-h5-data-shape.txt med "BLOCKED" header
  ```

  **Evidence to Capture**:
  - [ ] `.omo/evidence/w2-h5-data-shape.txt`

  **Commit**: NO

- [ ] 9. Wave 2 — H6: Cloud Logging-sjekk (silent exceptions, bredt vindu)

  **What to do**:
  - Bekreft først: `gcloud config get-value project` == `servfix-dev` (dobbel-sjekk, kritisk for korrekt logs).
  - Bredt vindu siden test-tidspunkt er ukjent: bruk `--freshness=14d`.
  - Query 1 — service-relaterte logger:
    ```
    gcloud logging read "resource.type=cloud_run_revision AND (textPayload:deviationsService OR textPayload:processReportDeviations OR jsonPayload.message:deviationsService OR jsonPayload.message:processReportDeviations)" --project=servfix-dev --limit=100 --freshness=14d --format="value(timestamp,severity,textPayload,jsonPayload.message)"
    ```
  - Query 2 — error-logger fra app:
    ```
    gcloud logging read "resource.type=cloud_run_revision AND severity>=ERROR" --project=servfix-dev --limit=50 --freshness=14d --format="value(timestamp,severity,textPayload,jsonPayload.message)"
    ```
  - Hvis Cloud Run service-navn er kjent fra W2.4 eller cloud-run-config, filtrér på det også.
  - Skriv resultat til `.omo/evidence/w2-h6-logging.txt` med:
    - Eksakte queries brukt (verbatim)
    - Antall rader returnert per query
    - Verbatim de 10-20 mest relevante linjer
    - Konklusjon: H6 Confirmed (errors funnet) / Ruled Out (ingen errors, hook kjørte rent) / Possible (ingen logger funnet — kan være log-rotasjon eller hook ikke trigget)

  **Must NOT do**:
  - `gcloud logging write` (write-kommando)
  - Endre log-konfigurasjon
  - Konkludere "ingen errors" hvis 0 logger returnert (kan være log-rotasjon — rapportér eksplisitt)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-low`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2a
  - **Blocks**: W3.1
  - **Blocked By**: W1.1

  **References**:
  - Original-prompt logging-query
  - W2.4-output kan gi log-strenger service-koden bruker (for mer presise søk)

  **WHY**: Hvis hooken kjørte med riktig data men kastet exception, vil silent try/catch + logging vise det her. Tre utfall (per original-prompt): A) skipped: module_disabled (H2), B) call + error (H6 Confirmed), C) ingen log (hook ikke trigget — peker mot H3).

  **Acceptance Criteria**:
  - [ ] `.omo/evidence/w2-h6-logging.txt` eksisterer
  - [ ] Begge queries kjørt, output verbatim
  - [ ] Hvis 0 rader: eksplisitt notert "logs may have rotated, or hook was never triggered, or service did not log this event"
  - [ ] Konklusjon med confidence-level

  **QA Scenarios**:

  ```
  Scenario: H6 Confirmed — errors funnet
    Tool: Bash (gcloud)
    Preconditions: W1.1 PASS, gcloud project verifisert
    Steps:
      1. gcloud config get-value project → "servfix-dev"
      2. Kjør Query 1 → fanger log-linjer
      3. Kjør Query 2 → fanger errors
      4. Skriv verbatim til evidence
    Expected Result: Errors med stack traces fanget
    Evidence: .omo/evidence/w2-h6-logging.txt

  Scenario: Ingen logger funnet
    Steps:
      1. Begge queries returnerer 0 rader
      2. Konklusjon: kan ikke avgjøres → marker som Possible
      3. Rapportér disclaimer om log-rotasjon
    Expected Result: Klar disclaimer, ikke "no errors" konklusjon
    Evidence: .omo/evidence/w2-h6-logging.txt med "INCONCLUSIVE" header
  ```

  **Evidence to Capture**:
  - [ ] `.omo/evidence/w2-h6-logging.txt`

  **Commit**: NO

- [ ] 10. Wave 2 — H7: Git history på service-fil + reports.js

  **What to do**:
  - `git log --oneline -20 src/services/deviationsService.js` → liste de 20 nyeste commits på denne filen
  - `git log --oneline -20 src/routes/reports.js` → liste de 20 nyeste commits
  - `git log --oneline -10` (siste 10 commits totalt) for kontekst
  - For de mest nylige commitsene (siste 14 dager): `git show --stat <commit_hash>` for å se hva som endret seg
  - Skriv til `.omo/evidence/w2-h7-git.txt` med:
    - Commit-historikk for begge filer
    - Diff-stats for siste 14 dagers commits
    - Konklusjon: H7 Confirmed (relevant commit etter test-tidspunkt) / Ruled Out (ingen relevante commits) / Possible (test-tidspunkt ukjent så kan ikke avgjøres definitivt)

  **Must NOT do**:
  - `git checkout`, `git reset`, `git rebase`, `git stash` — INGEN git mutations
  - Endre filer
  - Bytte branch

  **Recommended Agent Profile**:
  - **Category**: `unspecified-low`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2a
  - **Blocks**: W3.1
  - **Blocked By**: W1.1

  **References**:
  - `src/services/deviationsService.js`, `src/routes/reports.js`

  **WHY**: Hvis koden Sisyphus leser ER en annen versjon enn den som var deployet under testen, vil hele diagnosen være feilrettet. Metis flagget dette som Medium severity.

  **Acceptance Criteria**:
  - [ ] `.omo/evidence/w2-h7-git.txt` eksisterer
  - [ ] Commit-historikk per fil — verbatim `git log --oneline -20` output for begge filer sitert i evidens-fil
  - [ ] For hver commit siste 14 dager: verbatim `git show --stat <hash>` output sitert
  - [ ] Konklusjon med confidence-level (Possible som default siden test-tidspunkt ukjent, Ruled Out hvis ingen commits siste 14 dager)

  **QA Scenarios**:

  ```
  Scenario: Ingen nylige commits — H7 Ruled Out
    Tool: Bash (git)
    Steps:
      1. git log --oneline -20 src/services/deviationsService.js
      2. Verifiser ingen commits siste 14 dager (eller alle eldre enn potensielt test-tidspunkt)
    Expected Result: H7 Ruled Out
    Evidence: .omo/evidence/w2-h7-git.txt

  Scenario: Nylig commit — H7 Possible/Probable
    Steps:
      1. git log viser commit siste 14 dager
      2. git show --stat for å se omfang
      3. Konklusjon: kode kan ha endret seg etter test — marker som Possible
    Expected Result: Klar dokumentasjon av nylig commit
    Evidence: .omo/evidence/w2-h7-git.txt
  ```

  **Evidence to Capture**:
  - [ ] `.omo/evidence/w2-h7-git.txt`

  **Commit**: NO

- [ ] 11. Wave 2 — Fase 3 forberedelses-kartlegging (admin-API + frontend + QA-spec)

  **What to do**:
  - **API-endepunkter**:
    - `Get-ChildItem src\routes\admin\ -Recurse | Select-Object Name`
    - `Select-String -Path src\routes\admin\*.js -Pattern "deviation|avvik" -List`
    - Konklusjon: finnes `src/routes/admin/deviations.js`? (Vi vet allerede: NEI fra preflight)
  - **Frontend**:
    - `Get-ChildItem public\admin\ -Recurse | Select-Object FullName`
    - `Select-String -Path public\admin\* -Pattern "deviation|avvik" -List -ErrorAction SilentlyContinue`
    - Finnes filer/sider/komponenter som tyder på påbegynt admin-UI for avvik?
  - **QA-tester** (spesifikt etter regression-spec):
    - Original-prompten antok `E:\apps\servfix-qa\tests\regression\deviations-processing.spec.ts`
    - Forhånds-probing viste den IKKE finnes på den stien
    - Søk bredere: `Get-ChildItem -Path "..\servfix-qa\" -Recurse -Filter "*deviation*" -ErrorAction SilentlyContinue` (sjekk om servfix-qa repo eksisterer i søsken-mappe)
    - Også sjekk: `Get-ChildItem -Path "tests\" -Recurse -Filter "*deviation*"` (kanskje tester ligger i hovedrepo)
    - Hvis funnet: les og rapportér antall scenarier + TODOs
  - Skriv resultat til `.omo/evidence/w2-phase3-recon.md` med:
    - API-status: hva som finnes, hva som mangler
    - Frontend-status: hva som finnes, hva som mangler
    - QA-status: hva som finnes (hvis noe), hva som mangler

  **Must NOT do**:
  - Lage nye filer (selv ikke "stub" for admin-endepunkt)
  - Modifisere `public/admin/` eller routes
  - Lage QA-tester
  - Anta ting om servfix-qa-repo's plassering — sjekk eller rapportér som ukjent

  **Recommended Agent Profile**:
  - **Category**: `unspecified-low`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2b (parallelt med W2.5, W2.7; uavhengig av W2.4, plassert i 2b for å balansere wave-størrelse)
  - **Blocks**: W3.1
  - **Blocked By**: W1.1

  **References**:
  - `src/routes/admin/`, `public/admin/`, `tests/`
  - Søsken-repo (mulig): `..\servfix-qa\`

  **WHY**: Tom-Erik trenger å vite hva som allerede er gjort i fase 3 før han planlegger neste steg. Hvis noen filer allerede er stubbet, må planen for fase 3 ta hensyn til det.

  **Acceptance Criteria**:
  - [ ] `.omo/evidence/w2-phase3-recon.md` eksisterer
  - [ ] Eksplisitt API-status (ja/nei med fil-liste) — verbatim output av `Get-ChildItem src\routes\admin\` sitert i evidens-fil
  - [ ] Eksplisitt frontend-status (ja/nei med fil-liste hvis funnet) — verbatim output av `Get-ChildItem public\admin\ -Recurse | Select-Object FullName` sitert
  - [ ] Eksplisitt QA-status (ja/nei, sti, antall scenarier hvis funnet) — verbatim output av søk i `..\servfix-qa\` og `tests\` sitert (eller "path not found" verbatim)
  - [ ] Eventuelle grep-matches for "deviation|avvik" i admin/public sitert verbatim (linje + filnavn)

  **QA Scenarios**:

  ```
  Scenario: Recon komplett
    Tool: Bash (Get-ChildItem + Select-String)
    Preconditions: W1.1 PASS
    Steps:
      1. List admin-routes mappe
      2. Grep etter deviation/avvik
      3. List public/admin
      4. Grep etter deviation/avvik der
      5. Probe servfix-qa repo
      6. Skriv strukturert markdown
    Expected Result: Klar status på alle 3 fronter
    Evidence: .omo/evidence/w2-phase3-recon.md

  Scenario: servfix-qa repo ikke funnet
    Steps:
      1. Test-Path ..\servfix-qa\ → False
      2. Marker QA-status som "servfix-qa repo not found at expected sibling path — request Tom-Erik to clarify location"
    Expected Result: Rapport notert som incomplete med klar request
    Evidence: .omo/evidence/w2-phase3-recon.md
  ```

  **Evidence to Capture**:
  - [ ] `.omo/evidence/w2-phase3-recon.md`

  **Commit**: NO

- [ ] 12. Wave 3 — Generer statusrapport (markdown-fil + print inline)

  **What to do**:
  - Samle alle evidens-filer fra `.omo/evidence/` (w1-preflight, w2-h1 til w2-h7, w2-schema, w2-code-read, w2-jest, w2-phase3-recon).
  - Skriv `.omo/reports/deviations-status-{YYYY-MM-DD}.md` (bruk dagens dato i ISO-format) med disse 5 hovedseksjonene:

  **Seksjon 1: Fase 1 — DB-status**
    - Sub: Tabeller på plass (basert på W2.3 + W2.1)
    - Sub: Constraints (EXCLUDE for åpne avvik, severity CHECK)
    - Sub: Indekser
    - Sub: Migrasjons-status (H1)
    - Tabell: krav vs faktisk status, PASS/FAIL per
    - Verbatim sitater av `\d`-output for kontekst

  **Seksjon 2: Fase 2 — kode-status**
    - Sub: `deviationsService.js` — eksisterer, hovedfunksjoner, felt-shape for "avvik" notert, flag-sjekk, logging
    - Sub: `reports.js` hook — importert, kallet i complete-handler, `await`-status, try/catch-mønster (H3 + H4)
    - Sub: Jest tests — kjørt eller skippet med begrunnelse, pass/fail
    - Verbatim kode-snippets (5-10 linjer) for hook-kallet og avvik-detection

  **Seksjon 3: Fase 2 — funksjonell verifisering**
    - **Hypotese-tabell**: H1-H7, hver med Confidence (Confirmed/Probable/Possible/Ruled Out) + 1-2 setninger evidens + lenke til evidens-fil
    - **Live-test-resultat**: antall reports siste 14 dager, hvor mange med avviks-shape i checklist_data
    - **Diagnose-konklusjon**: én av:
      - "Root cause er H_X med høy konfidens. Anbefalt fiks: ..."
      - "Sannsynlig root cause er H_X (med begrunnelse). H_Y kan ikke utelukkes. Anbefalt fiks først: ..."
      - "Diagnose blokkert pga [konkret grunn]. For å komme videre må Tom-Erik ..."

  **Seksjon 4: Fase 3 — forberedelser**
    - Admin-API-status: hva som finnes, hva som mangler
    - Frontend-status: hva som finnes, hva som mangler
    - QA-status: hva som finnes (hvis noe), hva som mangler

  **Seksjon 5: Anbefalt neste steg**
    - **Hvis fase 2 ikke fungerer**: konkret fiks-rekkefølge basert på diagnose. F.eks. "1. Legg til `await` på hook-kallet i reports.js:L123. 2. Re-test live. 3. Hvis fortsatt 0 rader, gå til [neste hypotese]."
    - **Hvis fase 2 fungerer**: konkret fase 3-rekkefølge, første 2-3 oppgaver. F.eks. "1. Lag `src/routes/admin/deviations.js` med GET /api/admin/deviations endepunkt. 2. ..."
    - Inkluder eksplisitt: "Tom-Erik bør planlegge fase 3 i en ny Prometheus-sesjon når dette er klart."

  - **PRINT hele rapporten inline i samtalen** (ikke bare lenke til filen).
  - Avslutt med verbatim statement: "No DB writes, no source edits, no deploys, no IAM changes were performed during this analysis."

  **Must NOT do**:
  - Skrive rapport-fil utenfor `.omo/reports/`
  - Parafrasere evidens (skal være verbatim hvor mulig)
  - Hoppe over inline-printing
  - Anbefale ting som krever kode-endringer i denne planen — det er en separat plan for Tom-Erik å lage

  **Recommended Agent Profile**:
  - **Category**: `writing`
    - Reason: Syntese av evidens til strukturert, presis rapport — primært skrivings-arbeid
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (avhenger av ALLE W2-tasks)
  - **Parallel Group**: Wave 3
  - **Blocks**: F1-F4
  - **Blocked By**: W2.1, W2.2, W2.3, W2.4, W2.5, W2.6, W2.7, W2.8, W2.9, W2.10

  **References**:
  - Alle evidens-filer fra `.omo/evidence/`
  - Original-oppgave-spec for rapport-struktur (5 seksjoner)
  - Draft: `.omo/drafts/deviations-status-recon.md` for kontekst

  **WHY**: Dette er hele leveransen. Rapport-kvalitet bestemmer om Tom-Erik kan ta gode beslutninger om fase 3.

  **Acceptance Criteria**:
  - [ ] `.omo/reports/deviations-status-{YYYY-MM-DD}.md` eksisterer
  - [ ] Alle 5 seksjoner finnes (verifiser med Select-String på `## `-headers)
  - [ ] Hypotese-tabell inneholder alle 7 hypoteser med confidence-level
  - [ ] Hver hypotese har lenke/referanse til evidens-fil
  - [ ] Konkret anbefaling i Seksjon 5 (ikke "vi bør vurdere ...")
  - [ ] Rapport printet inline i samtalen
  - [ ] No-change-statement verbatim på slutten
  - [ ] Rapport er maks 2 sider (per original-spec) — ikke wall-of-text, kompakt

  **QA Scenarios**:

  ```
  Scenario: Rapport komplett og inline
    Tool: Write + bash (read back for verification)
    Preconditions: ALLE W2-evidens-filer eksisterer
    Steps:
      1. Read alle .omo/evidence/*-filer
      2. Bygg rapport-struktur (5 seksjoner)
      3. Write .omo/reports/deviations-status-{YYYY-MM-DD}.md
      4. Print rapport-innhold inline i samtalen
      5. Verifiser: Test-Path returnerer True, Select-String -Pattern "^## " viser ≥5 headers
    Expected Result: Fil eksisterer, alle seksjoner, inline output synlig
    Evidence: .omo/reports/deviations-status-{YYYY-MM-DD}.md

  Scenario: Missing evidence — rapporter åpent
    Steps:
      1. Hvis noen W2-task var BLOCKED: rapport noterer det eksplisitt i relevant seksjon
      2. Anbefaling i Seksjon 5 reflekterer usikkerheten
    Expected Result: Rapport er ærlig om grenser, ikke fabrikkert konklusjon
    Evidence: .omo/reports/deviations-status-{YYYY-MM-DD}.md
  ```

  **Evidence to Capture**:
  - [ ] `.omo/reports/deviations-status-{YYYY-MM-DD}.md` (selve leveransen)

  **Commit**: NO

---

## Final Verification Wave (MANDATORY — after W3.1)

> 4 review agents kjører i PARALLEL. ALLE må APPROVE. Presentér konsolidert resultat til Tom-Erik og få eksplisitt "okay" før arbeidet markeres ferdig.

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Les planen ende-til-ende. For hver "Must Have": verifisér evidens i rapport-filen. For hver "Must NOT Have": verifisér at INGEN slike handlinger ble utført — `git status --porcelain` skal kun vise nye filer under `.omo/reports/` og `.omo/evidence/`. Sjekk at evidens-filer eksisterer. Sjekk at rapport inneholder alle 5 seksjoner + confidence-levels for alle 7 hypoteser.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Hypoteser med evidens [N/7] | VERDICT: APPROVE/REJECT`

- [ ] F2. **No-Change Verification** — `unspecified-high`
  Verifisér at INGEN kode-endringer ble gjort. Kjør `git diff --stat` og `git status --porcelain` — output skal kun vise nye filer i `.omo/reports/` og `.omo/evidence/`. Hvis noen kildekodefiler vises som modified: REJECT umiddelbart. Sjekk også at `package.json`, `package-lock.json`, migrasjonsmapper er uendret. Sjekk at INGEN psql-session inneholdt write-statements (review evidens for DB-spørringer).
  Output: `Git clean [PASS/FAIL] | Code files modified [N — skal være 0] | DB writes detected [N — skal være 0] | VERDICT`

- [ ] F3. **Report Quality QA** — `unspecified-high`
  Les hele rapport-filen i `.omo/reports/`. Verifisér: alle 5 seksjoner finnes, hver hypotese har confidence + sitert evidens, anbefaling om neste steg er konkret (ikke "kanskje X eller Y"), evidens er verbatim ikke parafrasert. Sammenlign rapportens påstander mot evidens-filene — er det konsistent? Hvis rapporten påstår noe uten evidens-backing: REJECT.
  Output: `Seksjoner [5/5] | Hypoteser med evidens [N/7] | Konkret anbefaling [YES/NO] | Konsistens [PASS/FAIL] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For hver W2-task: les "What to do" og sammenlign med faktisk utført arbeid (evidens-filer). Verifisér 1:1 — alt i spec ble gjort (ingen mangler), ingenting utenfor spec ble gjort (ingen scope creep). Sjekk spesielt: ble noen kodeendringer "smuglet inn" som "fix while I'm here"? Ble noen tenants utenfor `airtechdev` undersøkt? Ble production eller test-miljø touched? Ble noe på fase 3 faktisk bygget i stedet for bare kartlagt?
  Output: `Tasks [N/N compliant] | Scope creep [CLEAN/N issues] | Forbudte handlinger [CLEAN/N] | VERDICT`

---

## Commit Strategy

> **INGEN COMMITS**. Dette er ren analyse. Rapport-filen i `.omo/reports/` lagres lokalt, men committes IKKE som del av denne planen. Tom-Erik bestemmer selv om/når den skal versjoneres.

- W1.1 → W3.1: NO COMMIT
- F1-F4: NO COMMIT
- Hvis user vil committe rapport etterpå: separat manuell handling utenfor planen.

---

## Success Criteria

### Verification Commands
```powershell
# Rapport eksisterer
Test-Path .omo\reports\deviations-status-*.md
# Forventet: True

# Ingen kode-endringer
git status --porcelain
# Forventet: kun "?? .omo/reports/..." og evt. "?? .omo/evidence/..." linjer — INGEN "M " linjer på src/, tests/, package.json, migrations/

# Evidens-filer eksisterer
Get-ChildItem .omo\evidence\ -ErrorAction SilentlyContinue
# Forventet: filer per hypotese-test

# Rapport inneholder alle 5 seksjoner
Select-String -Path .omo\reports\deviations-status-*.md -Pattern "^## "
# Forventet: minst 5 ## -headers som matcher seksjonene
```

### Final Checklist
- [ ] Rapport-fil generert og inneholder alle 5 seksjoner
- [ ] Rapport printet inline i samtalen
- [ ] Alle 7 hypoteser har confidence-level + evidens
- [ ] `git status --porcelain` viser KUN nye filer under `.omo/`
- [ ] Ingen DB-writes utført (verifisert via review av psql-sessjoner)
- [ ] Diagnose-konklusjon er enten Confirmed root cause ELLER eksplisitt narrowed-list med begrunnelse
- [ ] Konkret anbefaling om neste steg (fiks fase 2 først vs. gå rett til fase 3)
- [ ] Tom-Erik har gitt eksplisitt "okay" på F1-F4 resultater før arbeid markeres ferdig
