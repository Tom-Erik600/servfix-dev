# Draft: Nye kundekrav – Samlet plan

## Requirements (confirmed)

### 1. Servicedato i PDF og rediger-modal
- PDF bruker nå completed_at || created_at – skal bruke orders.scheduled_date
- scheduled_date hentes allerede i fetchReportData() som service_date, men rendres ikke
- Skal vises i PDF som "Servicedato"
- Skal kunne redigeres i rapporter.html "Rediger PDF rapport"-modal
- "Service"-kolonnen i rapport-koen bruker MAX(sr.created_at) – bor bruke scheduled_date

### 2. Serviceadresse (per ordre)
- 3 nye kolonner pa orders: service_address_street, service_address_postal_code, service_address_city
- Valgfri – tom = fallback til kundens adresse i PDF
- Settes i admin planlegger-modal
- Vises i PDF + redigerbar i rapporter.html

### 3. Kontaktpersoner import fra Tripletex
- Importer ALLE kontakter for en kunde (ikke bare servfixmail)
- tripletexService.getCustomerContacts() finnes allerede
- Preview/apply-knapp i kunder.html
- Setter IKKE is_report_recipient automatisk

### 4. Filter pa anlegg
- Lagres pa equipment-niva (ikke sjekkliste)
- 5 nye boolean-kolonner: has_filters, filter_supply_air, filter_exhaust_air, filter_belt_supply, filter_belt_exhaust
- Redigerbart i kunder.html (admin) og i tekniker-appen under service (lagres tilbake pa equipment)
- Vises i PDF og systemoversikt

### 5. Avtalenummer fra Tripletex-prosjekt
- Foreslars automatisk fra valgt Tripletex-prosjekt i planlegger-modal
- Redigerbart av planlegger
- Lagres i orders.customer_data.agreement_number (eksisterende felt)

### 6. Besoksnr ved ordre-opprettelse
- Fritekst-felt i planlegger-modal (f.eks. "Var 2026")
- Kan foreslas fra Tripletex-prosjekt
- Lagres i orders.customer_data.visit_number (eksisterende felt)

### 7. Hasteordre – beskrivelse
- Tekstfelt i hasteordre.html for navn/beskrivelse
- description-feltet finnes i DB og backend – kun UI-endring

### 8. kunder.html – fast detaljpanel ved scroll
- Venstre kundeliste scroller, hoyre kundedetaljer star fast
- CSS-endring: sticky positioning eller separate scroll-containere

## Technical Decisions
- Filter: 5 nye boolean-kolonner pa equipment-tabellen via migration
- Serviceadresse: 3 nye kolonner pa orders-tabellen via migration
- Avtalenummer/besoksnr: ingen nye DB-kolonner, bruker eksisterende customer_data JSONB
- Kontaktimport: ny importKontakter-funksjon + route + UI-knapp

## Research Findings
- PDF-dato bug: unifiedPdfGenerator.js linjene 1158+1182 bruker completed_at, ikke service_date
- service_date = scheduled_date hentes allerede i fetchReportData()
- Hasteordre: description hardkodet i hasteordre.js handleCreateOrder()
- Tripletex-prosjekter fetches live (ingen lokal cache)
- Prosjektvalg fyller kun description, ikke agreement_number – ny logikk trengs
- kunder.html: CSS grid 3 kolonner i kundeinfo.css
- customer_contacts har alle felt som trengs
- equipment.notater finnes allerede – filter er nytt konsept

## Scope Boundaries
- INCLUDE: Servicedato i PDF + rediger-modal + rapport-ko-kolonne
- INCLUDE: Serviceadresse (3 DB-kolonner), planlegger-modal, PDF, rediger-modal
- INCLUDE: Tripletex-kontaktimport via knapp i kunder.html (ingen auto-rapport-mottaker)
- INCLUDE: Filter pa equipment (5 DB-kolonner), kunder.html, tekniker-service, PDF
- INCLUDE: Avtalenummer foreslas fra Tripletex-prosjekt i planlegger-modal
- INCLUDE: Besoksnr i planlegger-modal
- INCLUDE: Hasteordre-beskrivelse i opprettelses-modal
- INCLUDE: kunder.html fast detaljpanel (CSS)
- EXCLUDE: Automatisk rapport-mottaker ved kontaktimport
- EXCLUDE: Serviceadresse i tekniker-appen
- EXCLUDE: Lokal cache av Tripletex-prosjekter
