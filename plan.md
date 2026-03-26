# ServFix — Cluster + Prosjektsøk — Implementasjonsplan

> **Mål:** Legge til cluster-funksjonalitet for gruppering av anlegg per kunde, og prosjektsøk i admin-planleggeren.
> **Arbeidsmappe:** `E:\apps\servfix-dev`
> **Test alltid i dev før test/prod.**

---

## Bakgrunn og designbeslutninger

### Cluster
- Et cluster er en **navngitt gruppe anlegg** tilhørende en kunde — f.eks. "Industriveien 92 Eidsvoll"
- Clusteret tilhører **kunden**, ikke et Tripletex-prosjekt
- Clusteret lever permanent — det forsvinner ikke når Tripletex-prosjekter lukkes hvert år
- Cluster lagres i egen tabell `equipment_clusters` med `customer_id` som FK
- Anlegg (`equipment`) får en `cluster_id`-kolonne som peker på sitt cluster (nullable)
- Anlegg uten cluster vises individuelt
- Tripletex-prosjekt kan knyttes løst til et cluster som referanse (valgfritt felt) — men er ikke påkrevd
- Cluster er **ikke** lagret på ordren — `included_equipment_ids` på ordren er fortsatt eneste kilde til hvilke anlegg som inngår
- I planleggeren kan man velge et cluster for å auto-velge alle anleggene i det

### Prosjektsøk i planleggeren
- Ny fane "Prosjekter" ved siden av "Kunder" i admin-planleggeren
- Live-søk mot Tripletex API (ikke lokal synk — prosjekter endres for ofte)
- Søk på prosjektnavn eller -nummer
- Prosjektkortet viser: prosjektnavn, prosjektnummer, kundenavn
- Drag tekniker til prosjektkort → kunden hentes fra prosjektet, prosjektnavnet foreslås som beskrivelse

### Merk alle / Fjern alle
- Enkel forbedring i anleggsmodalen i planleggeren (både admin og tekniker)

---

## ⛔ STOPP-punkter

- **⛔ STOPP 1** — Etter at DB-migreringen er kjørt i DBeaver
- **⛔ STOPP 2** — Etter at backend-routes er verifisert i dev
- **⛔ STOPP 3** — Etter at frontend er verifisert i dev

---

## FASE 1 — Database

> **Utføres manuelt av Tom-Erik i DBeaver mot tenant-DB (f.eks. `airtech_db`)**
> Claude Code skal IKKE kjøre disse SQL-kommandoene.

```sql
-- Ny tabell: cluster per kunde
CREATE TABLE IF NOT EXISTS equipment_clusters (
    id          SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    name        VARCHAR(255) NOT NULL,
    notes       TEXT,
    -- Valgfri løs referanse til Tripletex-prosjekt (historikk/referanse, ikke påkrevd)
    tripletex_project_id   INTEGER,
    tripletex_project_name VARCHAR(255),
    created_at  TIMESTAMP DEFAULT NOW(),
    updated_at  TIMESTAMP DEFAULT NOW(),
    UNIQUE (customer_id, name)   -- Unikt clusternavn per kunde
);

CREATE INDEX IF NOT EXISTS idx_clusters_customer ON equipment_clusters(customer_id);

-- Ny kolonne på equipment: kobling til cluster (nullable)
ALTER TABLE equipment
    ADD COLUMN IF NOT EXISTS cluster_id INTEGER REFERENCES equipment_clusters(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_equipment_cluster ON equipment(cluster_id);
```

### **⛔ STOPP 1** — Bekreft til Tom-Erik at SQL er kjørt, og vent på godkjenning.

---

## FASE 2 — Backend

### 2.1 — Ny route-fil: `src/routes/admin/clusters.js`

Endepunkter:

