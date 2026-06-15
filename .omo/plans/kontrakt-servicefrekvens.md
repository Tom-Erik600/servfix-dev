# Customer Contracts with Service Frequency + Semi-Automatic Planning (Kontrakter)

## TL;DR

> **Quick Summary**: Add a `customer_contracts` entity (1 customer → many contracts) to Servfix that defines service frequency and commercial terms. Saving a contract with the auto-plan flag creates/maintains a `recurring_orders` rule (reusing the existing Periode engine), shows an approval window with suggested service dates, and generates orders only after admin approval. Contracts are managed in a new "Kontrakter" section in the admin customer UI, gated behind a tenant module flag. Tripletex link is PULL-only, on-demand.
>
> **Deliverables**:
> - Spec document `specs/contracts.md`
> - Migration: `customer_contracts` + `contract_generated_orders` tables
> - New frequency concept "X ganger per år" (contract-layer mapping to existing `every_x_days` engine - NO modification of `expandDates()` logic)
> - Backend: `contractService` + admin routes (CRUD, suggest-dates, generate, tripletex-sync)
> - Frontend: "Kontrakter" section in `kunder.html`/`kunder.js` (list, modal form, approval window, Tripletex sync button)
> - Regression-lock tests for the existing period engine + jest/supertest coverage for new code
>
> **Estimated Effort**: Large
> **Parallel Execution**: YES - 4 waves + final verification wave
> **Critical Path**: 2 (migration) → 5 (planning logic TDD) → 9 (suggest/generate endpoints) → 13 (approval window UI) → F1-F4

---

## Context

### Original Request
(Norwegian, from user) "Jeg har tenkt om jeg kunne legge til felt som kommer fra kontrakt som vil angi (eller vi kan utlede) frekvens på service og planlegge automatisk som et flagg pr kunde. Kanskje en kontrakt tabell med betingelser med kunden? Da kan vi bruke periode funksjonen i planleggeren for å automatisere."

### Interview Summary
**Key Discussions** (all confirmed by user):
- **Data model**: Separate `customer_contracts` table (1 customer → many contracts), linked to the existing period engine
- **Frequencies**: Existing types (daily/weekly/monthly/yearly/every_x_days/weekdays) PLUS "X times per year"
- **Trigger flow**: Manual contract registration in customer UI → on save, an approval window shows suggested service dates → admin approves → orders generated. NO fully-automatic generation, NO background jobs
- **Contract content**: Basis (agreement number, start/end date, frequency, auto-plan flag, active, notes) + commercial terms (price, conditions) + Tripletex link
- **Tripletex**: PULL only, sync on-use / manual "Synk nå" button. NO push, NO scheduled sync
- **Existing orders**: Contract changes affect only future, not-yet-generated suggestions
- **Tests**: Tests-after for CRUD/UI; TDD for the critical planning logic (repo rules mandate TDD for critical business logic)

**Research Findings**:
- Period engine exists: `recurring_orders` table (`migrations/006-create-recurring-orders.js`) + `expandDates()` in `src/routes/admin/recurring-orders.js` (lines 29-126) with CRUD + `/preview` + `/generate` endpoints
- Order generation: one order per date (`PROJ-{YYYY}-{ts}`), status `scheduled` if technician set else `pending`, transaction with FOR UPDATE lock
- No contract concept exists today (only free-text `agreement_number` on orders)
- Customer UI: vanilla JS, modal-based forms, `.edit-form-*` CSS classes, established checkbox patterns
- Tech stack: Node/Express, PostgreSQL raw SQL (no ORM), per-tenant databases, idempotent custom migration scripts, tenant `module_flags`

### Metis Review
**Identified Gaps** (addressed):
- "X times per year" semantics undefined → locked: interval = `floor(365 / X)` days from `start_date`; suggestions from `max(today, start_date)`; horizon `CONTRACT_PREVIEW_HORIZON_MONTHS = 12` when no `end_date`
- Cardinality → locked: 1 contract → 1 `recurring_orders` rule in v1
- Order field inheritance → via the `recurring_orders` rule (same as Periode today); back-link via new `contract_generated_orders` table, NOT a new column on `orders`
- Double-click duplication → idempotency via `UNIQUE (contract_id, scheduled_date)` in `contract_generated_orders` + server-side recompute at generate time
- Activation drift → symmetric: `customer_contracts.is_active` drives linked `recurring_orders.is_active`; generation re-checks contract active state
- TDD conflict → regression-lock tests for ALL existing `expandDates()` frequency types BEFORE the feature depends on them; TDD for new contract-planning logic
- Rollout risk → feature gated behind new module flag `show_contracts` (default off)
- Tripletex resilience → contract save must succeed even if sync fails; sync returns `synced:false` + reason, never 500

**Key architecture decision (simplification vs. Metis draft)**: "X times per year" is implemented at the CONTRACT layer as a mapping to the existing `every_x_days` frequency (`frequency_value = floor(365 / times_per_year)`). `expandDates()` is NOT modified at all. The contract stores `times_per_year` for display; the linked rule stores the computed `every_x_days` value. This keeps the high-risk period engine untouched while delivering identical behavior.

---

## Work Objectives

### Core Objective
Enable admins to register service contracts per customer (frequency, period, commercial terms, Tripletex link) and semi-automatically plan service orders from them: save contract → approve suggested dates → orders generated via the existing period engine.

### Concrete Deliverables
- `specs/contracts.md` - feature spec per repo convention
- `migrations/00X-create-customer-contracts.js` - idempotent per-tenant migration (next free number; check `migrations/` at execution time)
- `src/services/contractPlanningService.js` - pure planning logic (TDD)
- `src/services/contractService.js` - CRUD + rule sync
- `src/services/tripletexContractSync.js` (or extension of the existing Tripletex service module - follow existing structure)
- `src/routes/admin/contracts.js` - admin API endpoints, registered in the Express app
- `public/admin/kunder.html` + `public/admin/assets/js/kunder.js` + CSS - "Kontrakter" section, modal form, approval window
- New module flag `show_contracts` (default off)
- Jest unit tests + supertest integration tests
- `docs/servfix/kontrakter.md` documentation

### Definition of Done
- [ ] `npx jest` → all tests pass (regression-lock + new unit + integration)
- [ ] Contract CRUD works end-to-end via UI (Playwright-verified)
- [ ] Saving a contract with auto-plan → approval window → approve → orders exist in DB with correct dates
- [ ] Second approve click on same dates → no duplicate orders (idempotency verified)
- [ ] Tripletex sync button populates fields from a project, and fails gracefully when Tripletex is unavailable
- [ ] Feature invisible when `show_contracts` flag is off

### Must Have
- 1 customer → many contracts; 1 contract → max 1 `recurring_orders` rule (v1)
- All existing frequency types + "X ganger per år" (1 ≤ X ≤ 52, validated)
- Approval window with suggested dates BEFORE any order is created (never silent generation)
- Server-side recompute of dates at generate time (client-cached preview is never trusted)
- Idempotent generation (no duplicates on double-click/retry)
- Symmetric activation (contract active ↔ linked rule active)
- Tenant isolation on every query (per-tenant connection pattern)
- Tripletex PULL-only via the existing client wrapper; contract save succeeds even if sync fails
- Feature flag `show_contracts` (default off)
- All UI text in Norwegian, matching existing Kunder/Periode terminology
- Conventional commits, small and focused

### Must NOT Have (Guardrails)
- NO modification of `expandDates()` logic or signature (export-only change allowed for testability)
- NO changes to existing frequency-type behavior, the `/generate` transaction logic, the FOR UPDATE lock, or the `PROJ-{YYYY}-{ts}` numbering
- NO new columns on the `orders` table
- NO refactoring of `kunder.js` or `recurring-orders.js` - additive changes only
- NO background jobs / cron / scheduled auto-generation or scheduled Tripletex sync
- NO push/write to Tripletex (no PUT/POST/DELETE against the Tripletex API)
- NO PDF upload, OCR, or contract document storage
- NO email/SMS notifications (expiry warnings etc.)
- NO bulk import, contract templates, duplication feature, versioning/history
- NO customer-facing contract view (admin only)
- NO reporting dashboards
- NO modification of already-generated orders when a contract changes
- NO new frontend framework or form library - vanilla JS + existing `.edit-form-*` patterns only

### Spec Framework Integration
- **Detected Framework**: None (no `openspec/` or `.specify/`), but repo convention requires feature specs in `/specs` - Task 1 creates `specs/contracts.md`

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (jest 30 + supertest 7, `npx jest`)
- **Automated tests**: Hybrid - TDD for `contractPlanningService` (critical business logic per repo rules) + regression-lock for period engine; tests-after for CRUD routes; agent QA for UI
- **Framework**: jest + supertest

