# Planlegger (Visuell Planlegger)

ServFix har to planlegger-grensesnitt: ett for admin og ett for teknikere. Begge brukes til å opprette planlagte serviceoppdrag, men med ulike arbeidsflyter.

---

## 1. Admin-planlegger

**URL:** `/admin/planlegger.html`
**Filer:**
- `public/admin/planlegger.html`
- `public/admin/assets/js/planlegger.js`
- `public/admin/assets/css/planlegger.css`

### Konsept: Drag & Drop + prosjektoppslag

Admin-planleggeren har et to-kolonners oppsett:

| Venstre kolonne | Høyre kolonne |
|---|---|
| **Teknikere** (draggbare kort) | **Kunder / Prosjekter** (drop-targets) |

**Arbeidsflyt:**
1. Admin drar et teknikerkort og slipper det på et kundekort
2. En modal åpnes med:
   - Kundeinfo (kontakt, e-post, telefon)
   - Datovalg (minimumsdato = lokal dato i nettleseren, ikke UTC)
   - Beskrivelse (dropdown med prosjektforslag fra Tripletex, eller fritekst)
   - Anleggsliste (checkbox-liste, alle forhåndsvalgt)
   - Cluster-gruppering av anlegg per kunde
   - Detaljert anleggsvisning med systemnavn, systemtype, systemnummer, plassering og betjener
   - Batch-knapper for `+ Marker alle`, `- Fjern markering alle`, `+ Nytt cluster`, `Flytt til cluster`
   - Mulighet til å opprette nytt anlegg
   - Kundenotat-felt
3. Admin bekrefter, og oppdraget opprettes via `POST /api/admin/orders`

### Kunder og prosjekter

- **Kunde-fane:** Viser alle aktive kunder
- **Prosjekt-fane:** Live-søk mot Tripletex på prosjektnavn eller prosjektnummer (debounce 500ms)
- **Autofokus:** Ved bytte til prosjekt-fanen settes fokus automatisk i prosjektsøket
- **Søkefelt:** Filtrerer kundekort på kundenavn eller kundenummer (debounce 300ms)
- **Prosjektdropp:** Når admin slipper en tekniker på et prosjektkort brukes prosjektets kunde som mottaker, og prosjektnavnet foreslås som beskrivelse i ordren

### Cluster i modal

- Cluster er kundespesifikke (`equipment_clusters.customer_id`)
- Anlegg hentes med `clusterId` og `clusterName` fra `GET /api/admin/equipment?customerId={id}`
- Hvert cluster vises som egen gruppe i modalen
- Cluster-headeren har en egen checkbox som velger/fjerner alle anlegg i clusteret for ordren
- `+ Nytt cluster` oppretter kun et nytt cluster; det flytter ingen anlegg automatisk
- `Flytt til cluster` flytter valgte anlegg til et eksisterende cluster eller oppretter et nytt først
- Anlegg kan tas ut av cluster direkte i modalen med en liten `-`-knapp nederst til høyre på hvert anleggskort
- Å ta anlegg ut av cluster gjøres eksplisitt per anlegg, ikke som batch-operasjon
- Fullere vedlikehold av cluster per kunde skjer også fra kundesiden (`/admin/kunder.html`) der anlegg vises gruppert per cluster, kan batch-markeres og flyttes, og tomme cluster kan slettes
- Tomme cluster er gyldige og vises i kundebildet med `0 anlegg`

### Felter i opprettelsesmodalen

| Felt | Påkrevd | Lagres som |
|------|---------|------------|
| Dato | Ja | `scheduled_date` |
| Prosjekt / Beskrivelse | Ja | `description` + evt. `customer_data.agreement_number` |
| Besøksnr | Nei | `customer_data.visit_number` |
| Serviceadresse | Nei | `service_address_street/postal_code/city` |
| Anleggsvalg | Nei | `included_equipment_ids` |
| Kundenotat | Nei | `customers.notes` (lagres separat) |

**Avtalenummer (agreement_number):** Settes automatisk når admin velger et Tripletex-prosjekt fra dropdown. Hentes fra `data-project-number`-attributten på det valgte `<option>`-elementet og lagres i `customer_data.agreement_number`. Settes **ikke** ved fritekst-beskrivelse.

