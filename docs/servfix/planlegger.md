# Planlegger

ServFix har to planlegger-grensesnitt: ett for admin og ett for teknikere. Admin-planleggeren er delt i tre hovedfaner: Enkel, Avansert og Periode. Hvilke faner som er tilgjengelige, og hvilken som åpnes som standard, styres per tenant fra Innstillinger.

---

## 1. Admin-planlegger

**URL:** `/admin/planlegger.html`
**Filer:**
- `public/admin/planlegger.html`
- `public/admin/assets/js/planlegger.js`
- `public/admin/assets/css/planlegger.css`
- `public/admin/innstillinger.html`

### Tre hovedfaner

Admin-planleggeren har en toppnavigasjon med disse fanene:

| Fane | Formål | Typisk bruk |
|------|--------|-------------|
| Enkel | Rask ordreopprettelse med drag & drop | Når admin kun trenger tekniker, kunde, dato, beskrivelse og valgte anlegg |
| Avansert | Full ordreopprettelse med prosjekt, cluster og detaljerte felt | Når oppdraget skal knyttes til prosjekt, serviceadresse, besøksnummer, kundenotat eller cluster |
| Periode | Opprette periodiske/gjentakende serviceordrer | Når samme service skal planlegges flere ganger over en dato-periode |

Toppfanelinjen vises bare når minst to faner er aktive. Hvis valgt standardfane er deaktivert, faller systemet tilbake til første aktive fane.

### Innstillinger for faner

Fanene konfigureres i Admin → Innstillinger → Planlegger:

- `show_pool_technician` viser/skjuler `Felles`-teknikerkortet
- `show_enkel_tab` viser/skjuler Enkel-fanen
- `show_avansert_tab` viser/skjuler Avansert-fanen
- `show_periode_tab` viser/skjuler Periode-fanen
- `default_tab` bestemmer hvilken fane som åpnes først

Verdiene lagres i tenantens GCS-baserte `settings.json` under `module_flags`. Eksisterende tenants migreres med `show_avansert_tab = true` og `default_tab = 'avansert'`.

### Felles-tekniker / pool

Hvis `show_pool_technician = true`, vises et ekstra teknikerkort kalt `Felles` i tekniker-kolonnen. Når admin drar `Felles` til en kunde, opprettes ordren uten tekniker (`technician_id = null`) og status `pending`. Slike ordre vises som ledige oppdrag i tekniker-appen, der teknikere kan plukke dem selv.

I tekniker-appen hentes ledige oppdrag fra `GET /api/orders/available?range=today|tomorrow|week|month`. Tekniker plukker et oppdrag med `POST /api/orders/:id/claim`. Claim-operasjonen er atomisk: backend oppdaterer bare raden hvis `technician_id IS NULL`, og returnerer `409` hvis en annen tekniker allerede har tatt oppdraget.

---

## 2. Enkel-fanen

### Konsept: Forenklet Drag & Drop

Enkel-fanen er laget for rask ordreopprettelse med minst mulig felt. Den har et to-kolonners oppsett:

| Venstre kolonne | Høyre kolonne |
|---|---|
| Teknikere, som draggbare kort | Kunder, som drop-targets |

**Arbeidsflyt:**
1. Admin drar et teknikerkort og slipper det på et kundekort.
2. En forenklet modal åpnes med kundeinfo, datovalg, fritekstbeskrivelse og anleggsliste.
3. Admin velger ønskede anlegg i en flat liste.
4. Admin bekrefter, og ordren opprettes via `POST /api/admin/orders`.

### Forenklet modal

Enkel-modalen har bevisst færre valg enn Avansert:

| Felt | Påkrevd | Merknad |
|------|---------|---------|
| Dato | Ja | Minimumsdato settes fra lokal nettleserdato |
| Beskrivelse | Ja | Fritekst, ingen Tripletex-prosjektdropdown |
| Anlegg | Nei | Flat checkbox-liste, alle forhåndsvalgt |

Enkel-modus viser ikke cluster-gruppering, cluster-admin, prosjektforslag, besøksnummer, serviceadresse eller kundenotat. `handleDrop()` sender `simple: true` videre til modal-logikken, og `renderEquipmentListSimple()` rendrer anleggene som en flat liste.

---

## 3. Avansert-fanen

### Konsept: Drag & Drop + prosjektoppslag

Avansert-fanen er den fulle admin-planleggeren. Den har et to-kolonners oppsett:

| Venstre kolonne | Høyre kolonne |
|---|---|
| Teknikere, som draggbare kort | Kunder / Prosjekter, som drop-targets |

**Arbeidsflyt:**
1. Admin drar et teknikerkort og slipper det på et kundekort eller prosjektkort.
2. En modal åpnes med kundeinfo, dato, beskrivelse/prosjekt, anleggsvalg, cluster-funksjoner og ekstra ordrefelt.
3. Admin bekrefter, og ordren opprettes via `POST /api/admin/orders`.

### Kunder og prosjekter

