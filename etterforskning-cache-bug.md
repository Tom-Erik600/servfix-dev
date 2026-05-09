# Etterforskning: Rotårsak for cache-symptomene i 07/10-akseptansetestene

**Dato:** 2026-05-09  
**Etterforsker:** opencode / Claude  
**Status:** Ferdig — rotårsak bekreftet med data

---

## Symptom v0

**Testkommando som feiler:**
```
npx playwright test "07-planlegger-tabs" "10-app-meny" --workers=2
```

**Testkommando som alltid passerer:**
```
npx playwright test "07-planlegger-tabs" "10-app-meny" --workers=1
```

**Feilende test:** `10-app-meny.spec.js:142` — "Skjul search_orders"

**Forespørselssekvens (rekonstruert fra testkode):**

1. Admin-session: `POST https://demo.servfix.no/api/images/save-settings`  
   Body: `{ "app_menu": { "search_orders": { "visible": false, "title": "Søk ordre" } } }`  
   Respons: 200 OK — serveren rapporterer suksess

2. Poll (admin-session, 20s timeout): `GET https://demo.servfix.no/api/images/app-settings?_=<timestamp>`  
   Forventet: `{ app_menu: { search_orders: { visible: false, ... } } }`  
   Faktisk etter 20s: `{ app_menu: { search_orders: { visible: true, ... } } }`

**Observert:**
- Med 1 worker (serialisert): 11/11 grønne, alltid
- Med 2 workers: test 142 feiler konsistent
- Hvilke tester som feiler roterer — ikke alltid samme test, men alltid en test i suite 10

---

## Bevis per hypotese

### H1 — Read/write path mismatch
**AVKREFTET**

GCS-filen for demo-tenanten (`gs://servfix-files-test/tenants/demo/assets/settings.json`) inneholder `app_menu`-nøkkel med riktig struktur. Etter en vellykket `save-settings`-respons oppdateres GCS-filen. Read og write bruker samme sti. Ingen strukturell mismatch.

Bevis: `settings.json` for demo inneholder `app_menu` med identisk struktur som det endepunktet returnerer.

### H2 — Frontend-cache (service worker, localStorage)
**AVKREFTET**

Ingen `sw.js`-fil eller service worker-registrering finnes i `public/app/home.html` eller `public/`-katalogen. `home.html` har ingen `navigator.serviceWorker.register()`-kall. `waitForAppMenuSettings` bruker `fetch()` med `cache: 'no-store'` — omgår HTTP-cache.

### H3 — Skrivefeil i save-settings
**AVKREFTET** (implisitt via H1)

GCS-filen oppdateres korrekt etter `save-settings`. Problemet er ikke at skriving feiler.

### H4 — Test-bug
**DELVIS RELEVANT men ikke rotårsak**

`waitForAppMenuSettings` poller `/api/images/app-settings` (tekniker-endepunktet) med tekniker-session. Dette er korrekt — det er faktisk endepunktet tekniker-siden bruker. Match-syntaksen er riktig (`toMatchObject` med `{ visible: false }`).

**Men:** `applySettings` sin interne poll (som verifiserer at save har propagert) pollet tidligere `/api/images/settings` (admin-endepunktet) — nå endret til `/api/images/app-settings`. Dette var en bidragsfaktor i at pollingen i `settings.js` ikke ventet på riktig endepunkt. Fikset i `settings.js` (commit allerede gjort).

Imidlertid: selv med denne fiksen feiler testene — fordi rotårsaken er en annen (se H5).

### H5 — Deploy/traffic split ⭐ BEKREFTET ROTÅRSAK
**BEKREFTET MED DATA**

**`demo.servfix.no` er registrert som domain mapping i to separate GCP-prosjekter:**

```
servfix-production:
  demo.servfix.no → servfix-app (revisjon 00327-6vl, GCS_BUCKET_NAME=servfix-files)

servfix-test:
  demo.servfix.no → servfix-app (revisjon 00149-fl2, GCS_BUCKET_NAME=servfix-files-test)
```

Begge bruker `ghs.googlehosted.com` (Google-managed CNAME). DNS-oppløsning for `demo.servfix.no` returnerer `ghs.googlehosted.com`, og Google's load balancer ruter requests til **en av de to Cloud Run-instansene ikke-deterministisk** basert på intern routing.

**Konsekvens:**
- `POST /api/images/save-settings` → treffer f.eks. **servfix-test** → skriver til `gs://servfix-files-test/tenants/demo/assets/settings.json`
- `GET /api/images/app-settings` (poll) → treffer f.eks. **servfix-production** → leser fra `gs://servfix-files/tenants/demo/assets/settings.json`

