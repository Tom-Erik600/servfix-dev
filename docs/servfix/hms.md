# HMS Modul (SJA og ROS)

## Formål
HMS-modulen i ServFix håndterer Sikker Jobb Analyse (SJA) og Risikovurdering og Sårbarhetsanalyse (ROS). Modulen sikrer at lovpålagte HMS-krav etterleves ved å dokumentere risikoer og tiltak før og under utførelse av arbeidsoppdrag.

## Omfang
**Inkludert:**
- Opprettelse og administrasjon av SJA (tekniker-fokusert)
- Opprettelse og revisjon av ROS-analyser (admin/mal-fokusert)
- Automatisk kobling mellom SJA og relevante ROS-analyser basert på kategori
- Generering av profesjonelle PDF-dokumenter for både SJA og ROS
- Vedlegg av bilder og signaturer i SJA
- 5x5 risikomatrise med beregning av risikoreduksjon i ROS

**Ikke inkludert:**
- Generell HMS-håndbok (ligger utenfor fagsystemet)
- Avvikshåndtering (håndteres i ordregjennomføring)
- Integrasjon mot eksterne HMS-systemer

## Hovedregler
- Alle data er isolert per tenant via `db.getTenantConnection(tenantId)`.
- Tilgang krever gyldig sesjon som tekniker eller admin.
- PDF-generering bruker Puppeteer/Chromium og fungerer kun i GCP Cloud Run (feiler lokalt på Windows).
- En SJA kan enten være frittstående eller knyttet til en spesifikk ordre (`order_id`).
- ROS-analyser versjoneres automatisk ved hver oppdatering.

## Datamodeller

### hms_sja
Lagrer Sikker Jobb Analyse utført av teknikere.

| Felt | Type | Beskrivelse |
|------|------|-------------|
| `id` | SERIAL | Primærnøkkel |
| `order_id` | VARCHAR | Kobling til ordre (valgfri) |
| `technician_id` | VARCHAR | Teknikeren som utførte analysen |
| `job_description` | TEXT | Beskrivelse av arbeidet som skal gjøres |
| `location` | TEXT | Arbeidssted / adresse |
| `identified_risks` | TEXT | Identifiserte faremomenter |
| `safety_measures` | TEXT | Planlagte tiltak for å eliminere/redusere risiko |
| `approved_by` | TEXT | Navn på person som har godkjent SJA |
| `signature_data` | TEXT | Base64-kodet signatur |
| `status` | VARCHAR | `draft` eller `completed` |
| `category` | VARCHAR | Overordnet arbeidskategori (f.eks. "Arbeid i høyden") |
| `subcategory` | VARCHAR | Spesifisering av kategori |
| `ros_id` | INTEGER | FK til `hms_ros.id` (settes automatisk ved match på kategori) |
| `pdf_url` | TEXT | URL til generert PDF i Google Cloud Storage |
| `photos` | TEXT[] | Liste med URL-er til dokumentasjonsbilder |

### hms_ros
Lagrer Risikovurderinger (ofte brukt som maler eller for spesifikke prosjekttyper).

| Felt | Type | Beskrivelse |
|------|------|-------------|
| `id` | SERIAL | Primærnøkkel |
| `created_by` | VARCHAR | Bruker-ID som opprettet analysen |
| `title` | TEXT | Tittel på ROS-analysen |
| `project_type` | TEXT | Type prosjekt analysen gjelder for |
| `category` | VARCHAR | Arbeidskategori for kobling mot SJA |
| `form_data` | JSONB | Inneholder 5x5 matrise (s, k, s_rest, kr) og tekstfelter |
| `status` | VARCHAR | `draft` eller `completed` |
| `version` | INTEGER | Automatisk inkrementerende versjonsnummer |
| `pdf_url` | TEXT | URL til generert PDF i Google Cloud Storage |

## Status Lifecycle
Både SJA og ROS følger en enkel livssyklus:
1. **draft**: Dokumentet er under arbeid og kan redigeres fritt. PDF genereres ikke automatisk.
2. **completed**: Dokumentet er ferdigstilt. Dette låser normalt dataene og trigger mulighet for PDF-eksport.