| Method | Path | Beskrivelse |
|--------|------|-------------|
| GET    | `/api/admin/clusters?customerId={id}` | Hent alle cluster for en kunde (inkl. antall anlegg) |
| POST   | `/api/admin/clusters` | Opprett nytt cluster |
| PUT    | `/api/admin/clusters/:clusterId` | Rediger clusternavn / noter / prosjektreferanse |
| DELETE | `/api/admin/clusters/:clusterId` | Slett cluster (setter cluster_id = NULL på tilhørende anlegg) |

Response-shape for GET:
```json
[
  {
    "id": 1,
    "customerId": 42,
    "name": "Industriveien 92 Eidsvoll",
    "notes": null,
    "tripletexProjectId": null,
    "tripletexProjectName": null,
    "equipmentCount": 4,
    "createdAt": "2026-01-10T..."
  }
]
```

### 2.2 — Oppdater `src/routes/admin/equipment.js`

- GET equipment: inkluder `cluster_id` og `cluster_name` (via JOIN) i responsen
- POST equipment: ta imot valgfritt `clusterId`-felt
- PUT equipment: ta imot valgfritt `clusterId`-felt (for å flytte anlegg til/fra cluster)

### 2.3 — Ny route for prosjektsøk: `src/routes/admin/projects.js`

Endepunkt:

| Method | Path | Beskrivelse |
|--------|------|-------------|
| GET    | `/api/admin/projects/search?q={søk}` | Søk i Tripletex på prosjektnavn eller -nummer |

Kaller Tripletex `GET /v2/project?name={q}` og `GET /v2/project?number={q}`, merger og deduper resultater.

Response-shape:
```json
[
  {
    "id": 12345,
    "name": "2025-047 Industriveien 92 ÅMV Eidsvoll",
    "number": "2025-047",
    "displayName": "2025-047 Industriveien 92 ÅMV Eidsvoll",
    "customer": {
      "id": 789,
      "name": "Air-Tech AS"
    },
    "isClosed": false
  }
]
```

### 2.4 — Registrer nye routes i `src/app.js` (eller `server.js`)

```javascript
app.use('/api/admin/clusters', require('./routes/admin/clusters'));
app.use('/api/admin/projects', require('./routes/admin/projects'));
```

### **⛔ STOPP 2** — Verifiser backend i dev med curl/Postman før frontend.

---

## FASE 3 — Frontend: Admin-planlegger (planlegger.html / planlegger.js)

### 3.1 — Merk alle / Fjern alle i anleggsmodal

I modalen der anlegg vises som checkboxes, legg til to knapper over listen:

```html
<div class="equipment-select-actions">
  <button type="button" onclick="selectAllEquipment()">Merk alle</button>
  <button type="button" onclick="deselectAllEquipment()">Fjern alle</button>
</div>
```

Tilsvarende i tekniker-planleggeren (`planlegg.js`).

### 3.2 — Cluster-visning i anleggsmodal

Når modal åpnes for en kunde:
- Hent cluster for kunden: `GET /api/admin/clusters?customerId={id}`
- Vis anlegg gruppert: cluster-navn som seksjonstittel, anlegg under
- Anlegg uten cluster vises under "Øvrige anlegg"
- Klikk på cluster-navn → toggle alle anlegg i clusteret (merk/fjern alle i gruppen)

```
[ ] Merk alle  [ ] Fjern alle

▼ Industriveien 92 Eidsvoll  [Merk alle i gruppe]
  ☑ BA-01  Boligventilasjon leil 101
  ☑ BA-02  Boligventilasjon leil 102
  ☑ V-01   Ventilasjonsaggregat 1.etg

▼ Skolebygget Ringsaker  [Merk alle i gruppe]
  ☑ V-10   Aggregat 1.etg øst

▼ Øvrige anlegg
  ☐ V-99   Ukjent plassering
```

### 3.3 — Prosjektsøk-fane i planleggeren

Legg til faner over kundelisten:

```html
<div class="planner-tabs">
  <button class="tab active" data-tab="customers">Kunder</button>
  <button class="tab" data-tab="projects">Prosjekter</button>
</div>
```