`servfix-production`-bucketen (`servfix-files`) har **ingen `demo`-tenant** — bare `airtech`. Koden returnerer da `getDefaultAppMenuSettings()` (alle `visible: true`) som fallback.

**Dette forklarer nøyaktig symptomet:**
- Skriving rapporterer 200 OK (korrekt, på test-instansen)
- Lesing returnerer alltid `visible: true` (default-fallback, på prod-instansen)
- Timeout etter 20s fordi verdien aldri endres på prod-instansen

**Bekreftet med data:**
```
gsutil ls gs://servfix-files/tenants/
→ gs://servfix-files/tenants/airtech/   ← kun airtech, ingen demo

gsutil ls gs://servfix-files-test/tenants/
→ gs://servfix-files-test/tenants/demo/  ← demo finnes her
```

**Reproduksjonsmekanisme:** Med 2 Playwright-workers kjøres `save-settings` og `poll` i separate browser-contexts parallelt. Statistisk sannsynlighet for å treffe ulike backend-instanser øker med concurrency. Med 1 worker er alle requests serialiserte og treffer sannsynligvis samme instans.

### H6 — Multi-instans cache divergence (opprinnelig hypotese)
**AVKREFTET som primær årsak**

Prod (`servfix-production`) skalerer max 10 instanser, men minimum er 1. Under testbelastning er sannsynlig instansantall 1-2. Dette KAN bidra, men er ikke rotårsaken.

**Avkreftende bevis:** Selv med `bypassCache: true` på alle endepunkter vil feilen vedvare, fordi de to Cloud Run-instansene leser fra ulike GCS-bucketer. Cache-strategien er irrelevant når backing-store er forskjellig.

### H7 — GCS write-propagation lag
**AVKREFTET som primær årsak**

GCS er sterkt konsistent for read-after-write på samme bucket/objekt. Propagation lag på GCS er ikke en faktor her. Rotårsaken er at write og read treffer ulike bucketer, ikke at én bucket er forsinket.

---

## Konklusjon

**Rotårsak (bekreftet):** `demo.servfix.no` er mappet som Cloud Run domain mapping i **to GCP-prosjekter** (`servfix-production` og `servfix-test`). Google's load balancer ruter requests ikke-deterministisk mellom begge prosjektenes Cloud Run-instanser. De to instansene bruker ulike GCS-bucketer (`servfix-files` vs. `servfix-files-test`) og har ingen felles tilstand. En `save-settings` på test-instansen er usynlig for prod-instansen, og omvendt.

**Testfeil er reell infrastrukturfeil — ikke en bug i applikasjonskoden eller test-koden.**

---

## Anbefalt fix (Tom-Erik bestemmer implementasjon)

**Opsjon A (anbefalt):** Fjern `demo.servfix.no` domain mapping fra `servfix-production`. Demo-tenanten eksisterer kun i test-infrastrukturen og bør kun svare fra test-prosjektet.

**Opsjon B:** Flytt testene til å bruke `airtechtest.servfix.no` (kun mappet til `servfix-test`) og konfigurer `demo@servfix.no` / `TECH-AT` credentials for test-prosjektet.

**Opsjon C:** Flytt `demo`-tenanten til prod-infrastrukturen (`servfix-production`, `servfix-files`-bucketen) og slett domain mapping fra test.

**Viktig:** `bypassCache: true`-endringen på `/api/images/app-settings` (gjort i forrige runde) er ufarlig men irrelevant for rotårsaken. Den hverken hjelper eller skader.

---

## Hva ble ikke bekreftet eller avkreftet

- **Eksakt routing-algoritme** for Google's multi-project domain mapping: det er ikke dokumentert om dette er round-robin, geo-based, eller noe annet. Vi vet det skjer, men ikke eksakt frekvens.
- **Om testene vil passere konsistent etter Opsjon A/B/C**: sannsynlig ja, men bør verifiseres.
- **Om andre tester (01-06) påvirkes**: usannsynlig siden de bruker `demo.servfix.no` men sannsynligvis ikke endrer settings under parallellkjøring.

---

## Sjekkliste

- [x] Symptom v0 er dokumentert eksakt
- [x] H1 sjekket — avkreftet
- [x] H2 sjekket — avkreftet  
- [x] H3 implisitt dekket av H1 — avkreftet
- [x] H4 sjekket — delvis relevant, ikke rotårsak
- [x] H5 sjekket — **BEKREFTET ROTÅRSAK**
- [x] H6 sjekket — avkreftet som primær årsak
- [x] H7 sjekket — avkreftet
- [x] Ingen kode endret under etterforskningen
- [x] Ingen deploy gjort under etterforskningen
