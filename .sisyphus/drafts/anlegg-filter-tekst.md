# Draft: Filter med tekstbeskrivelse på anlegg

## Original Request
Kunden ønsker at man på anlegg ikke bare skal kunne krysse av for "filter", men også kunne legge inn tekst på filteret som lagres på anlegget. Slik at teknikeren ved neste service kan se hvilket filter de skal ta med seg.

## Requirements (confirmed)
- **Tekstfelt-struktur**: Ett tekstfelt per filtertype (4 nye felter)
- **Synlighet i admin**: Tekstfelt vises kun når avkrysning for tilhørende type er aktiv
- **Påkrevd?**: Valgfritt – avkrysning kan stå alene som i dag (bakoverkompatibelt)
- **Visning for tekniker (badge)**: Utvidet badge på anleggskort i orders.html
- **Visning for tekniker (ordre)**: NY filterknapp øverst til høyre i order-card-header (index.html), åpner liten modal som lister alle filtre på alle anlegg i ordren
- **Historikk**: Nei – kun gjeldende verdi

## Technical Decisions
- **DB**: 4 nye TEXT-kolonner på `equipment`-tabellen: `filter_supply_text`, `filter_exhaust_text`, `filter_drive_supply_text`, `filter_drive_exhaust_text` (NULL tillatt)
- **Migrering**: Egen idempotent SQL-fil `database/equipment_filter_text_migration.sql` etter mønster fra `equipment_filters_migration.sql`
- **API**: Utvid GET/POST/PUT i både `src/routes/admin/equipment.js` og `src/routes/equipment.js` med camelCase-feltene `filterSupplyText`, `filterExhaustText`, `filterDriveSupplyText`, `filterDriveExhaustText`
- **Backend regel**: Frontend er sole guard (konsistent med has_filters-mønster). Backend lagrer det som sendes inn.
- **Admin UI**: Utvid kunder.html-modaler med ett tekstfelt under hver av de 4 sub-checkboxene. Toggle synlighet via samme JS-mekanisme som finnes i kunder.js.
- **Badge i orders.html**: Utvid amber filter-badge til å vise tekst når den finnes
- **Anlegg-info i service.html**: Vis tekst inline ved hver filtertype hvis tilstede
- **NY filterknapp i index.html**: I order-card-header (app.js createOrderCardHTML), liten knapp øverst til høyre. Klikk åpner modal som lister: per anlegg → per aktiv filtertype → spesifikasjon (tekst). Bruk simple-confirm-modal-mønster fra orders.js.
- **Datakilde for modal**: GET /api/orders/:id

## Files to Modify
1. `database/equipment_filter_text_migration.sql` (NY)
2. `src/routes/admin/equipment.js` – GET/POST/PUT
3. `src/routes/equipment.js` – GET/POST/PUT
4. `src/routes/orders.js` – sørge for at /api/orders/:id returnerer nye felter
5. `public/admin/kunder.html` – legge til 4 tekstfelter i modaler
6. `public/admin/assets/js/kunder.js` – populate/save/toggle visibility
7. `public/app/assets/js/orders.js` – utvide badge + anlegg-info-grid
8. `public/app/assets/js/service.js` – utvide anlegg-info-grid
9. `public/app/assets/js/app.js` – ny filterknapp + modal i order-card-header
10. `docs/servfix/equipment-filters.md` – oppdatere spec

## Scope Boundaries
- INCLUDE: 4 tekstfelter per anlegg, admin-redigering, tekniker-visning (badge + service + ny ordre-modal), backend API, migrering, spec-oppdatering
- EXCLUDE: Filter-historikk, filter-byttetidspunkter, sjekklist-endringer, PDF-rapport-endringer, varsling, lagerstyring, deler-katalog
