# ServFix HMS-modul — Claude Code implementasjonsinstrukser

> **Mål:** Legge til HMS-funksjonalitet (SJA + ROS) i ServFix som en konfigurerbar modul.
> **Arbeidsmappe:** `E:\apps\servfix-dev`
> **Test alltid i dev før test/prod.**

---

## ⛔ STOPP-punkter

Disse punktene krever manuell godkjenning fra Tom-Erik før du fortsetter:

- **⛔ STOPP 1** — Etter at DB-migreringen er kjørt i DBeaver
- **⛔ STOPP 2** — Etter at backend-routes er verifisert i dev
- **⛔ STOPP 3** — Etter at frontend er verifisert i dev

---

## Oversikt — hva som skal bygges

### To bruksscenarioer:

| Scenario | Plassering | Beskrivelse |
|---|---|---|
| HMS-meny | Mobilapp — navigasjonsknapp | Fast knapp i menyen for SJA og ROS frittstående |
| SJA per ordre | Mobilapp — ordresiden | «Legg til SJA»-knapp direkte på ordren |

### Konfigurerbart i adminpanelet:
- `hms_menu_enabled` — skjuler/viser HMS-knappen i mobilmenyen
- `sja_per_order_enabled` — skjuler/viser SJA-knappen på ordresiden

---

## FASE 1 — Database

> **Utføres manuelt av Tom-Erik i DBeaver mot tenant-DB (f.eks. `airtech_db`)**
> Claude Code skal IKKE kjøre disse SQL-kommandoene.

### SQL som Tom-Erik kjører:

```sql
-- Tabell for SJA (Sikker Jobb Analyse)
CREATE TABLE IF NOT EXISTS hms_sja (
    id SERIAL PRIMARY KEY,
    order_id VARCHAR(50) REFERENCES orders(id) ON DELETE SET NULL,  -- nullable: frittstående SJA. orders.id er VARCHAR ikke INTEGER!
    technician_id VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    job_description TEXT NOT NULL,
    location TEXT,
    identified_risks TEXT,
    safety_measures TEXT,
    approved_by VARCHAR(100),
    signature_data TEXT,  -- base64 signatur
    status VARCHAR(20) DEFAULT 'draft',  -- draft | completed
    pdf_url TEXT
);

-- Tabell for ROS (Risiko- og Sårbarhetsanalyse)
CREATE TABLE IF NOT EXISTS hms_ros (
    id SERIAL PRIMARY KEY,
    created_by VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    title TEXT NOT NULL,
    project_type TEXT,
    form_data JSONB NOT NULL DEFAULT '{}',  -- fleksibel lagring av ROS-feltene
    status VARCHAR(20) DEFAULT 'draft',
    pdf_url TEXT,
    version INTEGER DEFAULT 1
);

-- Indekser
CREATE INDEX IF NOT EXISTS idx_hms_sja_order_id ON hms_sja(order_id);
CREATE INDEX IF NOT EXISTS idx_hms_sja_technician_id ON hms_sja(technician_id);
CREATE INDEX IF NOT EXISTS idx_hms_ros_status ON hms_ros(status);
```

### **⛔ STOPP 1** — Bekreft til Tom-Erik at SQL er kjørt, og vent på godkjenning.

---

## FASE 2 — Backend

### 2.1 — Ny route-fil: `src/routes/hms.js`
### 2.2 — Registrer route i `server.js`
### 2.3 — HMS-innstillinger i `src/routes/images.js`

### **⛔ STOPP 2** — Verifiser backend i dev

---

## FASE 3 — Frontend: Mobilapp

### 3.1 — `public/app/hms.html` (HMS-meny)
### 3.2 — `public/app/sja.html` (SJA-skjema)
### 3.3 — `public/app/ros.html` (ROS-leserside)
### 3.4 — HMS-knapp i `public/app/home.html`
### 3.5 — SJA-knapp i `public/app/assets/js/orders.js`

### **⛔ STOPP 3** — Verifiser frontend i dev

---

## FASE 4 — Adminpanel

### 4.1 — HMS-toggles i `public/admin/innstillinger.html`
### 4.2 — JavaScript for lagring/henting av HMS-innstillinger

---

## Viktige hensyn

- **`orders.id` er VARCHAR, IKKE INTEGER** — bruk aldri `parseInt()` på order_id
- `hms_sja.id` og `hms_ros.id` er SERIAL (integer) — `parseInt()` er riktig der
- `order_id` i `hms_sja` er **nullable** — dekker både frittstående og ordre-tilknyttet SJA
- Innstillinger bruker eksisterende **GCS JSON-system** — ikke en ny DB-tabell
- PDF-generering legges til senere — ikke nå
- Følg eksisterende kodemønster: `pageState` i orders.js, `state` i service.js