## SJA↔ROS Auto-linking
Systemet har en automatisk koblingsmekanisme for å sikre at teknikere har tilgang til relevant risikovurdering:
- Når en SJA opprettes eller oppdateres med en `category`, søker systemet etter den nyeste `completed` ROS-analysen med samme kategori.
- Hvis match finnes, settes `ros_id` på SJA-en automatisk.
- Dette gjør at ROS-dokumentasjonen inkluderes som referanse for det utførte arbeidet.

## PDF-generering og Caching
PDF-håndteringen følger et "lazy loading" og caching-mønster:

- **Generering**: Utføres via `SjaPdfGenerator` og `RosPdfGenerator`. Bruker Puppeteer for å rendre HTML-maler til A4 PDF.
- **Caching**:
  - `GET /:id/pdf`: Returnerer eksisterende `pdf_url` hvis den finnes. Hvis ikke, genereres PDF-en, lagres i GCS, databasen oppdateres, og URL-en returneres.
  - `GET /:id/pdf/regenerate`: Sletter eksisterende `pdf_url` fra databasen og tvinger frem en ny generering av dokumentet. Dette er nødvendig hvis dataene har endret seg etter første generering.
- **Lagringsstruktur i GCS**:
  - SJA: `tenants/{tenantId}/hms/sja/{yyyy}/{mm}/sja_{id}_{timestamp}.pdf`
  - ROS: `tenants/{tenantId}/hms/ros/{yyyy}/{mm}/ros_{id}_{timestamp}.pdf`

## Begrensninger
- **Miljø**: PDF-generering krever Chromium installert i systemet (`/usr/bin/chromium`). Dette er konfigurert i Cloud Run, men mangler i standard Windows-utviklingsmiljø.
- **Bilder**: SJA-bilder inlines som base64 i PDF-en for å sikre at de vises korrekt uten eksterne avhengigheter ved visning.

## API Endepunkter

### SJA (Sikker Jobb Analyse)
| Metode | Sti | Beskrivelse |
|--------|-----|-------------|
| POST | `/api/hms/sja` | Opprett ny SJA. Utfører auto-linking mot ROS hvis kategori er med. |
| GET | `/api/hms/sja` | List alle SJA-er for tenanten. |
| GET | `/api/hms/sja/order/:orderId` | Hent alle SJA-er tilknyttet en spesifikk ordre. |
| GET | `/api/hms/sja/:id` | Hent detaljer for en spesifikk SJA. |
| DELETE | `/api/hms/sja/:id` | Slett en SJA. |
| GET | `/api/hms/sja/:id/pdf` | Hent PDF (genererer hvis mangler). |
| GET | `/api/hms/sja/:id/pdf/regenerate` | Tving regenerering av PDF. |

### ROS (Risikovurdering)
| Metode | Sti | Beskrivelse |
|--------|-----|-------------|
| POST | `/api/hms/ros` | Opprett ny ROS. |
| GET | `/api/hms/ros` | List alle ROS-analyser for tenanten. |
| GET | `/api/hms/ros/by-category/:category` | Finn nyeste fullførte ROS for en spesifikk kategori. |
| GET | `/api/hms/ros/:id` | Hent detaljer for en ROS. |
| PUT | `/api/hms/ros/:id` | Oppdater en ROS (øker versjonsnummer). |
| DELETE | `/api/hms/ros/:id` | Slett en ROS. |
| GET | `/api/hms/ros/:id/pdf` | Hent PDF (genererer hvis mangler). |
| GET | `/api/hms/ros/:id/pdf/regenerate` | Tving regenerering av PDF. |

## Integrasjon og Flyt
1. **Admin** oppretter ROS-analyser for ulike typer risikofylt arbeid (f.eks. "Arbeid i høyden", "Varme arbeider") og setter status til `completed`.
2. **Tekniker** starter et oppdrag og åpner `/app/sja.html`.
3. Tekniker velger kategori, og systemet henter automatisk relevante risikoer fra ROS-malen.
4. Tekniker fyller ut spesifikke risikoer for det aktuelle stedet, tar bilder, og signerer.
5. SJA settes til `completed`.
6. PDF genereres ved første visning og lagres som dokumentasjon på oppdraget.