**Besøksnummer (visit_number):** Valgfritt fritekstfelt. Lagres i `customer_data.visit_number` i JSONB-feltet på ordren. Vises i rapporter via "rediger PDF"-modalen.

### Dataflyt ved opprettelse

```
1. fetchData() henter parallelt:
   - GET /api/admin/technicians
   - GET /api/admin/customers
   - GET /api/admin/orders?status=pending,scheduled,in_progress

2. Ved drop -> showModalWithEquipment():
    - GET /api/admin/equipment?customerId={id}          (anlegg for kunden)
    - GET /api/admin/customers/{id}/projects             (prosjektforslag)
    - GET /api/admin/clusters?customerId={id}            (cluster for kunde, ved cluster-flyt)

2b. Ved cluster-administrasjon i modal:
    - POST /api/admin/clusters                           (opprett nytt cluster)
    - POST /api/admin/equipment/assign-cluster          (batch-knytt valgte anlegg til cluster)

3. Ved opprettelse -> saveOrderWithEquipment():
    - GET /api/admin/customers/{id}/addresses            (fysisk/postadr.)
    - GET /api/admin/customers/{id}/servfixmail           (servfixmail-kontakt)
    - POST /api/admin/orders                             (opprett ordren)
    - PUT /api/admin/customers/{id}/notes                (lagre kundenotat)
    - UI viser loading-overlay/spinner mens oppdraget opprettes
```

### Nytt anlegg fra modal

Admin kan opprette nytt anlegg direkte fra opprettelsesmodalen:
1. Klikk "Opprett nytt anlegg"
2. Velg anleggstype (hentes fra `GET /api/admin/checklist-templates` -> `facilityTypes`)
3. Fyll ut: systemnummer, systemnavn, plassering, betjener, intern kommentar
4. `POST /api/admin/equipment` oppretter anlegget
5. Anleggslisten refreshes automatisk
6. Nytt anlegg kan deretter flyttes inn i et cluster fra samme modal

### Service-oversikt modal

Knappen "Service-oversikt" oppe til høyre åpner en oversiktsmodal med:

- **Statistikk:** Totalt antall oppdrag, kunder og teknikere i perioden
- **Periode-navigasjon:** 6 måneder om gangen, fremover/bakover
- **To visninger:**
  - **Kundevisning (kalender):** Månedskort med oppdrag sortert per dato, fargekodede tekniker-badges
  - **Teknikervisning:** Gruppert per tekniker med alle deres oppdrag, sortert etter dato

**Datakilder for oversikt:**
```
GET /api/admin/orders?dateFrom={start}&dateTo={end}
GET /api/admin/technicians
```

---

## 2. Tekniker-planlegger

**URL:** `/app/planlegg.html`
**Filer:**
- `public/app/planlegg.html`
- `public/app/assets/js/planlegg.js`

### Konsept: Søk & Opprett

Teknikeren bruker et enklere grensesnitt uten drag & drop:

**Arbeidsflyt:**
1. Søk etter kunde (navn eller kundenummer) - kundene hentes fra Tripletex via `GET /api/customers`
2. Velg kunde fra dropdown-resultater
3. Kundeinfo vises (kundenr, firmanavn, adresse, telefon, kontaktperson, e-post)
4. Oppdragsdetaljer fylles ut:
   - **Anlegg:** Checkbox-liste med kundens anlegg (valgfritt), gruppert per cluster når cluster finnes
   - **Cluster-valg:** Cluster-header kan krysses av for å velge alle anlegg i gruppen
   - **Detaljvisning:** systemnavn, systemtype, systemnummer, plassering og betjener vises på hvert anlegg
   - **Hurtigvalg:** `+ Marker alle` og `- Fjern markering alle`
   - **Nytt anlegg:** Mulighet for nytt anlegg
   - **Kundenotat:** Internt notat (vises ikke på rapport)
   - **Beskrivelse:** Fritekst, forhåndsutfylt med "Service hos {kundenavn}"
   - **Dato:** Hurtigvalg (1 uke, 1/3/6 mnd) eller manuelt datovalg, med lokal min-dato
