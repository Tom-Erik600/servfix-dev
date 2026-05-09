# Akseptansetester — testdata og preconditions

Dette dokumentet beskriver hvilken tenant, hvilke innstillinger, hvilken brukerrolle og hvilke
testdata hver akseptansetestgruppe forventer. Det fungerer som "kontrakten" mellom test-suiten
og tenantens tilstand.

## Felles utgangspunkt

| Felt | Verdi |
|---|---|
| **Tenant** | `demo` (subdomene, default `https://demo.servfix.no`) |
| **Admin-bruker** | `ADMIN_USERNAME` env (default `demo@servfix.no`) |
| **Tekniker-bruker** | `TECH_USERNAME` env (default `TECH-AT`) |
| **Sekundær tekniker** (valgfritt) | `SECONDARY_TECH_USERNAME` / `SECONDARY_TECH_PASSWORD` |
| **Settings-API** | `GET /api/images/settings`, `POST /api/images/save-settings` (admin) |
| **Tenant-flagg-API** (tekniker) | `GET /api/tenant/flags`, `GET /api/images/app-settings` |

Testene tar et **snapshot** av `module_flags`, `app_menu` og `hmsSettings` i `beforeAll`, og
**restaurerer** snapshotet i `afterAll`. Dette betyr at testene kan kjøres mot en delt tenant
uten å forurense innstillingene permanent.

Helpere ligger i `e2e/helpers/`:
- `auth.js` — `adminLogin`, `techLogin`, `techLoginAs`
- `settings.js` — `snapshotSettings`, `restoreSettings`, `applySettings`,
  `setPlanleggerFlags`, `setAppMenu`, `setHmsSettings`

---

## 01-auth — Innlogging

| Felt | Verdi |
|---|---|
| Tenant | `demo` |
| Innstillinger | Ingen krav |
| Rolle | admin + tekniker |
| Testdata | Eksisterende admin- og tekniker-bruker må finnes |

---

## 02-hovedprosess — Hovedflyt ordre → checklist → PDF

| Felt | Verdi |
|---|---|
| Tenant | `demo` |
| Innstillinger | Ingen eksplisitte flagg endres |
| Rolle | admin + tekniker |
| Testdata | Minst én kunde som ikke heter "Kirkerudbakken"; mulighet for å opprette anlegg på den |

---

## 03-tilbud — Tilbud-CRUD

| Felt | Verdi |
|---|---|
| Tenant | `demo` |
| Innstillinger | Ingen krav |
| Rolle | admin |
| Testdata | Minst én eksisterende ordre |

---

## 04-tekniker-ordre — Tekniker hasteordre

| Felt | Verdi |
|---|---|
| Tenant | `demo` |
| Innstillinger | `app_menu.hasteordre.visible = true` (ellers er kortet skjult) |
| Rolle | tekniker (oppretter), admin (cleanup) |
| Testdata | Kunde med navn som matcher `Demo` |

---

## 05-cluster — Equipment-cluster API

| Felt | Verdi |
|---|---|
| Tenant | `demo` |
| Innstillinger | Ingen krav |
| Rolle | admin |
| Testdata | Kunde "Demo Borettslag" med minst ett anlegg |

---

## 06-hms — HMS / SJA / ROS

| Felt | Verdi |
|---|---|
| Tenant | `demo` |
| **Innstillinger (preconditions)** | `app_menu.hms.visible = true`, `hmsSettings.hmsMenuEnabled = true`, `hmsSettings.sjaPerOrderEnabled = true` |
| Rolle | admin (ROS) + tekniker (SJA) |
| Testdata | Ingen — alt opprettes/ryddes i testen |

**Synlighetstester (egen describe):**
- HMS-kort: må sette begge: `app_menu.hms.visible` OG `hmsSettings.hmsMenuEnabled`
- SJA-knapp på ordre: krever `hmsSettings.sjaPerOrderEnabled = true`

---

## 07-planlegger-tabs — Tab-synlighet og Felles-kort

| Felt | Verdi |
|---|---|
| Tenant | `demo` |
| **Innstillinger (per test)** | Settes eksplisitt — se under |
| Rolle | admin |
| Testdata | Ingen |