### QA Policy
Every task includes agent-executed QA scenarios. Evidence saved to `.omo/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Backend/API**: Bash (curl) against locally running server (`npm run dev` or `node server.js`; discover the start script in `package.json`). Authenticate by POSTing to the existing admin login endpoint (discover route in `src/routes/`; store session cookie with `curl -c cookies.txt`, reuse with `-b cookies.txt`). Use the dev tenant used elsewhere in migrations (e.g. `airtechdev` - confirm against existing migration invocation docs/scripts).
- **DB**: `psql` against the tenant database (connection details from `.env` / `src/config/database.js`)
- **Frontend/UI**: Playwright (playwright skill) - navigate, interact, assert DOM, screenshot
- **Unit logic**: `npx jest <file>` with exact expected date arrays

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (start immediately - foundation):
├── Task 1: Spec document specs/contracts.md (incl. API contract) [writing]
├── Task 2: Migration: customer_contracts + contract_generated_orders [unspecified-high]
├── Task 3: expandDates export + regression-lock tests (all 6 existing frequency types) [unspecified-high]
└── Task 4: Module flag show_contracts (admin DB + /api/tenant/flags) [quick]

Wave 2 (after Wave 1 - core logic + skeletons):
├── Task 5: contractPlanningService - TDD pure logic (times_per_year mapping, suggestDates, validation) (deps: 2,3) [deep]
├── Task 6: Tripletex pull-sync service function (deps: 2) [unspecified-high]
├── Task 7: contractService CRUD + admin routes CRUD (deps: 1,2) [unspecified-high]
└── Task 8: "Kontrakter" UI section skeleton - flag-gated list rendering (deps: 1,4) [visual-engineering]

Wave 3 (after Wave 2 - integration endpoints + form):
├── Task 9: Rule-sync + /suggest-dates + /generate endpoints (deps: 5,7) [deep]
├── Task 10: /tripletex-sync endpoint (deps: 6,7) [quick]
├── Task 11: Contract modal form create/edit (deps: 7,8) [visual-engineering]
└── Task 12: Supertest suite: contract CRUD + validation + tenant isolation (deps: 7) [unspecified-high]

Wave 4 (after Wave 3 - approval flow + polish):
├── Task 13: Approval window modal (suggested dates → approve → generate) (deps: 9,11) [visual-engineering]
├── Task 14: Tripletex "Synk nå" button + sync status in modal (deps: 10,11) [visual-engineering]
├── Task 15: Supertest suite: suggest/generate/sync endpoints + idempotency (deps: 9,10) [unspecified-high]
└── Task 16: Documentation docs/servfix/kontrakter.md + planlegger.md cross-ref (deps: 9) [writing]

Wave FINAL (after ALL tasks - 4 parallel reviews, then user okay):
├── F1. Plan compliance audit (oracle)
├── F2. Code quality review (unspecified-high)
├── F3. Real manual QA (unspecified-high + playwright skill)
└── F4. Scope fidelity check (deep)
-> Present results -> Get explicit user okay

Critical Path: 2 → 5 → 9 → 13 → F1-F4 → user okay
Max Concurrent: 4
```

### Dependency Matrix

- **1 (spec)**: depends none → blocks 7, 8
- **2 (migration)**: depends none → blocks 5, 6, 7
- **3 (regression-lock)**: depends none → blocks 5
- **4 (module flag)**: depends none → blocks 8
- **5 (planning logic)**: depends 2, 3 → blocks 9
- **6 (tripletex service)**: depends 2 → blocks 10
- **7 (CRUD service+routes)**: depends 1, 2 → blocks 9, 10, 11, 12
- **8 (UI skeleton)**: depends 1, 4 → blocks 11
- **9 (suggest/generate)**: depends 5, 7 → blocks 13, 15, 16
- **10 (sync endpoint)**: depends 6, 7 → blocks 14, 15
- **11 (modal form)**: depends 7, 8 → blocks 13, 14
- **12 (CRUD tests)**: depends 7 → blocks none
- **13 (approval window)**: depends 9, 11 → blocks none
- **14 (sync button)**: depends 10, 11 → blocks none
- **15 (endpoint tests)**: depends 9, 10 → blocks none
- **16 (docs)**: depends 9 → blocks none

### Agent Dispatch Summary

- **Wave 1**: 4 tasks - T1 → `writing`, T2 → `unspecified-high`, T3 → `unspecified-high`, T4 → `quick`
- **Wave 2**: 4 tasks - T5 → `deep`, T6 → `unspecified-high`, T7 → `unspecified-high`, T8 → `visual-engineering`
- **Wave 3**: 4 tasks - T9 → `deep`, T10 → `quick`, T11 → `visual-engineering`, T12 → `unspecified-high`
- **Wave 4**: 4 tasks - T13 → `visual-engineering`, T14 → `visual-engineering`, T15 → `unspecified-high`, T16 → `writing`
- **FINAL**: 4 tasks - F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [ ] 1. Write feature spec `specs/contracts.md` (incl. API contract)

  **What to do**:
  - Create `specs/contracts.md` describing: what the contract feature does, why (semi-automatic service planning from contract frequency), and rules that must not be broken (approval before generation, no touching generated orders, pull-only Tripletex, symmetric activation, idempotent generation)
  - Document the locked "X ganger per år" semantics: `interval_days = floor(365 / times_per_year)`, dates from `start_date` stepping by `interval_days`, suggestions windowed to `max(today, start_date)` .. `min(end_date, today + 12 months)`; horizon constant `CONTRACT_PREVIEW_HORIZON_MONTHS = 12`
  - Document the full API contract (used by Tasks 7-11 as the source of truth):
    - `GET /api/admin/customers/:customerId/contracts` → 200 `[{id, customerId, name, agreementNumber, startDate, endDate, frequencyType, frequencyValue, weekdays, timesPerYear, autoPlan, serviceType, description, technicianId, equipmentIds, pricePerVisit, pricePerYear, commercialTerms, tripletexProjectId, lastTripletexSyncAt, recurringOrderId, notes, isActive, createdAt, updatedAt}]`
    - `POST /api/admin/customers/:customerId/contracts` → 201 (same shape) | 400 `{error}` on validation failure
    - `PUT /api/admin/contracts/:contractId` → 200 | 400 | 404
    - `DELETE /api/admin/contracts/:contractId` → 204 (soft: sets `is_active=false` and deactivates linked rule)
    - `POST /api/admin/contracts/:contractId/suggest-dates` → 200 `{dates: ["YYYY-MM-DD", ...], horizonMonths: 12, ruleSummary: {...}}`
    - `POST /api/admin/contracts/:contractId/generate` → 200 `{created: N, skippedExisting: M, orderIds: [...]}`
    - `POST /api/admin/contracts/:contractId/tripletex-sync` → 200 `{synced: true, fields: {...}}` or 200 `{synced: false, reason: "..."}` (never 500 for upstream failure)
  - Document validation rules: `start_date` required; `end_date` null or ≥ `start_date`; `frequency_type` ∈ {daily, weekly, monthly, yearly, every_x_days, weekdays, times_per_year}; `times_per_year` required and 1-52 when type is `times_per_year`; `frequency_value` ≥ 1 when type is `every_x_days`; price fields null or ≥ 0
  - Document the DB schema (mirror Task 2)

  **Must NOT do**:
  - Do not write any code
  - Do not invent endpoints beyond the list above

  **Recommended Agent Profile**:
  - **Category**: `writing`
    - Reason: Pure documentation/spec authoring
  - **Skills**: none
  - **Skills Evaluated but Omitted**: none relevant

  **Parallelization**:
  - **Can Run In Parallel**: YES - Wave 1 (with Tasks 2, 3, 4)
  - **Blocks**: 7, 8
  - **Blocked By**: None

  **References**:
  - `specs/` directory - check existing spec files for format conventions; if empty, use a simple structure: Purpose / Behavior / Rules / API / Schema
  - `src/routes/admin/recurring-orders.js:29-126` - `expandDates(rule)` frequency semantics to reference (the contract layer maps onto these)
  - `src/routes/admin/customers.js` (GET handler, ~line 30-44) - snake_case→camelCase API transform convention the API contract must follow
  - `docs/servfix/planlegger.md` - existing Periode documentation; contract flow extends this conceptually
  - `.github/copilot-instructions.md` - repo rule requiring specs in `/specs` for larger features

  **Acceptance Criteria**:
  - [ ] `specs/contracts.md` exists and contains: purpose, locked times_per_year formula, all 7 endpoints with request/response shapes, validation rules, schema
  - [ ] All terminology consistent with this plan (table/column names match Task 2 exactly)

  **QA Scenarios**:
  ```
  Scenario: Spec is complete and internally consistent
    Tool: Bash (grep)
    Preconditions: specs/contracts.md written
    Steps:
      1. grep -c "suggest-dates\|generate\|tripletex-sync" specs/contracts.md → expect ≥ 3 matches
      2. grep "floor(365" specs/contracts.md → expect the formula present
      3. grep "times_per_year\|timesPerYear" specs/contracts.md → expect present
      4. grep "CONTRACT_PREVIEW_HORIZON_MONTHS" specs/contracts.md → expect present
    Expected Result: All greps match; file ≥ 80 lines
    Failure Indicators: Missing endpoint docs, missing formula
    Evidence: .omo/evidence/task-1-spec-grep.txt (grep outputs)

  Scenario: No code in spec (docs only)
    Tool: Bash
    Preconditions: same
    Steps:
      1. git status --short → only specs/contracts.md changed
    Expected Result: Single new file, no source changes
    Evidence: .omo/evidence/task-1-git-status.txt
  ```

  **Commit**: YES
  - Message: `docs(specs): add contracts feature spec`
  - Files: `specs/contracts.md`
  - Pre-commit: none (docs only)