5. "Planlegg oppdrag"-knapp sender `POST /api/orders`
6. Etter opprettelse: "Vil du planlegge flere?" (Ja = reset form, Nei = tilbake til hovedmeny)

### State management

```javascript
state = {
    allCustomers: [],           // Alle kunder fra Tripletex
    selectedCustomer: null,     // Valgt kunde-objekt
    customerEquipment: [],      // Anlegg for valgt kunde
    selectedEquipmentIds: [],   // Valgte anlegg-IDer
    scheduledDate: null,        // Valgt dato (YYYY-MM-DD)
    searchTimeout: null,        // Debounce-timer for søk
    isLoading: false            // Loading-tilstand
}
```

### Validering

Opprett-knappen er deaktivert til:
- Kunde er valgt (`selectedCustomer !== null`)
- Dato er satt (`scheduledDate !== null`)
- Beskrivelse er fylt ut (`.length > 0`)

### Dataflyt

```
1. Ved init:
   - GET /api/customers                        (alle kunder fra Tripletex)

2. Ved kundevalg:
   - GET /api/equipment?customerId={id}        (kundens anlegg)

3. Ved opprettelse:
    - POST /api/orders                          (opprett ordren)
    - PUT /api/customers/{id}/notes             (lagre kundenotat)
    - UI viser loading-overlay/spinner mens oppdraget opprettes
```

---

## Forskjeller admin vs. tekniker

| Funksjon | Admin | Tekniker |
|---|---|---|
| Interaksjon | Drag & drop tekniker -> kunde | Søk -> velg kunde |
| Teknikertildeling | Velges via drag | Automatisk (innlogget tekniker) |
| Kundefilter | Viser alle aktive kunder | Viser alle kunder |
| Prosjektfaner | Ja, egen prosjektfane mot Tripletex | Nei |
| Prosjektforslag | Ja (fra Tripletex) | Nei (kun fritekst) |
| Avtalenummer | Ja (settes automatisk fra Tripletex-prosjekt) | Nei |
| Besøksnummer | Ja (valgfritt felt i modal) | Nei |
| Cluster i ordreopprettelse | Ja, gruppering og enkel cluster-adm. | Nei |
| Cluster-bruk i anleggsvalg | Ja | Ja, kun gruppering og valg |
| Hurtigvalg dato | Nei (kun datepicker) | Ja (1 uke, 1/3/6 mnd) |
| Service-oversikt | Ja (6-mnd kalender/teknikervisning) | Nei |
| Anleggsopprettelse | Ja (inline i modal) | Ja (inline i skjema) |
| API-prefix | `/api/admin/*` | `/api/*` |

---

## Viktige detaljer

- **Flere aktive kunder synlige** — admin-planleggeren viser alle aktive kunder selv om de allerede har oppdrag
- **Customer-data snapshot** — ved opprettelse lagres et snapshot av kundedata (adresse, kontakt, e-post) på ordren for historikk
- **ServfixMail** — admin-planleggeren henter spesifikt `servfixmail`-kontaktens e-post, ikke kundens generelle e-post
- **Anlegg forhåndsvalgt** — i admin-modalen er alle anlegg automatisk avkrysset; teknikeren må selv velge
- **Cluster er kundespesifikke** — samme clusternavn kan eksistere på flere kunder, men ikke to ganger på samme kunde
- **Ordre bruker utvalg, ikke cluster-link** — ordren lagrer kun `included_equipment_ids`; cluster brukes bare for gruppering og valg i opprettelsesøyeblikket
- **Tomme cluster kan eksistere** — de kan opprettes uten anlegg, men slettes bare når de faktisk er tomme
- **Kundesiden er hovedsted for cluster-vedlikehold** — der vises alle cluster, også tomme, som kollapsede seksjoner med `Øvrige` nederst
- **Søk med debounce** — begge bruker 300ms debounce på søkeinput
- **agreement_number settes kun ved prosjektvalg** — fritekstbeskrivelse gir ikke avtalenummer; kun Tripletex-prosjekter setter dette feltet
- **visit_number er valgfritt** — tomt felt = ingen `visit_number` i `customer_data`; feltet er kun synlig i admin-modalen, ikke i tekniker-appen
