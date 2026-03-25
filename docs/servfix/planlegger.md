# Planlegger (Visuell Planlegger)

ServFix har to planlegger-grensesnitt: ett for admin og ett for teknikere. Begge brukes til å opprette planlagte serviceoppdrag, men med ulike arbeidsflyter.

---

## 1. Admin-planlegger

**URL:** `/admin/planlegger.html`
**Filer:**
- `public/admin/planlegger.html`
- `public/admin/assets/js/planlegger.js`
- `public/admin/assets/css/planlegger.css`

### Konsept: Drag & Drop

Admin-planleggeren har et to-kolonners oppsett:

| Venstre kolonne | Høyre kolonne |
|---|---|
| **Teknikere** (draggbare kort) | **Kunder** (drop-targets) |

**Arbeidsflyt:**
1. Admin drar et teknikerkort og slipper det på et kundekort
2. En modal åpnes med:
   - Kundeinfo (kontakt, e-post, telefon)
   - Datovalg (minimumsdato = i dag)
   - Beskrivelse (dropdown med prosjektforslag fra Tripletex, eller fritekst)
   - Anleggsliste (checkbox-liste, alle forhåndsvalgt)
   - Mulighet til å opprette nytt anlegg
   - Kundenotat-felt
3. Admin bekrefter, og oppdraget opprettes via `POST /api/admin/orders`

### Kundefiltrering

- **Standard:** Viser kun kunder uten aktive oppdrag (maks 1 aktivt oppdrag per kunde)
- **Checkbox "Vis alle":** Viser også kunder som allerede har oppdrag
- **Søkefelt:** Filtrerer kundekort på kundenavn eller kundenummer (debounce 300ms)

### Dataflyt ved opprettelse

```
1. fetchData() henter parallelt:
   - GET /api/admin/technicians
   - GET /api/admin/customers
   - GET /api/admin/orders?status=pending,scheduled,in_progress

2. Ved drop -> showModalWithEquipment():
   - GET /api/admin/equipment?customerId={id}          (anlegg for kunden)
   - GET /api/admin/customers/{id}/projects             (prosjektforslag)

3. Ved opprettelse -> saveOrderWithEquipment():
   - GET /api/admin/customers/{id}/addresses            (fysisk/postadr.)
   - GET /api/admin/customers/{id}/servfixmail           (servfixmail-kontakt)
   - POST /api/admin/orders                             (opprett ordren)
   - PUT /api/admin/customers/{id}/notes                (lagre kundenotat)
```

### Nytt anlegg fra modal

Admin kan opprette nytt anlegg direkte fra opprettelsesmodalen:
1. Klikk "Opprett nytt anlegg"
2. Velg anleggstype (hentes fra `GET /api/admin/checklist-templates` -> `facilityTypes`)
3. Fyll ut: systemnummer, systemnavn, plassering, betjener, intern kommentar
4. `POST /api/admin/equipment` oppretter anlegget
5. Anleggslisten refreshes automatisk

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
   - **Anlegg:** Checkbox-liste med kundens anlegg (valgfritt), mulighet for nytt anlegg
   - **Kundenotat:** Internt notat (vises ikke på rapport)
   - **Beskrivelse:** Fritekst, forhåndsutfylt med "Service hos {kundenavn}"
   - **Dato:** Hurtigvalg (1 uke, 1/3/6 mnd) eller manuelt datovalg
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
```

---

## Forskjeller admin vs. tekniker

| Funksjon | Admin | Tekniker |
|---|---|---|
| Interaksjon | Drag & drop tekniker -> kunde | Søk -> velg kunde |
| Teknikertildeling | Velges via drag | Automatisk (innlogget tekniker) |
| Kundefilter | Skjuler kunder med aktive oppdrag | Viser alle kunder |
| Prosjektforslag | Ja (fra Tripletex) | Nei (kun fritekst) |
| Hurtigvalg dato | Nei (kun datepicker) | Ja (1 uke, 1/3/6 mnd) |
| Service-oversikt | Ja (6-mnd kalender/teknikervisning) | Nei |
| Anleggsopprettelse | Ja (inline i modal) | Ja (inline i skjema) |
| API-prefix | `/api/admin/*` | `/api/*` |

---

## Viktige detaljer

- **Maks 1 aktivt oppdrag per kunde** — admin-planleggeren filtrerer bort kunder med `pending`, `scheduled` eller `in_progress` status som standard
- **Customer-data snapshot** — ved opprettelse lagres et snapshot av kundedata (adresse, kontakt, e-post) på ordren for historikk
- **ServfixMail** — admin-planleggeren henter spesifikt `servfixmail`-kontaktens e-post, ikke kundens generelle e-post
- **Anlegg forhåndsvalgt** — i admin-modalen er alle anlegg automatisk avkrysset; teknikeren må selv velge
- **Søk med debounce** — begge bruker 300ms debounce på søkeinput