- [ ] 2. Migration: `customer_contracts` + `contract_generated_orders` tables

  **What to do**:
  - Create `migrations/00X-create-customer-contracts.js` where `00X` is the next free number (list `migrations/` first). Follow the EXACT pattern of `migrations/006-create-recurring-orders.js`: idempotent (`CREATE TABLE IF NOT EXISTS`, existence checks), per-tenant invocation (`--tenant=` argument), same logging style
  - `customer_contracts` columns:
    - `id SERIAL PRIMARY KEY`
    - `customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE`
    - `name VARCHAR(255)` (display name, e.g. "Serviceavtale 2026")
    - `agreement_number VARCHAR(100)`
    - `start_date DATE NOT NULL`, `end_date DATE` (nullable = open-ended)
    - `frequency_type VARCHAR(20) NOT NULL` (daily|weekly|monthly|yearly|every_x_days|weekdays|times_per_year)
    - `frequency_value INTEGER`, `weekdays INTEGER[]`, `times_per_year INTEGER`
    - `auto_plan BOOLEAN NOT NULL DEFAULT false`
    - `service_type VARCHAR(100) DEFAULT 'Generell service'`, `description TEXT`
    - `technician_id VARCHAR(255) REFERENCES technicians(id) ON DELETE SET NULL`
    - `equipment_ids JSONB NOT NULL DEFAULT '[]'::jsonb`
    - `price_per_visit NUMERIC(12,2)`, `price_per_year NUMERIC(12,2)`, `commercial_terms TEXT`
    - `tripletex_project_id VARCHAR(100)`, `last_tripletex_sync_at TIMESTAMPTZ`
    - `recurring_order_id INTEGER REFERENCES recurring_orders(id) ON DELETE SET NULL`
    - `notes TEXT`, `is_active BOOLEAN NOT NULL DEFAULT true`
    - `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
    - Index: `CREATE INDEX IF NOT EXISTS idx_customer_contracts_customer_id ON customer_contracts(customer_id)`
  - `contract_generated_orders` columns (idempotency log + back-link):
    - `id SERIAL PRIMARY KEY`
    - `contract_id INTEGER NOT NULL REFERENCES customer_contracts(id) ON DELETE CASCADE`
    - `order_id VARCHAR(50) NOT NULL` (matches orders PK format `PROJ-YYYY-ts`)
    - `scheduled_date DATE NOT NULL`
    - `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
    - `UNIQUE (contract_id, scheduled_date)`

  **Must NOT do**:
  - NO columns added to `orders` table
  - NO changes to existing tables except the two new tables (recurring_orders gets NO new column - the link lives on customer_contracts)
  - NO non-idempotent statements

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: DB migrations are a designated high-risk area in repo rules; needs care, not creativity
  - **Skills**: none
  - **Skills Evaluated but Omitted**: `git-master` (commit handled by orchestrator flow)

  **Parallelization**:
  - **Can Run In Parallel**: YES - Wave 1 (with Tasks 1, 3, 4)
  - **Blocks**: 5, 6, 7
  - **Blocked By**: None

  **References**:
  - `migrations/006-create-recurring-orders.js` - THE pattern: idempotency checks, tenant arg parsing, connection handling, logging. Copy structure verbatim
  - `migrations/000-base-schema.sql:141-159` - customers table definition (FK target)
  - `src/config/database.js` - `getTenantConnection(tenantId)` used by migration scripts
  - `migrations/001-create-customers-tables.js` - secondary pattern example for multi-table migration

  **Acceptance Criteria**:
  - [ ] Migration runs successfully against the dev tenant: `node migrations/00X-create-customer-contracts.js --tenant=<dev-tenant>` → exit 0
  - [ ] Re-run is idempotent: second invocation → exit 0, no errors, no duplicate objects
  - [ ] `psql`: `\d customer_contracts` shows all columns above with correct types and FKs
  - [ ] `\d contract_generated_orders` shows the UNIQUE constraint on (contract_id, scheduled_date)

  **QA Scenarios**:
  ```
  Scenario: Migration creates both tables with correct schema
    Tool: Bash (node + psql)
    Preconditions: Dev tenant DB reachable (connection from .env / src/config/database.js)
    Steps:
      1. node migrations/00X-create-customer-contracts.js --tenant=<dev-tenant> → exit 0
      2. psql <tenant-db> -c "\d customer_contracts" → contains "recurring_order_id" and "times_per_year"
      3. psql <tenant-db> -c "\d contract_generated_orders" → contains UNIQUE constraint "(contract_id, scheduled_date)"
    Expected Result: Exit 0, both tables present with FKs
    Failure Indicators: SQL error, missing column, missing constraint
    Evidence: .omo/evidence/task-2-migration-run.txt (full output of all 3 steps)

  Scenario: Idempotent re-run (failure/edge case)
    Tool: Bash
    Preconditions: Migration already applied once
    Steps:
      1. node migrations/00X-create-customer-contracts.js --tenant=<dev-tenant> (second run)
      2. echo $LASTEXITCODE → 0
    Expected Result: Exit 0, output indicates skip/already-exists, no exception
    Evidence: .omo/evidence/task-2-migration-rerun.txt

  Scenario: FK integrity - deleting customer cascades contracts
    Tool: Bash (psql)
    Preconditions: Tables created
    Steps:
      1. INSERT a throwaway customer, INSERT a contract for it (start_date '2026-01-01', frequency_type 'times_per_year', times_per_year 2)
      2. DELETE the customer
      3. SELECT count(*) FROM customer_contracts WHERE customer_id = <that id> → 0
    Expected Result: Contract cascaded away; no orphan
    Evidence: .omo/evidence/task-2-fk-cascade.txt
  ```

  **Commit**: YES
  - Message: `feat(db): add customer_contracts and contract_generated_orders migration`
  - Files: `migrations/00X-create-customer-contracts.js`
  - Pre-commit: run migration twice against dev tenant (both exit 0)