**Prosjekt-fanen:**
- Søkefelt med debounce 500ms
- Kaller `GET /api/admin/projects/search?q={input}`
- Viser prosjektkort: prosjektnavn, prosjektnummer, kundenavn
- Prosjektkortene er drop-targets på samme måte som kundekort
- Ved drop: kunden hentes fra prosjektets `customer.id`, prosjektnavnet foreslås i beskrivelse-feltet i modalen

---

## FASE 4 — Frontend: Cluster-administrasjon

### 4.1 — Ny side eller integrasjon i eksisterende kundeside

**Forslag: Ny side `/admin/anlegg.html`** — eller som fane i kundeoversikten.

Funksjoner:
- Velg kunde fra dropdown
- Se alle cluster for kunden (med antall anlegg)
- Opprett nytt cluster (fritekst-navn, valgfritt koble til Tripletex-prosjekt)
- Rediger clusternavn
- Slett cluster (anlegg mister cluster, men slettes ikke)
- Se anlegg gruppert under hvert cluster
- Knytt/løsne anlegg fra cluster (dropdown på hvert anlegg)

---

## Risiko og rollback

| Risiko | Tiltak |
|--------|--------|
| `cluster_id`-kolonnen bryter eksisterende equipment-queries | Kolonnen er nullable og ignorert av eksisterende kode — ingen breaking change |
| Tripletex-søk er tregt (300-500ms) | Debounce 500ms + loading-spinner |
| Clusternavn-duplikat ved skrivefeil | `UNIQUE(customer_id, name)` i DB gir 409-feil som håndteres i frontend |
| Sletting av cluster fjerner kobling for alle anlegg | `ON DELETE SET NULL` — anlegg mister cluster men slettes ikke. Advarselsmelding i UI. |
| Prosjektsøk mot Tripletex feiler | Vis feilmelding i fanen, fallback til kun kundekort |

### Rollback
- DB: `ALTER TABLE equipment DROP COLUMN cluster_id;` + `DROP TABLE equipment_clusters;`
- Backend: fjern route-registreringer i app.js
- Frontend: fjern fane-markup og cluster-seksjon i modal

---

## Testplan

### Cluster
- [ ] Opprett cluster for kunde A — vises i liste
- [ ] Forsøk duplikatnavn på samme kunde — skal gi feil
- [ ] Samme navn på to forskjellige kunder — skal fungere
- [ ] Knytt anlegg til cluster — anlegget vises under riktig gruppe i modal
- [ ] Slett cluster — anlegg mister cluster_id, men eksisterer fortsatt
- [ ] Anlegg uten cluster vises under "Øvrige anlegg"
- [ ] Merk alle i gruppe — alle checkboxes i gruppen krysses av
- [ ] Merk alle / Fjern alle globalt

### Prosjektsøk
- [ ] Søk på prosjektnavn gir relevante resultater fra Tripletex
- [ ] Søk på prosjektnummer gir riktig prosjekt
- [ ] Tomt søkefelt viser ingen resultater (ikke kall API)
- [ ] Drag tekniker til prosjektkort — modal åpnes med riktig kunde og prosjektnavn i beskrivelse
- [ ] Tripletex nede — feilmelding vises, kunde-fanen fungerer fortsatt

---

## Implementeringsrekkefølge (anbefalt)

| # | Oppgave | Kompleksitet | Avhenger av |
|---|---------|-------------|-------------|
| 1 | DB-migrasjon (cluster-tabell + equipment-kolonne) | Lav | — |
| 2 | Merk alle / Fjern alle i anleggsmodal | Lav | — |
| 3 | Backend: clusters CRUD (`/api/admin/clusters`) | Medium | 1 |
| 4 | Backend: prosjektsøk (`/api/admin/projects/search`) | Lav | — |
| 5 | Frontend: cluster-visning i planlegger-modal | Medium | 1, 3 |
| 6 | Frontend: prosjektsøk-fane i planleggeren | Medium | 4 |
| 7 | Frontend: cluster-administrasjonsside | Medium | 1, 3 |