| Test | Påkrevd `module_flags` |
|---|---|
| Kun én aktiv fane | `show_avansert_tab=true`, `show_enkel_tab=false`, `show_periode_tab=false`, `default_tab='avansert'` |
| Flere aktive faner | alle tre `show_*_tab=true`, `default_tab='avansert'` |
| Standardfane satt | `show_periode_tab=true`, `default_tab='periode'` |
| Standardfane deaktivert (fallback) | `default_tab='enkel'` men `show_enkel_tab=false` |
| Felles av | `show_pool_technician=false` |
| Felles på | `show_pool_technician=true` |

---

## 08-ledige-oppdrag — Pool / Felles-flow

| Felt | Verdi |
|---|---|
| Tenant | `demo` |
| **Innstillinger** | `module_flags.show_pool_technician = true`, `show_avansert_tab = true` |
| Rolle | admin (oppretter pool-ordre), tekniker (plukker) |
| Testdata | Minst én kunde (annen enn Kirkerudbakken) |
| Sekundær tekniker | `SECONDARY_TECH_USERNAME` + `SECONDARY_TECH_PASSWORD` (race-test skip uten dem) |

**API-endepunkter testet:**
- `POST /api/admin/orders` med `technicianId: null` → pool-ordre
- `GET /api/orders/available?range=today|tomorrow|week|month`
- `POST /api/orders/:id/claim` → `409` ved kollisjon

**UI-selektorer:** `[data-menu-key]`, `.pool-filter-btn[data-range="…"]`, `.claim-order-btn`.

---

## 09-periode — Periodeplaner

| Felt | Verdi |
|---|---|
| Tenant | `demo` |
| **Innstillinger** | `module_flags.show_periode_tab = true`, `show_avansert_tab = true`, `default_tab = 'periode'` |
| Rolle | admin |
| Testdata | Minst én kunde |

**API-endepunkter testet:**
- `POST /api/admin/recurring-orders` (opprett regel)
- `POST /api/admin/recurring-orders/:id/preview` (forhåndsvisning, ingen DB-skriving)
- `POST /api/admin/recurring-orders/:id/generate { confirmed: true }` (genererer ordrer)
- `GET /api/admin/recurring-orders/:id` (brukes av "Kopier regel")

**Generert regel:** etter generering returnerer `POST /generate` `409 "allerede generert"`.

**Negativ test:** Periode-fanen er skjult når `show_periode_tab=false`.

---

## 10-app-meny — App-meny-konfigurasjon

| Felt | Verdi |
|---|---|
| Tenant | `demo` |
| **Innstillinger (precondition)** | `hmsSettings.hmsMenuEnabled = true` (slik at HMS-kortet kan testes uten interferens fra HMS-modul-flagget) |
| Rolle | admin (endrer settings) + tekniker (verifiserer home) |
| Testdata | Ingen |

**Menyvalg dekket:**
| Key | Default tittel | URL |
|---|---|---|
| `planned_service` | Planlagte service | `index.html` |
| `planlegg_oppdrag` | Planlegg oppdrag | `planlegg.html` |
| `hasteordre` | Opprett hasteordre | `hasteordre.html` |
| `search_orders` | Søk ordre | `search-orders.html` |
| `hms` | HMS | `hms.html` |

**UI-selektor:** `[data-menu-key="<key>"]`, tittel-element `.menu-title`.

---

## Kjøre testene

```powershell
# Alle prosjekter
npx playwright test --config e2e/playwright.config.js

# Et enkelt prosjekt
npx playwright test --config e2e/playwright.config.js --project=periode

# Med synlig nettleser
$env:PW_HEADED='1'; npx playwright test --config e2e/playwright.config.js --project=app-meny
```

## Antagelser som testene IKKE gjør

- Tester antar **ikke** at alle planlegger-faner er aktive — de aktiverer dem først eller
  validerer at de er skjult når flagget er av.
- Tester antar **ikke** at app-meny-valg eller HMS-kort er synlig — de setter relevante flagg.
- Periode-/Enkel-/Felles-tester setter alltid riktig flagg før selve testen kjøres.
- HMS-kort-synlighet testes mot **både** `app_menu.hms.visible` og `hmsSettings.hmsMenuEnabled`.