- [ ] 3. Regression-lock tests for `expandDates()` (all 6 existing frequency types)

  **What to do**:
  - Export `expandDates` from `src/routes/admin/recurring-orders.js` WITHOUT any logic change (add it to `module.exports` alongside the router, e.g. `module.exports = router; module.exports.expandDates = expandDates;` - verify how the router is currently exported and keep that working)
  - Create `src/routes/admin/__tests__/expandDates.test.js` (or follow the repo's existing test file location convention - check for existing `__tests__/` or `*.test.js` placement first) with exact-date assertions locking CURRENT behavior:
    - `daily`: start 2026-01-01, end 2026-01-05 → exactly `['2026-01-01','2026-01-02','2026-01-03','2026-01-04','2026-01-05']`
    - `weekly`: start 2026-01-01, end 2026-01-31 → `['2026-01-01','2026-01-08','2026-01-15','2026-01-22','2026-01-29']`
    - `monthly`: start 2026-01-31, end 2026-04-30 → assert month-end handling matches current implementation (run once to observe, then lock the observed output as the expected array)
    - `yearly`: start 2024-02-29, end 2027-03-01 → lock observed leap-year handling
    - `every_x_days` value 14: start 2026-01-01, end 2026-02-15 → `['2026-01-01','2026-01-15','2026-01-29','2026-02-12']`
    - `weekdays` [1,3,5]: start 2026-01-05 (Mon), end 2026-01-16 → lock observed Mon/Wed/Fri dates
  - IMPORTANT: for `monthly`/`yearly`/`weekdays`, first RUN the function to capture actual current output, then hard-code that output as the expectation (this is a regression LOCK, not a spec of desired behavior)

  **Must NOT do**:
  - NO changes to any logic inside `expandDates` or any route handler
  - NO moving the function to another file
  - NO "fixing" behavior that looks wrong - lock it as-is and note observations in the task report

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Precision testing of high-risk production logic; requires discipline to not "improve" code
  - **Skills**: none
  - **Skills Evaluated but Omitted**: none relevant

  **Parallelization**:
  - **Can Run In Parallel**: YES - Wave 1 (with Tasks 1, 2, 4)
  - **Blocks**: 5
  - **Blocked By**: None

  **References**:
  - `src/routes/admin/recurring-orders.js:29-126` - `expandDates(rule)` implementation; read fully before writing tests
  - `package.json` - jest config and test script; check `testMatch`/`roots` to place the test file where jest finds it
  - Existing test files in repo (search `*.test.js`) - assertion style and structure to mimic

  **Acceptance Criteria**:
  - [ ] `npx jest expandDates` → all tests pass (≥ 6 test cases, one per frequency type)
  - [ ] `git diff src/routes/admin/recurring-orders.js` shows ONLY the export addition (≤ 3 changed lines)
  - [ ] Every test asserts a complete exact date array (no `length`-only or `toContain`-only assertions)

  **QA Scenarios**:
  ```
  Scenario: All 6 frequency types locked and passing
    Tool: Bash
    Preconditions: Test file written, export added
    Steps:
      1. npx jest expandDates --verbose
      2. Assert output contains 6+ passing tests, 0 failures
    Expected Result: "Tests: N passed" with N ≥ 6
    Failure Indicators: Any failure means the lock doesn't match actual behavior - re-observe, never modify the source
    Evidence: .omo/evidence/task-3-jest-output.txt

  Scenario: Source logic untouched (failure/edge case)
    Tool: Bash
    Preconditions: same
    Steps:
      1. git diff --stat src/routes/admin/recurring-orders.js → ≤ 3 lines changed
      2. git diff src/routes/admin/recurring-orders.js → only export-related lines
    Expected Result: No logic lines in the diff
    Evidence: .omo/evidence/task-3-source-diff.txt

  Scenario: Existing routes still work after export change
    Tool: Bash (curl)
    Preconditions: Server running, admin session cookie in cookies.txt
    Steps:
      1. curl -s -b cookies.txt http://localhost:<port>/api/admin/recurring-orders → 200, JSON array
    Expected Result: Periode endpoints unaffected
    Evidence: .omo/evidence/task-3-routes-intact.txt
  ```

  **Commit**: YES
  - Message: `test(planner): regression-lock expandDates frequency types`
  - Files: `src/routes/admin/recurring-orders.js` (export only), test file
  - Pre-commit: `npx jest`

- [ ] 4. Module flag `show_contracts` (default off) + tenant flag exposure

  **What to do**:
  - Locate how existing planner flags (`show_periode_tab`, `show_enkel_tab`, `show_avansert_tab`) are defined: find the `module_flags` table/seed in the servfix_admin DB and the `/api/tenant/flags` endpoint implementation
  - Add a new flag `show_contracts` with default `false`, following the exact same registration mechanism (migration/seed script in the same place the existing flags live)
  - Ensure `/api/tenant/flags` returns `show_contracts` for tenants
  - Enable the flag for the dev tenant so subsequent tasks can QA the UI

  **Must NOT do**:
  - NO changes to existing flags or their defaults
  - NO frontend changes (Task 8 consumes the flag)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small additive change following an existing, discoverable pattern
  - **Skills**: none
  - **Skills Evaluated but Omitted**: none relevant

  **Parallelization**:
  - **Can Run In Parallel**: YES - Wave 1 (with Tasks 1, 2, 3)
  - **Blocks**: 8
  - **Blocked By**: None

  **References**:
  - `public/admin/assets/js/planlegger.js:~142` - `loadTenantFlags()` consuming `/api/tenant/flags`; shows the flag names in use
  - Search `module_flags` across repo (grep) - find the table definition/seed and the route serving `/api/tenant/flags`
  - `migrations/` - if flags are seeded via migration, follow that pattern for the new flag

  **Acceptance Criteria**:
  - [ ] `curl -s -b cookies.txt http://localhost:<port>/api/tenant/flags` → JSON includes `"show_contracts"` 
  - [ ] Default value is `false` for tenants without explicit enablement
  - [ ] Dev tenant has it enabled (for downstream QA)

  **QA Scenarios**:
  ```
  Scenario: Flag exposed and enabled for dev tenant
    Tool: Bash (curl)
    Preconditions: Server running, logged-in admin session for dev tenant
    Steps:
      1. curl -s -b cookies.txt http://localhost:<port>/api/tenant/flags
      2. Assert response JSON contains "show_contracts": true (dev tenant enabled)
    Expected Result: Flag present and true for dev tenant
    Failure Indicators: Key missing from response
    Evidence: .omo/evidence/task-4-flags-response.json

  Scenario: Default off (failure/edge case)
    Tool: Bash (psql or curl)
    Preconditions: A tenant WITHOUT explicit enablement exists (or query the defaults table directly)
    Steps:
      1. Query the module_flags storage for the default value of show_contracts
      2. Assert default is false
    Expected Result: Default false - feature dark for all tenants until opted in
    Evidence: .omo/evidence/task-4-flag-default.txt
  ```

  **Commit**: YES
  - Message: `feat(flags): add show_contracts module flag`
  - Files: flag seed/migration + (if needed) flags route
  - Pre-commit: curl flags endpoint returns the key

- [ ] 5. `contractPlanningService` - TDD pure planning logic

  **What to do** (TDD: write failing tests FIRST, then implement):
  - Create `src/services/contractPlanningService.js` with pure functions (no DB access):
    - `CONTRACT_PREVIEW_HORIZON_MONTHS = 12` (exported named constant)
    - `mapContractToRuleFields(contract)` → returns `{frequency_type, frequency_value, weekdays, start_date, end_date}` for the recurring_orders rule:
      - For `times_per_year`: returns `frequency_type: 'every_x_days'`, `frequency_value: Math.floor(365 / times_per_year)`
      - For all other types: passthrough of the contract's frequency fields
      - `end_date` for the rule: contract `end_date` if set, else `start_date + CONTRACT_PREVIEW_HORIZON_MONTHS` months capped window is applied at suggestion time (rule itself gets contract end_date or computed horizon end - decide and document in code per spec)
    - `suggestDates(contract, today)` → calls the exported `expandDates()` (from Task 3) with mapped fields, then filters to window `[max(today, start_date), min(end_date ?? +∞, today + 12 months)]`; returns `string[]` of YYYY-MM-DD
    - `validateContract(data)` → returns `{valid: boolean, errors: string[]}` enforcing: start_date required; end_date null or ≥ start_date; frequency_type in allowed set; times_per_year integer 1-52 when type is times_per_year; frequency_value ≥ 1 when type is every_x_days; weekdays non-empty array of 0-6 when type is weekdays; prices null or ≥ 0
  - TDD test matrix in `contractPlanningService.test.js` with EXACT expected arrays:
    - times_per_year=2, start 2026-01-01, end 2026-12-31, today 2026-01-01 → interval 182 → `['2026-01-01','2026-07-02']`
    - times_per_year=4, start 2026-03-15, no end, today 2026-03-15 → interval 91 → `['2026-03-15','2026-06-14','2026-09-13','2026-12-12','2027-03-13']` capped at 2027-03-15 horizon (verify exact 12-month cap boundary in test)
    - times_per_year=1 → single date = start_date
    - times_per_year=12 → interval 30
    - times_per_year=0 and 53 → validateContract → invalid
    - start_date in the past (2025-01-01, today 2026-06-10, monthly) → suggestions begin at first date ≥ today
    - Leap year: times_per_year=2, start 2024-01-01 → still interval 182 (floor(365/2)) - lock exact dates
    - end_date < start_date → invalid
  - Run the suite RED first (commit point optional), then implement to GREEN

  **Must NOT do**:
  - NO modification of `expandDates()` itself
  - NO DB or HTTP access in this module (pure functions only)
  - NO timezone-dependent `new Date()` math that differs from `expandDates()`'s internal approach - reuse its date handling style (string-based YYYY-MM-DD)

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Critical business logic, date math edge cases, strict TDD - needs autonomous rigor
  - **Skills**: none
  - **Skills Evaluated but Omitted**: none relevant

  **Parallelization**:
  - **Can Run In Parallel**: YES - Wave 2 (with Tasks 6, 7, 8)
  - **Blocks**: 9
  - **Blocked By**: 2, 3

  **References**:
  - `src/routes/admin/recurring-orders.js:29-126` - `expandDates(rule)`: input shape `{start_date, end_date, frequency_type, frequency_value, weekdays}`, output `string[]`. Your mapping must produce exactly this input shape
  - Task 3's test file - assertion style and how expandDates is imported
  - `specs/contracts.md` (Task 1) - locked formula and validation rules (if Task 1 not yet merged, use the rules restated in this task verbatim - they are identical)

  **Acceptance Criteria**:
  - [ ] `npx jest contractPlanningService` → all pass; ≥ 10 test cases; every suggestDates test asserts a complete exact date array
  - [ ] `Math.floor(365 / X)` formula verifiable in source
  - [ ] `CONTRACT_PREVIEW_HORIZON_MONTHS` exported and used (no magic number 12 inline)
  - [ ] Module has zero `require` of db/express modules

  **QA Scenarios**:
  ```
  Scenario: Full TDD suite green with exact dates
    Tool: Bash
    Preconditions: Implementation complete
    Steps:
      1. npx jest contractPlanningService --verbose
      2. Assert ≥ 10 passed, 0 failed
    Expected Result: All green; output lists times_per_year cases explicitly
    Failure Indicators: Any date off-by-one (DST/UTC bug)
    Evidence: .omo/evidence/task-5-jest-output.txt

  Scenario: Validation rejects garbage (failure/edge case)
    Tool: Bash (node -e)
    Preconditions: Module implemented
    Steps:
      1. node -e "const s=require('./src/services/contractPlanningService'); console.log(JSON.stringify(s.validateContract({frequency_type:'times_per_year', times_per_year:53, start_date:'2026-01-01'})))"
      2. Assert output has valid:false and an error mentioning times_per_year
      3. Repeat with end_date '2025-01-01' < start_date '2026-01-01' → valid:false
    Expected Result: Both rejected with named errors
    Evidence: .omo/evidence/task-5-validation.txt

  Scenario: Purity check - no engine modification
    Tool: Bash
    Preconditions: same
    Steps:
      1. git diff src/routes/admin/recurring-orders.js → empty (no further changes beyond Task 3's export)
    Expected Result: Engine untouched
    Evidence: .omo/evidence/task-5-engine-untouched.txt
  ```

  **Commit**: YES
  - Message: `feat(contracts): add contract planning service with times-per-year mapping`
  - Files: `src/services/contractPlanningService.js`, its test file
  - Pre-commit: `npx jest contractPlanningService`

- [ ] 6. Tripletex pull-sync service function

  **What to do**:
  - Locate the existing Tripletex client/service (search `src/` for tripletex - there is an existing read-only customer/project sync). Reuse its client wrapper, auth handling, and error patterns
  - Add `syncContractFromTripletex(tenantId, contract)` (in a new `src/services/tripletexContractSync.js` OR as an additive function in the existing tripletex service module - follow whichever matches repo structure best):
    - Input: contract row with `tripletex_project_id`
    - Fetches the project from Tripletex (GET only)
    - Maps available fields → `{agreement_number?, start_date?, end_date?, price_per_year?}` (only fields Tripletex actually provides; map project number/display name to agreement_number, project start/end dates, and project price/contract value if exposed by the existing client)
    - Returns `{synced: true, fields: {...}}` on success; `{synced: false, reason: '<human-readable Norwegian reason>'}` on: project not found (404), auth failure (401), network/timeout, tenant has no Tripletex config, project_id missing
    - NEVER throws for upstream failures; never blocks longer than the existing client's timeout
  - Unit test with the Tripletex client mocked (follow existing test mocking patterns if present): success mapping, 404, network error, missing config

  **Must NOT do**:
  - NO write calls to Tripletex (GET only - grep your own diff for axios/fetch POST/PUT/DELETE to tripletex)
  - NO new HTTP client - reuse the existing wrapper
  - NO scheduled/automatic invocation - this is called only by Task 10's endpoint

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: High-risk integration area (repo rules); requires careful reuse of existing client
  - **Skills**: none
  - **Skills Evaluated but Omitted**: none relevant

  **Parallelization**:
  - **Can Run In Parallel**: YES - Wave 2 (with Tasks 5, 7, 8)
  - **Blocks**: 10
  - **Blocked By**: 2

  **References**:
  - Existing Tripletex service (locate via grep "tripletex" in src/) - client wrapper, credential handling per tenant, retry/error conventions. THIS IS THE ONLY WAY to talk to Tripletex
  - `migrations/000-base-schema.sql` customers table - `external_source`/`external_id` show how Tripletex linkage is stored today
  - Task 2 schema - contract fields the sync may populate

  **Acceptance Criteria**:
  - [ ] `npx jest tripletexContractSync` → pass (≥ 4 cases: success, 404, network error, missing config)
  - [ ] grep of the new code shows zero POST/PUT/DELETE toward Tripletex
  - [ ] Function never throws on upstream failure (test asserts resolved value, not rejection)

  **QA Scenarios**:
  ```
  Scenario: Graceful failure with Tripletex unreachable
    Tool: Bash (node -e or jest)
    Preconditions: Mocked client simulating ECONNREFUSED
    Steps:
      1. npx jest tripletexContractSync --verbose
      2. Assert test "returns synced:false on network error" passes and asserts a Norwegian reason string
    Expected Result: Resolves {synced:false, reason:...}, no throw
    Failure Indicators: Unhandled rejection
    Evidence: .omo/evidence/task-6-jest-output.txt

  Scenario: Pull-only verification (failure/edge case)
    Tool: Bash (grep on diff)
    Preconditions: Implementation complete
    Steps:
      1. git diff -- <changed tripletex files> | grep -iE "\.(post|put|delete)\(" → no matches targeting tripletex client
    Expected Result: Zero write operations
    Evidence: .omo/evidence/task-6-pull-only.txt
  ```

  **Commit**: YES
  - Message: `feat(tripletex): add pull-only contract sync service`
  - Files: sync service + test
  - Pre-commit: `npx jest tripletexContractSync`

- [ ] 7. `contractService` CRUD + admin routes (CRUD only)

  **What to do**:
  - Create `src/services/contractService.js` following the `customerService.js` pattern:
    - `getContracts(tenantId, customerId)` - all contracts for customer, newest first
    - `getContract(tenantId, contractId)`
    - `createContract(tenantId, customerId, data)` - validates via `contractPlanningService.validateContract` (require the module; if Wave-2 parallel timing makes it unavailable, inline the identical validation and leave a TODO-free direct call once present - prefer requiring it)
    - `updateContract(tenantId, contractId, data)` - `allowedFields` whitelist (all editable columns from Task 2; NOT id/created_at/recurring_order_id/last_tripletex_sync_at)
    - `deactivateContract(tenantId, contractId)` - sets `is_active=false` AND sets linked `recurring_orders.is_active=false` in same transaction (symmetric activation); reactivation symmetric
  - Create `src/routes/admin/contracts.js` implementing the CRUD endpoints exactly per `specs/contracts.md` (Task 1): GET list, POST create (201), PUT update, DELETE (soft → 204). snake_case→camelCase transform at route boundary (same style as `customers.js`)
  - Register the router in the Express app the same way `recurring-orders` routes are registered (find registration in server.js / app setup)
  - Validation failures → 400 with `{error: '<Norwegian message>'}`; unknown contract → 404; all handlers use `db.getTenantConnection(tenantId)` from session

  **Must NOT do**:
  - NO suggest/generate/sync endpoints here (Tasks 9-10)
  - NO rule creation logic here (Task 9 owns recurring_orders writes, EXCEPT the is_active symmetry in deactivate which only flips an existing linked rule)
  - NO modification of customerService.js or customers.js routes

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Standard but multi-file backend work with transaction handling and tenant isolation
  - **Skills**: none
  - **Skills Evaluated but Omitted**: none relevant

  **Parallelization**:
  - **Can Run In Parallel**: YES - Wave 2 (with Tasks 5, 6, 8)
  - **Blocks**: 9, 10, 11, 12
  - **Blocked By**: 1, 2

  **References**:
  - `src/services/customerService.js` - allowedFields whitelist pattern, parameterized queries, tenant connection usage. Mirror exactly
  - `src/routes/admin/customers.js:30-44` - snake_case→camelCase response transform convention
  - `src/routes/admin/recurring-orders.js` - router structure, transaction pattern (BEGIN/COMMIT/ROLLBACK with client), error response style
  - `specs/contracts.md` (Task 1) - endpoint shapes are the contract; do not deviate
  - Server entry (server.js or src/app) - route registration pattern

  **Acceptance Criteria**:
  - [ ] POST with valid body → 201 + camelCase JSON matching spec
  - [ ] POST with `end_date < start_date` → 400 + Norwegian error
  - [ ] PUT updates only whitelisted fields (attempt to PUT `recurring_order_id` → ignored)
  - [ ] DELETE → 204; row has `is_active=false` in DB (not deleted)
  - [ ] All endpoints 401/403 without session

  **QA Scenarios**:
  ```
  Scenario: Full CRUD round-trip via curl
    Tool: Bash (curl + psql)
    Preconditions: Server running, admin session cookie (cookies.txt), dev tenant, an existing customer id (pick first from GET /api/admin/customers)
    Steps:
      1. POST /api/admin/customers/<id>/contracts with body {"name":"Serviceavtale QA","agreementNumber":"QA-001","startDate":"2026-07-01","endDate":"2027-06-30","frequencyType":"times_per_year","timesPerYear":4,"autoPlan":false} → 201, capture contract id
      2. GET /api/admin/customers/<id>/contracts → array contains QA-001
      3. PUT /api/admin/contracts/<cid> with {"timesPerYear":2} → 200, response timesPerYear=2
      4. DELETE /api/admin/contracts/<cid> → 204
      5. psql: SELECT is_active FROM customer_contracts WHERE id=<cid> → f
    Expected Result: Statuses 201/200/200/204; soft delete confirmed
    Failure Indicators: 500s, snake_case leaking into JSON
    Evidence: .omo/evidence/task-7-crud-roundtrip.txt

  Scenario: Validation rejected (failure/edge case)
    Tool: Bash (curl)
    Preconditions: same
    Steps:
      1. POST with {"startDate":"2026-07-01","endDate":"2026-01-01","frequencyType":"times_per_year","timesPerYear":4} → 400
      2. POST with {"startDate":"2026-07-01","frequencyType":"times_per_year","timesPerYear":53} → 400
      3. Assert both bodies contain "error" with Norwegian text
    Expected Result: Both 400, named errors, nothing inserted (psql count unchanged)
    Evidence: .omo/evidence/task-7-validation-errors.txt
  ```

  **Commit**: YES
  - Message: `feat(contracts): add contract CRUD service and admin routes`
  - Files: `src/services/contractService.js`, `src/routes/admin/contracts.js`, route registration
  - Pre-commit: curl CRUD round-trip passes

- [ ] 8. "Kontrakter" UI section skeleton in customer page (flag-gated list)

  **What to do**:
  - In `public/admin/kunder.html` + `public/admin/assets/js/kunder.js`: add a "Kontrakter" section to the customer detail view, placed after the existing contacts section, following the same section/card pattern as contacts/equipment
  - Gate rendering on tenant flag: fetch `/api/tenant/flags` (reuse pattern from `planlegger.js` `loadTenantFlags()`); if `show_contracts` is falsy, render nothing (section absent from DOM)
  - List rendering per contract card: name, agreement number, period (`startDate – endDate` or "Løpende" when no end), frequency in Norwegian ("4 ganger per år", "Hver 14. dag", "Månedlig", etc. - write a `formatFrequency(contract)` helper), badges: "Aktiv"/"Inaktiv" and "Auto-plan" when autoPlan=true
  - "Ny kontrakt" button (opens modal - Task 11 implements the modal; button can be present with a stub `openContractModal()` that Task 11 fills in, or render disabled until Task 11 - prefer wiring to a defined-but-minimal function to avoid dead UI)
  - Add `data-testid` attributes: `contracts-section`, `contract-card`, `new-contract-btn`
  - CSS additions in the existing customer CSS file, reusing card/badge styles

  **Must NOT do**:
  - NO modal form implementation (Task 11)
  - NO refactor of existing kunder.js functions - additive only
  - NO new framework/library; vanilla JS + fetch with `credentials:'include'` like the rest of the file
  - All visible text in Norwegian

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: UI section design matching existing admin visual language
  - **Skills**: [`playwright`]
    - `playwright`: needed to QA the rendered section in a real browser
  - **Skills Evaluated but Omitted**: none relevant

  **Parallelization**:
  - **Can Run In Parallel**: YES - Wave 2 (with Tasks 5, 6, 7)
  - **Blocks**: 11
  - **Blocked By**: 1, 4

  **References**:
  - `public/admin/assets/js/kunder.js` - `renderCustomerDetails()` and the contacts-section rendering: THE pattern for a new section (lazy fetch + innerHTML card list)
  - `public/admin/kunder.html` - section markup structure; modal markup placement (for Task 11's anchor)
  - `public/admin/assets/css/kundeinfo.css` - card, badge, section header classes to reuse
  - `public/admin/assets/js/planlegger.js:~142` - `loadTenantFlags()` flag consumption pattern
  - `specs/contracts.md` - GET response field names (camelCase) the renderer consumes

  **Acceptance Criteria**:
  - [ ] With flag on + ≥1 contract in DB: section visible with correct Norwegian frequency text
  - [ ] With flag off: `[data-testid="contracts-section"]` absent from DOM
  - [ ] No console errors on the customer page
  - [ ] Existing sections (contacts, equipment) unaffected

  **QA Scenarios**:
  ```
  Scenario: Section renders contract list (flag on)
    Tool: Playwright
    Preconditions: Server running; dev tenant flag show_contracts=true; seed one contract via Task 7's POST (agreementNumber "QA-001", timesPerYear 4); admin logged in
    Steps:
      1. Navigate to /admin/kunder.html, click the seeded customer in the list
      2. Wait for [data-testid="contracts-section"] (timeout 10s)
      3. Assert a [data-testid="contract-card"] contains text "QA-001" and "4 ganger per år"
      4. Assert [data-testid="new-contract-btn"] visible
      5. Screenshot
    Expected Result: Section + card + button rendered, Norwegian labels
    Failure Indicators: Section missing, English text, console errors
    Evidence: .omo/evidence/task-8-section-render.png

  Scenario: Flag off hides feature (failure/edge case)
    Tool: Playwright + Bash
    Preconditions: Temporarily set show_contracts=false for dev tenant (flip back after)
    Steps:
      1. Reload customer page, select same customer
      2. Assert [data-testid="contracts-section"] count = 0
      3. Assert contacts section still renders (no collateral damage)
    Expected Result: Feature fully dark; rest of page intact
    Evidence: .omo/evidence/task-8-flag-off.png
  ```

  **Commit**: YES
  - Message: `feat(admin-ui): add contracts section skeleton to customer page`
  - Files: `public/admin/kunder.html`, `public/admin/assets/js/kunder.js`, CSS file
  - Pre-commit: Playwright scenario 1 passes

- [ ] 9. Rule-sync + `/suggest-dates` + `/generate` endpoints (the planning core)

  **What to do**:
  - In `src/routes/admin/contracts.js` (+ `contractService.js`), add:
  - **Rule sync** (`syncRuleForContract`, called on create/update when `auto_plan=true`):
    - Maps contract → rule fields via `contractPlanningService.mapContractToRuleFields()`
    - If contract has no `recurring_order_id`: INSERT into `recurring_orders` (customer_id, customer_name, technician_id, equipment_ids, description, service_type, dates, frequency fields, is_active=contract.is_active) and store new id on the contract
    - If it has one: UPDATE the linked rule's fields
    - If `auto_plan` flipped to false: set linked rule `is_active=false` (keep the link)
    - All in one transaction
  - **POST `/api/admin/contracts/:id/suggest-dates`**: loads contract, returns `{dates: contractPlanningService.suggestDates(contract, today), horizonMonths: 12, ruleSummary: {frequencyType, frequencyValue}}`. Excludes dates already present in `contract_generated_orders` for this contract (mark them `alreadyGenerated` or filter out - spec says return suggested NEW dates; include a `skipped` count)
  - **POST `/api/admin/contracts/:id/generate`**: 
    - Recomputes dates server-side (NEVER trusts request body dates; request body MAY contain `{dates: [...]}` as the admin-approved SUBSET - validate every submitted date is in the recomputed set, reject others with 400)
    - Rejects if contract `is_active=false` or `auto_plan=false` → 400
    - In a transaction with `SELECT ... FOR UPDATE` on the contract row: for each approved date NOT already in `contract_generated_orders`, create an order following the EXACT order-creation pattern from `recurring-orders.js` `/generate` (PROJ id format, customer_data snapshot, status logic, included_equipment_ids), then INSERT into `contract_generated_orders`; ON CONFLICT (contract_id, scheduled_date) DO NOTHING → counted as skipped
    - Returns `{created, skippedExisting, orderIds}`
  - Wire rule-sync into Task 7's create/update/deactivate paths

  **Must NOT do**:
  - NO modification of the existing `/api/admin/recurring-orders/:id/generate` handler or its transaction
  - NO changes to PROJ numbering or order status semantics - copy the pattern, don't alter it
  - NO trusting client-provided dates without server-side validation
  - NO generation when contract inactive

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Order lifecycle is a designated high-risk area; transactions, idempotency, and cross-table consistency demand rigor
  - **Skills**: none
  - **Skills Evaluated but Omitted**: none relevant

  **Parallelization**:
  - **Can Run In Parallel**: YES - Wave 3 (with Tasks 10, 11, 12)
  - **Blocks**: 13, 15, 16
  - **Blocked By**: 5, 7

  **References**:
  - `src/routes/admin/recurring-orders.js` `/generate` handler - THE order-creation pattern: transaction, FOR UPDATE, PROJ-{YYYY}-{ts} ids, customer_data snapshot, status 'scheduled'/'pending'. Copy faithfully into the contract path
  - `src/services/contractPlanningService.js` (Task 5) - `mapContractToRuleFields`, `suggestDates`
  - Task 2 schema - `contract_generated_orders` UNIQUE constraint is the idempotency backbone
  - `specs/contracts.md` - exact response shapes

  **Acceptance Criteria**:
  - [ ] suggest-dates for times_per_year=4 contract (start 2026-07-01, end 2027-06-30, today fixed) returns exactly 4-5 dates matching Task 5's formula
  - [ ] generate creates exactly N orders; `contract_generated_orders` has N rows; orders visible via existing orders queries
  - [ ] Second identical generate call → `{created:0, skippedExisting:N}`; order count unchanged
  - [ ] generate on inactive contract → 400
  - [ ] Saving contract with autoPlan=true creates a recurring_orders row linked via recurring_order_id; deactivating contract sets rule is_active=false

  **QA Scenarios**:
  ```
  Scenario: Suggest → approve → orders exist
    Tool: Bash (curl + psql)
    Preconditions: Server running, session cookie, customer seeded; contract POST {"name":"Gen QA","startDate":"2026-07-01","endDate":"2027-06-30","frequencyType":"times_per_year","timesPerYear":4,"autoPlan":true}
    Steps:
      1. POST /api/admin/contracts/<cid>/suggest-dates → 200; assert dates[0]="2026-07-01" and dates length 4 or 5 (lock exact list from formula: 2026-07-01, 2026-09-30, 2026-12-30, 2027-03-31 +91d steps - assert the actual computed array equals suggest-dates output of Task 5's function)
      2. POST /api/admin/contracts/<cid>/generate with {"dates": <the returned array>} → 200, created=N
      3. psql: SELECT count(*) FROM contract_generated_orders WHERE contract_id=<cid> → N
      4. psql: SELECT count(*) FROM orders WHERE id = ANY(<orderIds>) → N
    Expected Result: N orders created, log rows match
    Failure Indicators: Date drift vs unit tests, orders without log rows
    Evidence: .omo/evidence/task-9-generate-flow.txt

  Scenario: Idempotency - double generate (failure/edge case)
    Tool: Bash (curl + psql)
    Preconditions: Scenario 1 completed
    Steps:
      1. Repeat the same generate POST → 200 {"created":0,"skippedExisting":N}
      2. psql order count for the contract unchanged
    Expected Result: Zero duplicates
    Evidence: .omo/evidence/task-9-idempotency.txt

  Scenario: Tampered client dates rejected (failure/edge case)
    Tool: Bash (curl)
    Preconditions: same contract
    Steps:
      1. POST generate with {"dates":["1999-01-01"]} → 400 with Norwegian error
    Expected Result: Server-side recompute wins; no order created for bogus date
    Evidence: .omo/evidence/task-9-tamper-reject.txt
  ```

  **Commit**: YES
  - Message: `feat(contracts): add suggest-dates and generate endpoints with idempotent generation`
  - Files: `src/routes/admin/contracts.js`, `src/services/contractService.js`
  - Pre-commit: `npx jest` + QA scenario 1-2

- [ ] 10. `/tripletex-sync` endpoint

  **What to do**:
  - Add `POST /api/admin/contracts/:contractId/tripletex-sync` to `src/routes/admin/contracts.js`:
    - Loads contract; 404 if missing; 400 `{synced:false, reason:"Ingen Tripletex-prosjekt koblet"}` if no `tripletex_project_id`... (return 200 with synced:false per spec - upstream/state failures are 200 + synced:false, only missing contract is 404)
    - Calls `syncContractFromTripletex` (Task 6)
    - On `synced:true`: persists returned fields onto the contract (whitelisted: agreement_number, start_date, end_date, price_per_year) + `last_tripletex_sync_at=NOW()`, returns updated contract fields in response
    - On `synced:false`: persists nothing, returns the reason

  **Must NOT do**:
  - NO 500 responses for upstream failures
  - NO write toward Tripletex
  - NO automatic invocation from create/update paths (sync is explicit user action only)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Thin endpoint over Task 6's service following established route patterns
  - **Skills**: none
  - **Skills Evaluated but Omitted**: none relevant

  **Parallelization**:
  - **Can Run In Parallel**: YES - Wave 3 (with Tasks 9, 11, 12)
  - **Blocks**: 14, 15
  - **Blocked By**: 6, 7

  **References**:
  - `src/services/tripletexContractSync.js` (Task 6) - return contract `{synced, fields|reason}`
  - `src/routes/admin/contracts.js` (Task 7) - router to extend
  - `specs/contracts.md` - response shape

  **Acceptance Criteria**:
  - [ ] Contract without tripletex_project_id → 200 `{synced:false, reason:...}`
  - [ ] Unknown contract id → 404
  - [ ] With Tripletex unavailable (dev env without credentials) → 200 `{synced:false}`, no DB changes, no 500

  **QA Scenarios**:
  ```
  Scenario: Sync without linked project fails gracefully
    Tool: Bash (curl + psql)
    Preconditions: Server running, contract from Task 7 QA without tripletexProjectId
    Steps:
      1. POST /api/admin/contracts/<cid>/tripletex-sync → HTTP 200
      2. Assert body {"synced":false} with Norwegian reason
      3. psql: last_tripletex_sync_at IS NULL for the contract
    Expected Result: Graceful, nothing persisted
    Failure Indicators: 500, partial writes
    Evidence: .omo/evidence/task-10-sync-no-project.txt

  Scenario: Unknown contract (failure/edge case)
    Tool: Bash (curl)
    Steps:
      1. POST /api/admin/contracts/999999/tripletex-sync → 404
    Expected Result: 404 JSON error
    Evidence: .omo/evidence/task-10-sync-404.txt
  ```

  **Commit**: YES
  - Message: `feat(contracts): add tripletex sync endpoint`
  - Files: `src/routes/admin/contracts.js`
  - Pre-commit: both curl scenarios

- [ ] 11. Contract modal form (create/edit)

  **What to do**:
  - Add a contract modal to `kunder.html` + `kunder.js` following the existing contact/equipment modal pattern (`.edit-form-group`, `.edit-form-label`, `.edit-form-input`):
    - Fields: Navn, Avtalenummer, Startdato (date), Sluttdato (date, optional, hint "La stå tom for løpende avtale"), Frekvens (radio group reusing Periode wording: Daglig / Ukentlig / Månedlig / Årlig / Hver X. dag / Valgte ukedager / **X ganger per år**), conditional inputs (number for X-dag, weekday checkboxes, number 1-52 for ganger per år), Servicetype, Beskrivelse, Tekniker (select, populated like Periode's technician select), Pris per besøk, Pris per år, Betingelser (textarea), Tripletex prosjekt-ID, Notater, checkboxes: "Automatisk planlegging" (auto_plan) and "Aktiv" (is_active, edit mode only)
    - Conditional visibility mirrors Periode's pattern (`freq-every-x-container` style)
    - Implement `openContractModal(contractId?)` (wired to Task 8's button), prefill on edit, client-side validation mirroring server rules (required start date, end ≥ start, X 1-52), save via POST/PUT from Task 7, then re-render the contracts section
    - On save success when autoPlan=true: call the approval-window hook (Task 13 implements it; until then, after-save just refreshes list - leave a single named function call `maybeOpenApprovalWindow(contract)` defined as no-op stub for Task 13 to fill)
  - `data-testid`s: `contract-modal`, `contract-save-btn`, `contract-freq-times-per-year`, `contract-times-per-year-input`

  **Must NOT do**:
  - NO approval window implementation (Task 13)
  - NO Tripletex button (Task 14)
  - NO refactoring of existing modals

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Form UI matching existing admin design language with conditional logic
  - **Skills**: [`playwright`]
    - `playwright`: browser QA of form interactions
  - **Skills Evaluated but Omitted**: none relevant

  **Parallelization**:
  - **Can Run In Parallel**: YES - Wave 3 (with Tasks 9, 10, 12)
  - **Blocks**: 13, 14
  - **Blocked By**: 7, 8

  **References**:
  - `public/admin/kunder.html:237-280` - contact modal markup pattern
  - `public/admin/assets/js/kunder.js:1563-1616` - `saveContact()` save/validation/fetch pattern
  - `public/admin/planlegger.html:117-237` - Periode frequency radio group + conditional containers + technician select: reuse wording and structure for frequency UI
  - `specs/contracts.md` - field names (camelCase) for POST/PUT bodies

  **Acceptance Criteria**:
  - [ ] Create flow: open modal → fill → save → 201 → card appears without page reload
  - [ ] Edit flow: open existing → fields prefilled → change → save → card updates
  - [ ] "X ganger per år" radio reveals the 1-52 number input; other conditionals hidden
  - [ ] Client-side rejection of end < start with Norwegian message

  **QA Scenarios**:
  ```
  Scenario: Create contract via UI
    Tool: Playwright
    Preconditions: Server running, flag on, admin logged in, customer selected
    Steps:
      1. Click [data-testid="new-contract-btn"] → [data-testid="contract-modal"] visible
      2. Fill Navn="UI Avtale", Startdato="2026-08-01", select [data-testid="contract-freq-times-per-year"], fill [data-testid="contract-times-per-year-input"]=2, check "Automatisk planlegging"
      3. Click [data-testid="contract-save-btn"]
      4. Wait for modal close; assert a contract-card contains "UI Avtale" and "2 ganger per år" (timeout 10s)
      5. Screenshot
    Expected Result: Card rendered with correct frequency text
    Failure Indicators: Modal stays open, console errors, wrong field mapping
    Evidence: .omo/evidence/task-11-create-flow.png

  Scenario: Invalid dates blocked client-side (failure/edge case)
    Tool: Playwright
    Steps:
      1. Open modal, Startdato="2026-08-01", Sluttdato="2026-01-01", save
      2. Assert Norwegian validation message shown and modal still open
      3. Assert no new card appears
    Expected Result: Save blocked before network call
    Evidence: .omo/evidence/task-11-validation.png
  ```

  **Commit**: YES
  - Message: `feat(admin-ui): add contract create/edit modal`
  - Files: `kunder.html`, `kunder.js`, CSS
  - Pre-commit: Playwright scenario 1

- [ ] 12. Supertest suite: contract CRUD + validation + tenant isolation

  **What to do** (tests-after, per user decision):
  - Create integration tests (follow existing supertest patterns in the repo - locate existing route tests first) covering Task 7's endpoints:
    - POST valid → 201 shape assertion (every spec field present, camelCase)
    - POST invalid (end<start; times_per_year 0 and 53; missing start_date; bad frequency_type) → 400 each
    - GET list ordering and shape
    - PUT whitelisting (attempt to set recurringOrderId → ignored)
    - DELETE soft-delete semantics
    - Unauthenticated request → 401/403
    - Tenant isolation: create in tenant A's DB, assert absent from tenant B (if test infra supports multi-tenant fixtures; if not feasible with existing test setup, assert all service functions require tenantId and use getTenantConnection - document the substitution)

  **Must NOT do**:
  - NO testing of suggest/generate/sync here (Task 15)
  - NO modifications to production code to make tests pass (if a bug is found: fix is allowed and must be noted in the task report)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Integration test authoring against established patterns
  - **Skills**: none
  - **Skills Evaluated but Omitted**: none relevant

  **Parallelization**:
  - **Can Run In Parallel**: YES - Wave 3 (with Tasks 9, 10, 11)
  - **Blocks**: none
  - **Blocked By**: 7

  **References**:
  - Existing supertest files (search `supertest` in repo) - app bootstrapping, session/auth mocking, DB setup/teardown conventions
  - `src/routes/admin/contracts.js` (Task 7) - endpoints under test
  - `specs/contracts.md` - expected shapes

  **Acceptance Criteria**:
  - [ ] `npx jest contracts` (integration file) → all pass, ≥ 10 cases
  - [ ] Full suite `npx jest` still green

  **QA Scenarios**:
  ```
  Scenario: Suite green
    Tool: Bash
    Steps:
      1. npx jest --verbose (full suite)
      2. Assert 0 failures and the new contract integration cases listed
    Expected Result: All pass including regression locks
    Evidence: .omo/evidence/task-12-jest-full.txt

  Scenario: Tests actually assert (failure/edge case)
    Tool: Bash (grep)
    Steps:
      1. grep -c "expect(" <new test file> → ≥ 20
      2. grep "toBe(400)\|toBe(201)\|toBe(204)" <new test file> → present
    Expected Result: Real assertions, not smoke tests
    Evidence: .omo/evidence/task-12-assertion-density.txt
  ```

  **Commit**: YES (groups with 15)
  - Message: `test(contracts): add integration tests for contract API`
  - Files: integration test file(s)
  - Pre-commit: `npx jest`

- [ ] 13. Approval window modal (suggested dates → approve → generate)

  **What to do**:
  - Implement `maybeOpenApprovalWindow(contract)` (stub from Task 11) in `kunder.js` + markup in `kunder.html`:
    - Triggered after saving a contract with `autoPlan=true` (create or edit), and from a "Planlegg" button on each contract card (for re-running later)
    - Calls `POST /suggest-dates`; renders modal: heading "Foreslåtte servicedatoer", list of dates (Norwegian format, e.g. "tirsdag 1. juli 2026") each with a checkbox (checked by default), summary line "N besøk basert på <frekvenstekst>", note showing count of dates already generated/skipped
    - Buttons: "Godkjenn og opprett ordrer" (POST `/generate` with checked dates; disable button while pending to guard double-click) and "Avbryt" (closes, nothing created)
    - On success: toast/alert "N ordrer opprettet", close modal, refresh contracts section
    - Empty suggestion list → message "Ingen nye datoer å planlegge i perioden" with only "Lukk"
  - `data-testid`s: `approval-modal`, `approval-date-row`, `approval-approve-btn`, `approval-cancel-btn`

  **Must NOT do**:
  - NO order creation client-side; the server recomputes and validates everything
  - NO auto-approve - explicit button click required, always

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Interaction-heavy modal UX, the user-facing heart of the feature
  - **Skills**: [`playwright`]
    - `playwright`: end-to-end browser QA of the approval flow
  - **Skills Evaluated but Omitted**: none relevant

  **Parallelization**:
  - **Can Run In Parallel**: YES - Wave 4 (with Tasks 14, 15, 16)
  - **Blocks**: none
  - **Blocked By**: 9, 11

  **References**:
  - `public/admin/assets/js/planlegger.js:2458-2530` - Periode preview→generate flow (savePeriodeRule, preview render, generate call): the closest existing UX to mirror
  - Task 9's endpoints - request/response shapes (`{dates}`, `{created, skippedExisting, orderIds}`)
  - Existing modal patterns in `kunder.html`/`kunder.js`

  **Acceptance Criteria**:
  - [ ] Saving an autoPlan contract opens the approval modal with the same dates Task 9's endpoint returns
  - [ ] Unchecking a date excludes it from generation (created = checked count)
  - [ ] Cancel creates nothing (DB count unchanged)
  - [ ] Approve button disabled while request in flight

  **QA Scenarios**:
  ```
  Scenario: Full approve flow creates orders
    Tool: Playwright + Bash (psql)
    Preconditions: Server running, flag on, fresh contract via UI (timesPerYear=2, autoPlan=true, start 2026-09-01, end 2027-08-31)
    Steps:
      1. After save, wait for [data-testid="approval-modal"] (10s)
      2. Assert 2 [data-testid="approval-date-row"] elements, both checked; first contains "1. september 2026"
      3. Click [data-testid="approval-approve-btn"]
      4. Wait for success message containing "2 ordrer opprettet"
      5. psql: SELECT count(*) FROM contract_generated_orders WHERE contract_id=<cid> → 2
      6. Screenshot
    Expected Result: 2 orders, modal closed, section refreshed
    Failure Indicators: Count mismatch, modal reopens, duplicates
    Evidence: .omo/evidence/task-13-approve-flow.png + .txt

  Scenario: Cancel creates nothing (failure/edge case)
    Tool: Playwright + Bash (psql)
    Preconditions: New autoPlan contract saved, approval modal open
    Steps:
      1. Click [data-testid="approval-cancel-btn"]
      2. psql: count for contract → 0
    Expected Result: Zero orders; modal closed
    Evidence: .omo/evidence/task-13-cancel.txt

  Scenario: Partial approval (edge)
    Tool: Playwright + Bash (psql)
    Preconditions: New autoPlan contract with 4 suggested dates
    Steps:
      1. Uncheck rows 3 and 4, approve
      2. psql count → 2; re-open "Planlegg" → modal shows remaining 2 dates as new suggestions
    Expected Result: Only approved subset generated; rest re-suggested later
    Evidence: .omo/evidence/task-13-partial.txt
  ```

  **Commit**: YES
  - Message: `feat(admin-ui): add contract date approval window`
  - Files: `kunder.html`, `kunder.js`, CSS
  - Pre-commit: Playwright scenario 1

- [ ] 14. Tripletex "Synk nå" button + sync status in contract modal

  **What to do**:
  - In the contract modal (Task 11), next to the Tripletex prosjekt-ID field: add "Synk fra Tripletex" button + status line showing `lastTripletexSyncAt` ("Sist synket: 10. juni 2026 14:30" or "Aldri synket")
  - Click → POST `/tripletex-sync` (Task 10) → on `synced:true`: update form fields (avtalenummer, datoer, pris per år) in-place + success toast; on `synced:false`: show the Norwegian reason as inline error (NOT a crash, NOT a blocking alert loop)
  - Button disabled when prosjekt-ID field is empty; spinner while pending
  - `data-testid`s: `tripletex-sync-btn`, `tripletex-sync-status`

  **Must NOT do**:
  - NO automatic sync on modal open or save
  - NO blocking of contract save when sync fails

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: UI affordance with async state handling
  - **Skills**: [`playwright`]
    - `playwright`: browser QA including failure-state rendering
  - **Skills Evaluated but Omitted**: none relevant

  **Parallelization**:
  - **Can Run In Parallel**: YES - Wave 4 (with Tasks 13, 15, 16)
  - **Blocks**: none
  - **Blocked By**: 10, 11

  **References**:
  - Task 11's modal markup/JS - insertion point
  - Task 10's endpoint - response contract
  - Existing async-button/spinner patterns in `kunder.js` or `planlegger.js` (search for disabled-while-fetch patterns)

  **Acceptance Criteria**:
  - [ ] Button disabled with empty prosjekt-ID; enabled when filled
  - [ ] synced:false reason rendered inline in Norwegian; form remains editable; save still works
  - [ ] No console errors on failure path

  **QA Scenarios**:
  ```
  Scenario: Graceful sync failure in UI
    Tool: Playwright
    Preconditions: Dev env where Tripletex is not configured/reachable; contract modal open with prosjekt-ID "99999"
    Steps:
      1. Click [data-testid="tripletex-sync-btn"]
      2. Wait for [data-testid="tripletex-sync-status"] to contain an error text (10s)
      3. Assert modal still open, fields editable
      4. Click save → contract saves normally (200/201)
    Expected Result: Failure is informative, never blocking
    Failure Indicators: Uncaught promise rejection, modal breaks
    Evidence: .omo/evidence/task-14-sync-fail-ui.png

  Scenario: Button gating (edge)
    Tool: Playwright
    Steps:
      1. Open modal with empty prosjekt-ID → assert sync button disabled
      2. Type "123" → assert enabled
    Expected Result: Gating follows field content
    Evidence: .omo/evidence/task-14-gating.png
  ```

  **Commit**: YES
  - Message: `feat(admin-ui): add tripletex sync button to contract modal`
  - Files: `kunder.html`, `kunder.js`
  - Pre-commit: Playwright scenario 1

- [ ] 15. Supertest suite: suggest/generate/sync endpoints + idempotency

  **What to do** (tests-after):
  - Integration tests for Task 9 + 10 endpoints:
    - suggest-dates: known contract fixture → exact expected date array (reuse Task 5's matrix values); already-generated dates excluded
    - generate: happy path creates N orders + N log rows; repeat call → created:0; subset approval; tampered dates → 400; inactive contract → 400; autoPlan=false → 400
    - tripletex-sync: no project id → 200 synced:false; unknown id → 404 (mock the Tripletex client at module boundary)
    - Rule sync: creating autoPlan contract inserts recurring_orders row with mapped every_x_days value (times_per_year=4 → frequency_value 91); deactivate → rule is_active=false

  **Must NOT do**:
  - NO real Tripletex network calls in tests (mock)
  - NO weakening of Task 9 logic to simplify testing

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Transaction-heavy integration testing
  - **Skills**: none
  - **Skills Evaluated but Omitted**: none relevant

  **Parallelization**:
  - **Can Run In Parallel**: YES - Wave 4 (with Tasks 13, 14, 16)
  - **Blocks**: none
  - **Blocked By**: 9, 10

  **References**:
  - Task 12's integration test file - same bootstrapping/auth/DB conventions
  - `src/services/contractPlanningService.test.js` (Task 5) - exact date expectations to reuse as fixtures

  **Acceptance Criteria**:
  - [ ] `npx jest` full suite green; ≥ 12 new cases
  - [ ] Idempotency case asserts both response counts AND DB row counts

  **QA Scenarios**:
  ```
  Scenario: Full suite green
    Tool: Bash
    Steps:
      1. npx jest --verbose → 0 failures; new generate/sync cases listed
    Expected Result: Green including all prior suites
    Evidence: .omo/evidence/task-15-jest-full.txt

  Scenario: Idempotency proven at DB level (edge)
    Tool: Bash (grep test file)
    Steps:
      1. grep -A5 "skippedExisting" <test file> → assertion comparing DB counts before/after second generate
    Expected Result: Test asserts DB-level invariance, not just response shape
    Evidence: .omo/evidence/task-15-idempotency-assertion.txt
  ```

  **Commit**: YES (groups with 12)
  - Message: `test(contracts): add integration tests for contract API`
  - Files: integration test file(s)
  - Pre-commit: `npx jest`

- [ ] 16. Documentation: `docs/servfix/kontrakter.md` + planlegger cross-reference

  **What to do**:
  - Write `docs/servfix/kontrakter.md` in the same style/language (Norwegian) as `docs/servfix/planlegger.md`: what contracts are, fields explained, the save→approve→generate flow, frequency types incl. "X ganger per år" semantics, Tripletex sync behavior, the `show_contracts` flag, relationship to Periode rules (one contract ↔ one rule), what happens on deactivation, and the "generated orders are never modified" rule
  - Add a short cross-reference section in `docs/servfix/planlegger.md` ("Kontrakter kan opprette perioderegler automatisk - se kontrakter.md") without altering existing content otherwise

  **Must NOT do**:
  - NO restructuring of existing docs
  - NO code changes

  **Recommended Agent Profile**:
  - **Category**: `writing`
    - Reason: Norwegian technical documentation matching existing doc voice
  - **Skills**: none
  - **Skills Evaluated but Omitted**: none relevant

  **Parallelization**:
  - **Can Run In Parallel**: YES - Wave 4 (with Tasks 13, 14, 15)
  - **Blocks**: none
  - **Blocked By**: 9

  **References**:
  - `docs/servfix/planlegger.md` - tone, structure, heading style to match
  - `specs/contracts.md` (Task 1) - authoritative behavior source
  - `docs/servfix/order-lifecycle.md` - how order docs describe statuses (consistency)

  **Acceptance Criteria**:
  - [ ] `docs/servfix/kontrakter.md` exists, in Norwegian, covers all listed topics
  - [ ] planlegger.md diff is ≤ 5 added lines, 0 removed

  **QA Scenarios**:
  ```
  Scenario: Doc completeness
    Tool: Bash (grep)
    Steps:
      1. grep -ci "ganger per år" docs/servfix/kontrakter.md → ≥ 1
      2. grep -ci "godkjenn" docs/servfix/kontrakter.md → ≥ 1
      3. grep -ci "tripletex" docs/servfix/kontrakter.md → ≥ 1
      4. grep -c "kontrakter" docs/servfix/planlegger.md → ≥ 1
    Expected Result: All topics present; cross-ref added
    Evidence: .omo/evidence/task-16-doc-grep.txt

  Scenario: No collateral edits (edge)
    Tool: Bash
    Steps:
      1. git diff --stat docs/servfix/planlegger.md → ≤ 5 insertions, 0 deletions
    Expected Result: Additive only
    Evidence: .omo/evidence/task-16-planlegger-diff.txt
  ```

  **Commit**: YES
  - Message: `docs(servfix): document contracts feature`
  - Files: `docs/servfix/kontrakter.md`, `docs/servfix/planlegger.md`
  - Pre-commit: none (docs only)

---

## Final Verification Wave (MANDATORY - after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> Do NOT auto-proceed after verification. Never mark F1-F4 as checked before getting user's okay. Rejection or user feedback → fix → re-run → present again → wait for okay.

- [ ] F1. **Plan Compliance Audit** - `oracle`
  Read this plan end-to-end. For each "Must Have": verify implementation exists (read file, curl endpoint, run command). For each "Must NOT Have": search codebase for forbidden patterns (e.g. `ast_grep_search` for writes to Tripletex, new cron/scheduler code, columns added to `orders`) - reject with file:line if found. Check evidence files exist in `.omo/evidence/`. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** - `unspecified-high`
  Run `npx jest` (full suite). Review all changed files for: empty catches, console.log in prod paths, commented-out code, unused requires, SQL injection risks (string-interpolated SQL instead of $1 params), missing tenant scoping. Check AI slop: excessive comments, over-abstraction, generic names. Verify migration idempotency by reading the script.
  Output: `Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** - `unspecified-high` (+ `playwright` skill)
  Start server from clean state (`npm run dev`, dev tenant). Execute EVERY QA scenario from EVERY task - exact steps, capture evidence to `.omo/evidence/final-qa/`. Then cross-feature integration: create contract → approve dates → verify orders appear in the planner/order views; toggle contract inactive → verify linked rule deactivated; flag off → verify section hidden. Edge cases: contract with end_date < start_date (rejected), times_per_year=0 and 53 (rejected), double-click approve (no duplicates), Tripletex unreachable (graceful error toast).
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** - `deep`
  For each task: read "What to do", read actual diff (`git log`/`git diff`). Verify 1:1 - everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance per task. Detect cross-task contamination (task N touching task M's files unexpectedly). Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

> Conventional commits, small and focused, per repo rules. Run relevant tests before each commit. Suggested grouping (executor may adjust if file overlap forces it):

- **After T1**: `docs(specs): add contracts feature spec`
- **After T2**: `feat(db): add customer_contracts and contract_generated_orders migration` - pre-commit: run migration twice against dev tenant (idempotency)
- **After T3**: `test(planner): regression-lock expandDates frequency types` - pre-commit: `npx jest`
- **After T4**: `feat(flags): add show_contracts module flag`
- **After T5**: `feat(contracts): add contract planning service with times-per-year mapping` - pre-commit: `npx jest src/services/__tests__/contractPlanningService.test.js`
- **After T6**: `feat(tripletex): add pull-only contract sync service`
- **After T7**: `feat(contracts): add contract CRUD service and admin routes`
- **After T8**: `feat(admin-ui): add contracts section skeleton to customer page`
- **After T9**: `feat(contracts): add suggest-dates and generate endpoints with idempotent generation` - pre-commit: `npx jest`
- **After T10**: `feat(contracts): add tripletex sync endpoint`
- **After T11**: `feat(admin-ui): add contract create/edit modal`
- **After T12 + T15**: `test(contracts): add integration tests for contract API` - pre-commit: `npx jest`
- **After T13**: `feat(admin-ui): add contract date approval window`
- **After T14**: `feat(admin-ui): add tripletex sync button to contract modal`
- **After T16**: `docs(servfix): document contracts feature`

---

## Success Criteria

### Verification Commands
```bash
npx jest                                    # Expected: all suites pass, 0 failures
node migrations/00X-create-customer-contracts.js --tenant=<dev-tenant>   # Expected: exit 0, idempotent on re-run
curl -s -b cookies.txt http://localhost:<port>/api/admin/customers/<id>/contracts   # Expected: 200, JSON array
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass (`npx jest`)
- [ ] All QA evidence files exist in `.omo/evidence/`
- [ ] F1-F4 all APPROVE
- [ ] User gave explicit okay