- Kunde-fanen viser alle aktive kunder.
- Prosjekt-fanen gjør live-søk mot Tripletex på prosjektnavn eller prosjektnummer med 500ms debounce.
- Ved bytte til prosjekt-fanen settes fokus automatisk i prosjektsøket.
- Kundesøket filtrerer kundekort på kundenavn eller kundenummer med 300ms debounce.
- Når admin slipper en tekniker på et prosjektkort, brukes prosjektets kunde som mottaker og prosjektnavnet foreslås som ordrebeskrivelse.

### Felter i avansert modal

| Felt | Påkrevd | Lagres som |
|------|---------|------------|
| Dato | Ja | `scheduled_date` |
| Prosjekt / Beskrivelse | Ja | `description` + evt. `customer_data.agreement_number` |
| Besøksnr | Nei | `customer_data.visit_number` |
| Serviceadresse | Nei | `service_address_street/postal_code/city` |
| Anleggsvalg | Nei | `included_equipment_ids` |
| Kundenotat | Nei | `customers.notes` (lagres separat) |

**Avtalenummer (`agreement_number`):** Settes automatisk når admin velger et Tripletex-prosjekt fra dropdown. Hentes fra `data-project-number` på valgt `<option>` og lagres i `customer_data.agreement_number`. Settes ikke ved fritekstbeskrivelse.

**Besøksnummer (`visit_number`):** Valgfritt fritekstfelt. Lagres i `customer_data.visit_number` og vises i rapporter via rediger PDF-modalen.

### Cluster i avansert modal

- Cluster er kundespesifikke (`equipment_clusters.customer_id`).
- Anlegg hentes med `clusterId` og `clusterName` fra `GET /api/admin/equipment?customerId={id}`.
- Hvert cluster vises som egen gruppe i modalen.
- Cluster-headeren har egen checkbox som velger/fjerner alle anlegg i clusteret.
- `+ Nytt cluster` oppretter et nytt cluster, men flytter ingen anlegg automatisk.
- `Flytt til cluster` flytter valgte anlegg til et eksisterende cluster eller oppretter et nytt først.
- Anlegg kan tas ut av cluster direkte i modalen med en liten `-`-knapp på anleggskortet.
- Fullere cluster-vedlikehold skjer fra kundesiden (`/admin/kunder.html`).
- Tomme cluster er gyldige og vises i kundebildet med `0 anlegg`.

### Nytt anlegg fra modal

Admin kan opprette nytt anlegg direkte fra avansert modal:
1. Klikk `Opprett nytt anlegg`.
2. Velg anleggstype fra `GET /api/admin/checklist-templates` (`facilityTypes`).
3. Fyll ut systemnummer, systemnavn, plassering, betjener og intern kommentar.
4. `POST /api/admin/equipment` oppretter anlegget.
5. Anleggslisten refreshes automatisk.
6. Nytt anlegg kan flyttes inn i et cluster fra samme modal.

---

## 4. Periode-fanen

### Konsept: Periodeplaner og generering av ordre

Periode-fanen brukes til gjentakende service. Admin oppretter en regel for kunde, tekniker, anlegg, frekvens og dato-intervall. Regelen kan forhåndsvises før den genererer faktiske ordrer.

**Arbeidsflyt:**
1. Velg kunde og eventuell tekniker.
2. Fyll ut tjenestetype, beskrivelse og eventuelt serviceadresse.
3. Velg anlegg fra kundens aktive anlegg.
4. Velg frekvens, startdato, sluttdato og eventuelt klokkeslett.
5. Klikk `Forhåndsvis` for å se hvilke datoer/ordrer som vil bli opprettet.
6. Klikk `Lagre regel` for å lagre regelen uten å generere ordre, eller `Generer ordre` for å opprette ordre for perioden.

### Frekvensvalg

Periode-fanen støtter faste intervaller og et egendefinert dagintervall. Egendefinert intervall bruker feltet `frequency_value`, for eksempel 14 dager mellom hvert oppdrag.

### API-flyt

```
GET    /api/admin/recurring-orders                 (hent eksisterende regler)
POST   /api/admin/recurring-orders                 (opprett regel)
GET    /api/admin/recurring-orders/:id             (hent regel)
PUT    /api/admin/recurring-orders/:id             (oppdater regel)
DELETE /api/admin/recurring-orders/:id             (slett regel)
POST   /api/admin/recurring-orders/:id/preview     (forhåndsvis genererte ordre)
POST   /api/admin/recurring-orders/:id/generate    (generer faktiske ordre)
```

### Viktige detaljer

- Regler vises i en egen liste i Periode-fanen.
- En regel kan kopieres til nytt skjema for ny periode.
- Når ordre er generert, markeres regelen som generert.
- `technician_id` lagres som tekst (`VARCHAR`), ikke tall.
- Periode-fanen eier sin egen state og initialiseres først når fanen åpnes.

---

## 5. Service-oversikt

Knappen `Service-oversikt` åpner en oversiktsmodal med:

- Statistikk: totalt antall oppdrag, kunder og teknikere i perioden
- Periode-navigasjon: 6 måneder om gangen, fremover/bakover
- Kundevisning: månedskort med oppdrag sortert per dato, med fargekodede tekniker-badges
- Teknikervisning: gruppert per tekniker med alle oppdrag sortert etter dato

