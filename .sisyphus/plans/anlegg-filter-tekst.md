# Plan: Filter med tekstbeskrivelse på anlegg
## Goal
Legge til valgfrie tekstfelter per filtertype på anlegg, slik at teknikeren ved neste service vet hvilket filter de skal ta med seg.

## Context
- Tech stack: Node.js/Express + PostgreSQL (raw SQL) + vanilla JS
- Eksisterende filter: 5 BOOLEAN-felter i equipment-tabellen
- Multi-tenant: run-migration-generic.js kjører SQL mot alle aktive tenants
- Spec: docs/servfix/equipment-filters.md

## TODOs

### T1 – DB-migrering: 4 nye TEXT-kolonner
- [ ] Opprett `database/equipment_filter_text_migration.sql` med ADD COLUMN IF NOT EXISTS for filter_supply_text, filter_exhaust_text, filter_drive_supply_text, filter_drive_exhaust_text (TEXT, NULL)
- Kjøres med: `node database/run-migration-generic.js database/equipment_filter_text_migration.sql`

### T2 – Backend: Tekniker-API (src/routes/equipment.js)
- [ ] GET /:id – legg til 4 nye kolonner i SELECT
- [ ] GET / – legg til 4 nye kolonner i SELECT + transform (camelCase)
- [ ] POST / – destrukturer filterSupplyText etc. fra req.body, legg til i INSERT
- [ ] PUT /:equipmentId – destrukturer + legg til i UPDATE SET

### T3 – Backend: Admin-API (src/routes/admin/equipment.js)
- [ ] GET – legg til 4 nye kolonner
- [ ] POST – legg til i INSERT
- [ ] PUT – legg til i UPDATE

### T4 – Backend: Orders-API (src/routes/orders.js)
- [ ] Verifiser at GET /api/orders/:id returnerer equipment med de 4 nye text-feltene (JOIN eller sub-query)

### T5 – Admin UI: kunder.html
- [ ] Legg til 4 tekstfelter (input type=text) under hver sub-checkbox i BEGGE modaler (Opprett + Rediger anlegg)
- [ ] IDs: create-filter-supply-text, create-filter-exhaust-text, create-filter-drive-supply-text, create-filter-drive-exhaust-text (og edit-* varianter)
- [ ] Tekstfelt vises kun når tilhørende checkbox er checked (CSS display:none/flex)

### T6 – Admin JS: kunder.js
- [ ] Populate tekstfelter ved redigering (linje ~1159-1164)
- [ ] Reset tekstfelter ved nullstilling (linje ~1197-1202)
- [ ] Les tekstfelter ved lagring (linje ~1323-1327)
- [ ] Toggle synlighet per tekstfelt ved checkbox-endring (linje ~1963-1969)

### T7 – Tekniker UI: orders.js (badge + anlegg-info)
- [x] Utvid amber filter-badge til å vise tekst når tilstede, f.eks. "Tilluft (ePM1 60%, 592x592x100)"
- [x] Utvid anlegg-info-grid i service-visning til å vise tekst inline per filtertype

### T8 – Tekniker UI: service.js (anlegg-info-grid)
- [x] Vis filtertype + tekst i anlegg-info-griden under service-utførelse

### T9 – Tekniker UI: app.js (ny filterknapp på ordre-kort)
- [x] Legg til liten filterknapp øverst til høyre i order-card-header (createOrderCardHTML)
- [x] Knappen vises kun hvis ordren har minst ett anlegg med has_filters=true
- [x] Klikk åpner modal (simple-confirm-modal-mønster) som lister: per anlegg → per aktiv filtertype → tekst (eller bare type hvis ingen tekst)

### T10 – Spec-oppdatering
- [x] Oppdater docs/servfix/equipment-filters.md med nye felter, UI-regler og API-shape

## Final Verification Wave
- [x] F1 – Migrering er idempotent (kan kjøres to ganger uten feil)
- [x] F2 – Eksisterende anlegg uten tekst vises korrekt (ingen null-feil i UI)
- [x] F3 – Admin kan lagre tekst, tekniker ser tekst i badge og ordre-modal
- [x] F4 – Ingen endringer i order lifecycle, PDF-generering eller sjekkliste-validering