**Datakilder:**
```
GET /api/admin/orders?dateFrom={start}&dateTo={end}
GET /api/admin/technicians
```

---

## 6. Dataflyt i admin-planlegger

```
1. fetchData() henter parallelt:
   - GET /api/admin/technicians
   - GET /api/admin/customers
   - GET /api/admin/orders?status=pending,scheduled,in_progress

2. Top-tab setup:
   - Leser tenantFlags/module_flags
   - Viser aktive faner
   - Velger default_tab eller første aktive fane
   - Viser/skjuler Felles-kortet basert på show_pool_technician

3. Enkel/Avansert drop:
   - handleDrop() finner tekniker + kunde
   - showModalWithEquipment(..., { simple }) åpner riktig modalvariant
   - GET /api/admin/equipment?customerId={id}

4. Avansert ekstra data:
   - GET /api/admin/customers/{id}/projects
   - GET /api/admin/clusters?customerId={id}
   - POST /api/admin/clusters
   - POST /api/admin/equipment/assign-cluster

5. Ordreopprettelse:
   - GET /api/admin/customers/{id}/addresses
   - GET /api/admin/customers/{id}/servfixmail
   - POST /api/admin/orders
   - PUT /api/admin/customers/{id}/notes (avansert)
```

---

## 7. Tekniker-planlegger

**URL:** `/app/planlegg.html`
**Filer:**
- `public/app/planlegg.html`
- `public/app/assets/js/planlegg.js`

### Konsept: Søk & Opprett

Teknikeren bruker et enklere grensesnitt uten drag & drop:

1. Søk etter kunde på navn eller kundenummer via `GET /api/customers`.
2. Velg kunde fra dropdown-resultater.
3. Kundeinfo vises.
4. Fyll ut anlegg, beskrivelse/prosjekt, besøksnummer, serviceadresse, kundenotat og dato.
5. `POST /api/orders` oppretter ordren.
6. Etter opprettelse spør UI om teknikeren vil planlegge flere.

Tekniker-planleggeren støtter cluster-gruppert anleggsvalg, nytt anlegg, kundenotat, Tripletex-prosjektforslag og hurtigvalg for dato.

### State management

```javascript
state = {
    allCustomers: [],
    selectedCustomer: null,
    customerEquipment: [],
    selectedEquipmentIds: [],
    scheduledDate: null,
    searchTimeout: null,
    isLoading: false
}
```

### Validering

Opprett-knappen er deaktivert til:

- Kunde er valgt (`selectedCustomer !== null`)
- Dato er satt (`scheduledDate !== null`)
- Beskrivelse er fylt ut

---

## 8. Forskjeller admin vs. tekniker

| Funksjon | Admin | Tekniker |
|---|---|---|
| Primær interaksjon | Drag & drop eller periodeplan | Søk -> velg kunde |
| Teknikertildeling | Velges via drag eller felt i Periode | Automatisk innlogget tekniker |
| Enkel ordreopprettelse | Ja, Enkel-fane | Ja, eget planlegg-skjema |
| Avansert ordreopprettelse | Ja, Avansert-fane | Delvis |
| Periodiske ordre | Ja, Periode-fane | Nei |
| Prosjektfaner | Ja, egen prosjektfane i Avansert | Nei |
| Prosjektforslag | Ja, i Avansert | Ja |
| Avtalenummer | Ja, ved Tripletex-prosjekt | Ja, ved Tripletex-prosjekt |
| Besøksnummer | Ja, i Avansert | Ja |
| Serviceadresse | Ja, i Avansert og Periode | Ja |
| Cluster-admin | Ja, i Avansert | Ja |
| Enkel flat anleggsliste | Ja, i Enkel | Nei |
| Hurtigvalg dato | Nei | Ja |
| Service-oversikt | Ja | Nei |
| API-prefix | `/api/admin/*` | `/api/*` |

---

## 9. Viktige detaljer

- Admin-fanene styres av GCS-baserte `module_flags`, ikke PostgreSQL.
- `Felles`-tekniker betyr at ordren opprettes uten tekniker og kan plukkes i tekniker-appen.
- `technicians.id` er `VARCHAR`; JavaScript og API-kode skal bruke `String()` og ikke `parseInt()` for tekniker-ID.
- Flere aktive kunder kan vises samtidig i admin-planleggeren.
- Ved ordreopprettelse lagres kundedata som snapshot i `customer_data`.
- Admin-planleggeren bruker `servfixmail`-kontaktens e-post ved kundesnapshot der dette finnes.
- I admin-modalen er anlegg forhåndsvalgt; i tekniker-appen må tekniker selv velge.
- Ordren lagrer `included_equipment_ids`; cluster brukes bare for gruppering og valg i opprettelsesøyeblikket.
- Fritekstbeskrivelse setter ikke `agreement_number`; bare valgt Tripletex-prosjekt gjør det.
- `visit_number` er valgfritt og lagres bare når feltet er fylt ut.
