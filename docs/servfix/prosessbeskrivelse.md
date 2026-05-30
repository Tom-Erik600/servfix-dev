# ServFix — Komplett Prosessbeskrivelse

> Sist oppdatert: 2026-05-09  
> Formål: Brukes til akseptansetesting, reklamemateriell, salgspresentasjoner og prosessdokumentasjon.

---

## Innholdsfortegnelse

1. [Systemoversikt](#1-systemoversikt)
2. [Roller og tilgang](#2-roller-og-tilgang)
3. [Hovedprosess: Serviceoppdrag fra A til Z](#3-hovedprosess-serviceoppdrag-fra-a-til-z)
4. [Sideprosesser og spesialcaser](#4-sideprosesser-og-spesialcaser)
5. [HMS-prosesser (SJA og ROS)](#5-hms-prosesser-sja-og-ros)
6. [Kundeadministrasjon](#6-kundeadministrasjon)
7. [Tripletex-integrasjon](#7-tripletex-integrasjon)
8. [PDF-generering og rapportering](#8-pdf-generering-og-rapportering)
9. [E-post og kundeleveranse](#9-e-post-og-kundeleveranse)
10. [Utstyr og anlegg](#10-utstyr-og-anlegg)
11. [Tilbudshåndtering](#11-tilbudshåndtering)
12. [Fakturering og oppfølging](#12-fakturering-og-oppfølging)
13. [Innstillinger og tilpasning](#13-innstillinger-og-tilpasning)
14. [Ordretyper og opprettelsesflyter](#14-ordretyper-og-opprettelsesflyter)
15. [Statusflyter og tilstandsdiagrammer](#15-statusflyter-og-tilstandsdiagrammer)
16. [Vedlegg: Akseptansetestcaser](#16-vedlegg-akseptansetestcaser)

---

## 1. Systemoversikt

ServFix er et skybasert (Google Cloud Run) serviceadministrasjonssystem for bedrifter som utfører teknisk service på ventilasjonsanlegg, kjøleanlegg og lignende utstyr. Systemet dekker hele livssyklusen til et serviceoppdrag — fra planlegging til ferdigstilt rapport og fakturering.

### Nøkkelegenskaper

| Egenskap | Beskrivelse |
|----------|-------------|
| **Multi-tenant** | Hver kunde/bedrift har egen isolert database. Ingen data deles mellom tenants |
| **To grensesnitt** | Tekniker-app (mobilvennlig) og Admin-panel (desktop) |
| **Integrasjoner** | Tripletex (kundedata), Google Cloud Storage (bilder/PDF), E-post (rapporter/tilbud) |
| **PDF-rapporter** | Automatisk generert fra sjekklister, bilder og avvik via Puppeteer |
| **HMS** | Sikker Jobb Analyse (SJA) og Risiko- og Sårbarhetsanalyse (ROS) |

### Systemarkitektur (forenklet)

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Tekniker-app   │────▶│   Node.js API    │────▶│  PostgreSQL DB  │
│  (mobil/nett)   │     │   (Express)      │     │  (per tenant)   │
└─────────────────┘     └──────┬───────────┘     └─────────────────┘
                               │
┌─────────────────┐            │        ┌─────────────────────┐
│  Admin-panel    │────────────┘   ┌───▶│  Google Cloud       │
│  (desktop/nett) │                │    │  Storage (bilder,   │
└─────────────────┘                │    │  PDF, innstillinger)│
                                   │    └─────────────────────┘
                    ┌──────────────┤
                    │              │    ┌─────────────────────┐
                    │  Puppeteer   │───▶│  Tripletex API      │
                    │  (PDF-gen)   │    │  (kundeimport)      │
                    └──────────────┘    └─────────────────────┘
```

### Runtime entrypoint

Cloud Run bygger fra `Dockerfile` og starter `server.js`. Det finnes også en `src/app.js` entrypoint i kodebasen. Når nye ruter eller middleware legges til, må de enten monteres begge steder eller entrypoint-strukturen ryddes opp slik at det bare finnes én kilde. Hvis en rute virker lokalt men ikke i deployet miljø, er dette et av de første punktene som bør sjekkes.

---

## 2. Roller og tilgang

### 2.1 Tekniker (feltarbeider)

**Innlogging:** Velger sitt navn fra nedtrekksliste, skriver inn passord.  
**Tilgang:** Kun egne tildelte ordrer, pluss mulighet til å søke og overta andres ordrer.

| Funksjon | Beskrivelse |
|----------|-------------|
| Se planlagte servicer | Kalendervisning (uke/måned) med egne tildelte ordrer |
| Utføre service | Åpne sjekkliste per anlegg, fylle ut punkter, ta bilder, registrere avvik |
| Ferdigstille anlegg | Markere hvert anlegg som ferdig, lagre signatur |
| Ferdigstille ordre | Markere hele ordren som fullført — trigger PDF-generering |
| Opprette hasteordre | Rask opprettelse av akutt serviceoppdrag |
| Planlegge oppdrag | Opprette planlagt service for en kunde med dato og utstyr |
| Ledige oppdrag | Se og plukke ordre som admin har lagt i Felles/pool uten tekniker |
| Søke og overta ordrer | Finne og overta ordrer fra andre teknikere |
| SJA | Opprette Sikker Jobb Analyse knyttet til en ordre |
| Tilbud | Opprette tilbud med timer og produkter knyttet til ordre |

### 2.2 Administrator (daglig leder / kontoransatt)

**Innlogging:** E-post og passord.  
**Tilgang:** Alle ordrer, alle kunder, alle teknikere, rapporter, tilbud, HMS, innstillinger.

| Funksjon | Beskrivelse |
|----------|-------------|
| Dashboard | KPI-oversikt: dagens ordrer, fullførte denne uken, rapporter ikke sendt, tilbud ventende, venter på fakturering |
| Planlegger | Enkel, avansert og periodisk planlegging av serviceoppdrag |
| Kundeadministrasjon | Se/redigere kunder, utstyr, kontakter. Import fra Tripletex |
| Teknikeradministrasjon | Opprette, redigere, deaktivere teknikere |
| Rapporter | Se, generere, sende PDF-rapporter til kunder |
| Tilbud | Se, redigere, sende tilbud til kunder |
| HMS | Se og administrere SJA- og ROS-analyser |
| Innstillinger | Firmainfo, logo, rapportfarger, HMS-innstillinger, app-meny og planleggerfaner |

### 2.3 Kunde (ekstern mottaker)

Kunder har **ikke** egen innlogging i systemet. De mottar:
- Servicerapporter på e-post (PDF-vedlegg)
- Tilbud på e-post (PDF-vedlegg)
- Rapportmottaker styres av `is_report_recipient`-flagg på kundekontakter

---

## 3. Hovedprosess: Serviceoppdrag fra A til Z

Dette er den primære arbeidsflyten i ServFix — fra en kunde trenger service til rapporten er levert og fakturert.

### Trinn-for-trinn

```
┌──────────────────────────────────────────────────────────────────┐
│                    HOVEDPROSESS — OVERSIKT                        │
│                                                                  │
│  1. PLANLEGGING      Administrator tildeler tekniker til kunde   │
│         │                                                        │
│         ▼                                                        │
│  2. TILDELING        Tekniker ser ordren i sin kalender          │
│         │                                                        │
│         ▼                                                        │
│  3. FORBEREDELSE     Tekniker gjennomgår ordreinformasjon        │
│         │            (evt. oppretter SJA for HMS)                │
│         ▼                                                        │
│  4. UTFØRELSE        Tekniker drar ut og gjennomfører service    │
│         │            — sjekklister, bilder, avvik                │
│         ▼                                                        │
│  5. FERDIGSTILLING   Tekniker ferdigstiller hvert anlegg,        │
│         │            deretter hele ordren                         │
│         ▼                                                        │
│  6. PDF-GENERERING   Systemet genererer rapport automatisk       │
│         │                                                        │
│         ▼                                                        │
│  7. GJENNOMGANG      Administrator ser over rapport i dashboard  │
│         │                                                        │
│         ▼                                                        │
│  8. UTSENDING        Administrator sender rapport til kunde      │
│         │                                                        │
│         ▼                                                        │
│  9. FAKTURERING      Rapport markeres som sendt / fakturert      │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

### 3.1 Trinn 1: Planlegging og oppretting av ordre

**Hvem:** Administrator  
**Hvor:** Admin → Planlegger (`/admin/planlegger.html`)

**Fremgangsmåte:**

1. Administrator åpner Planleggeren. Avhengig av tenantens innstillinger kan den vise fanene **Enkel**, **Avansert** og **Periode**.

2. Administrator velger ønsket opprettelsesflyt:
   - **Enkel:** Drag & drop tekniker til kunde. Modal med kundeinfo, dato, fritekstbeskrivelse og flat anleggsliste uten cluster/prosjektfelter.
   - **Avansert:** Drag & drop tekniker til kunde eller Tripletex-prosjekt. Modal med dato, prosjekt/fritekst, anleggsvalg, cluster-gruppering, besøksnummer, serviceadresse og kundenotat.
   - **Periode:** Skjema for gjentakende service der admin velger kunde, tekniker, anlegg, frekvens og dato-intervall, forhåndsviser resultatet og genererer flere ordre samtidig.

3. Administrator klikker **"Opprett ordre"**, eller **"Generer ordre"** i Periode-fanen. Systemet:
   - Genererer unikt ordre-ID (format: `PROJ-ÅÅÅÅ-timestamp`)
   - Tar et **snapshot** av kundedataene (adresse, kontakt, org.nr) som JSONB — endringer i Tripletex påvirker IKKE eksisterende ordrer
   - Lagrer valgt utstyr som `included_equipment_ids`
   - Setter status til `scheduled`
   - Knytter valgt tekniker til ordren

4. Ordren vises nå i teknikerens kalender. Hvis ordren ble opprettet uten tekniker via `Felles`, vises den under `Ledige oppdrag` i tekniker-appen og kan plukkes av en tekniker. Ved Periode-generering vises alle genererte ordre på sine respektive datoer.

**Alternativ:** Administrator kan også opprette ordre via Dashboard → "Opprett ordre"-knappen med samme felt.

**Tripletex-kobling:** Hvis et Tripletex-prosjekt velges i beskrivelsesfeltet, lagres `agreement_number` automatisk. Dette brukes for faktureringsreferanse.

---

### 3.2 Trinn 2: Tekniker ser tildelt ordre

**Hvem:** Tekniker  
**Hvor:** Tekniker-app → Planlagte service (`/app/index.html`)

**Fremgangsmåte:**

1. Tekniker logger inn med sitt navn og passord.
2. Går til **"Planlagte service"** fra hovedmenyen.
3. Ser en **kalendervisning** (uke eller måned) med antall ordrer per dag.
4. Klikker på en dato for å se ordrene for den dagen.
5. Tre statusgrupper vises:
   - **Ordre for valgt dag** — tildelt denne datoen
   - **Kommende denne uken** — neste 7 dager
   - **Uferdige ordre** — ordrer som ikke er fullført (uansett dato)
6. Klikker på en ordre for å se detaljer.

---

### 3.3 Trinn 3: Gjennomgang av ordreinformasjon

**Hvem:** Tekniker  
**Hvor:** Tekniker-app → Ordredetaljer (`/app/orders.html?id={orderId}`)

**Hva tekniker ser:**

- **Kundeinformasjon:** Navn, besøksadresse, ordrenummer, avtalenummer
- **Servicetype og beskrivelse**
- **Utstyrsliste (anlegg):** Hvert anlegg med navn, type, nummer og status:
  - `Ikke startet` — ingen sjekkliste utfylt ennå
  - `Under arbeid` — sjekkliste delvis utfylt
  - `Fullført` — sjekkliste ferdig og signert
- **Eksisterende tilbud** (hvis noen) med status, pris og timer
- **Handlingsknapper:** Åpne service per anlegg, opprette tilbud, opprette SJA

**Viktig:** Kun anlegg markert som `active` og inkludert i `included_equipment_ids` vises.

---

### 3.4 Trinn 4: Utførelse av service (kjernearbeidet)

**Hvem:** Tekniker (ute hos kunde)  
**Hvor:** Tekniker-app → Service (`/app/service.html?id={orderId}&equipmentId={equipmentId}`)

Dette er den mest detaljerte delen av systemet. For **hvert anlegg** i ordren gjør teknikeren følgende:

#### 4a. Sjekkliste

1. Tekniker åpner servicen for et spesifikt anlegg.
2. **Sjekkliste** lastes basert på anleggets type (f.eks. "Ventilasjonsaggregat", "Boligventilasjon", "Vifter").
3. Sjekklisten har ulike punkttyper:

| Punkttype | Beskrivelse | Eksempel |
|-----------|-------------|---------|
| `ok_avvik` | Status-knapper: OK eller Avvik | "Tilluft fungerer" → OK / Avvik |
| `ok_avvik_comment` | Som over, men med obligatorisk kommentar ved avvik | "Motorlager" → Avvik + "Slitasje på lager" |
| `ok_byttet_avvik` | Tre valg: OK / Byttet / Avvik | "Filter tilluft" → Byttet |
| `numeric` / `temperature` | Tallverdi | "Temperatur tilluft" → 22.5°C |
| `text` / `textarea` | Fritekst | "Generell kommentar" → "Alt i orden" |
| `tilstandsgrad_dropdown` | Tilstandsgrad (1-4) | "Tilstandsvurdering" → Grad 2 |
| `konsekvensgrad_dropdown` | Konsekvensgrad | "Konsekvens" → Grad 3 |
| `dropdown_ok_avvik` | Nedtrekksliste + status | Velg type + OK/Avvik |

4. For hvert punkt med **avvik** kan tekniker:
   - Skrive en avvikskommentar
   - Ta bilde av avviket (lagres i GCS med avviksnummer)
   - Avviksnummer telles automatisk opp

5. Hvert sjekklistepunkt lagrer **label** sammen med verdien — slik at PDF-rapporten viser riktig tekst selv om malen endres senere.

#### 4b. Bilder

1. Tekniker kan ta **generelle bilder** av anlegget (ikke knyttet til avvik).
2. Bilder lastes opp til Google Cloud Storage under:  
   `tenants/{tenantId}/service-reports/{år}/{måned}/order-{ordreId}/equipment-{utstyrId}/general/{filnavn}`
3. Bildene legges til i service-rapportens `photos`-array.
4. Bilder kan tas med **kamera** direkte eller lastes opp fra filsystem.

#### 4c. Produkter og tilleggsarbeid

1. Tekniker kan registrere **produkter brukt** (f.eks. "Filter F7", "Reimsett").
2. Tekniker kan registrere **tilleggsarbeid** (f.eks. "Ekstra rengjøring av kanaler", 2 timer).
3. Disse lagres separat som `products_used` og `additional_work` (JSONB-arrays).
4. Produkter og tilleggsarbeid vises i PDF-rapporten.

#### 4d. Driftskjema

1. For anlegg med driftskjema-støtte kan tekniker registrere:
   - Driftstider
   - Trykk- og temperaturmålinger
   - Luftmengder
2. Lagres i `checklist_data.driftSchedule`.

#### 4e. Lagring underveis

- Tekniker kan **lagre sjekklisten** når som helst uten å ferdigstille.
- Systemet sporer ulagrede endringer — varsler ved navigering bort.
- Lagre-knappen endrer farge: **grønn** = lagret, **oransje** = ulagrede endringer.
- Status settes automatisk til `in_progress` når data lagres første gang.

---

### 3.5 Trinn 5: Ferdigstilling

Ferdigstilling skjer i to trinn:

#### 5a. Ferdigstille anlegg

1. Tekniker klikker **"Ferdigstill anlegg"** på servicen for et spesifikt anlegg.
2. Evt. digital signatur registreres.
3. Status settes til `completed` med tidsstempel (`completed_at`).
4. Teknikeren går tilbake til ordredetaljer og ser statusen oppdatert.

#### 5b. Ferdigstille hele ordren

1. Når alle anlegg er ferdigstilt (eller tekniker velger hvilke som skal inkluderes), klikker tekniker **"Fullfør ordre"**.
2. Systemet viser en bekreftelsesdialog med mulighet for å **velge/fjerne anlegg** som skal med i rapporten.
3. Ved bekreftelse skjer følgende i rekkefølge:
   - **Transaksjonsstart:** Ordrestatus settes til `completed`
   - Service-rapporter som IKKE er valgt settes til status `excluded`
   - **Transaksjonsslutt**
   - **Asynkron PDF-generering** starter i bakgrunnen
   - Tekniker ser fremdriftsindikator (via Server-Sent Events)
   - PDF lagres i GCS: `tenants/{tenantId}/service-reports/{år}/{måned}/{ordreId}/servicerapport_{reportId}_{timestamp}.pdf`
   - Databasen oppdateres: `orders.pdf_generated = true`, `orders.pdf_path = [sti]`

**Viktig:** Ordren markeres som fullført SELV OM PDF-genereringen feiler. PDF er en best-effort-operasjon. Admin kan regenerere PDF senere.

---

### 3.6 Trinn 6: PDF-generering (automatisk)

**Hvem:** System (automatisk ved ordrefullføring)

PDF-rapporten genereres av `UnifiedPDFGenerator` og inneholder:

| Seksjon | Innhold |
|---------|---------|
| **Forside** | Firmalogo, rapporttittel, kundenavn, ordrenummer, dato |
| **Kundeinformasjon** | Navn, adresse, kontaktperson, avtalenummer, besøksnummer |
| **Per anlegg:** | |
| — Anleggsinformasjon | Systemnavn, type, nummer, plassering |
| — Sjekklisteresultat | Alle sjekkpunkter med status (OK/Avvik/Byttet) og kommentarer |
| — Avviksbilder | Bilder knyttet til avvik med nummerering |
| — Driftskjema | Temperatur-/trykkmålinger (hvis aktuelt) |
| — Produkter brukt | Liste over materialer |
| — Tilleggsarbeid | Timer og beskrivelse |
| **Generelle bilder** | Bilder ikke knyttet til avvik |
| **Generell kommentar** | Fritekstkommentar fra tekniker |
| **Signatur** | Teknikerens digitale signatur og tidsstempel |

**Teknisk:** Alle bilder konverteres til base64 data-URIer (ingen eksterne URL-er i PDFen). Puppeteer rendrer HTML til PDF med 45-sekunders timeout.

---

### 3.7 Trinn 7: Administrator gjennomgår rapport

**Hvem:** Administrator  
**Hvor:** Admin → Rapporter (`/admin/rapporter.html`)

1. Administrator åpner Rapporter-siden.
2. Ser en **tabell over fullførte ordrer** med:
   - Ordrenummer, Kunde, Tekniker, Dato
   - Status: PDF generert / Ikke generert
   - Flagg: Sendt til fakturering / Fakturert
3. Klikker på en rapport for å:
   - **Se PDF i forhåndsvisning**
   - **Laste ned PDF**
   - **Regenerere PDF** (hvis endringer er gjort eller feil oppstod)

**Dashboard-KPIer** som hjelper admin med oversikten:
- **"Rapporter ikke sendt"** — fullførte ordrer med PDF som ikke er sendt til kunde
- **"Venter på fakturering"** — sendte rapporter som ikke er fakturert

---

### 3.8 Trinn 8: Sende rapport til kunde

**Hvem:** Administrator  
**Hvor:** Admin → Rapporter → Ordrerapport

1. Administrator åpner en fullført ordrerapport.
2. Klikker **"Send til kunde"**.
3. Systemet:
   - Finner rapportmottaker(e) fra `customer_contacts` (de med `is_report_recipient = true`)
   - Laster ned PDF fra GCS
   - Sender e-post med PDF som vedlegg via SMTP (Gmail/custom)
   - Oppdaterer `pdf_sent_timestamp` på ordren
4. E-posten inneholder:
   - Avsender: Firmanavn (fra innstillinger)
   - Emne: "Servicerapport — [Kundenavn] — Ordre [Ordrenr]"
   - Vedlegg: PDF-rapport

---

### 3.9 Trinn 9: Fakturering og oppfølging

**Hvem:** Administrator  
**Hvor:** Admin → Rapporter

1. Etter at rapporten er sendt, markerer admin ordren som **"Sendt til fakturering"** (`sent_til_fakturering = true`).
2. Når faktura er opprettet i regnskapssystem (manuelt — ikke synkronisert), markeres ordren som **"Fakturert"** med:
   - `is_invoiced = true`
   - `invoice_number` (fakturanummer)
   - `invoice_date` (fakturadato)
   - `invoice_comment` (evt. kommentar)
3. Ordren er nå fullstendig ferdigbehandlet.

**Merk:** Fakturering skjer IKKE automatisk i Tripletex. ServFix har kun lokal sporingsdata for fakturering.

---

## 4. Sideprosesser og spesialcaser

### 4.1 Hasteordre (akutt service)

**Scenario:** En kunde ringer med akutt problem som må løses samme dag.

**Hvem:** Tekniker (eller admin)  
**Hvor:** Tekniker-app → "Opprett hasteordre" (`/app/hasteordre.html`)

**Fremgangsmåte:**

1. Tekniker klikker **"Opprett hasteordre"** (oransje knapp) fra hovedmenyen.
2. Søker etter kundenavn eller kundenummer.
3. Velger kunde fra søkeresultater — kundeinformasjon vises.
4. Skriver valgfri beskrivelse (standard: "Hasteordre — Akutt serviceoppdrag").
5. Klikker **"Opprett hasteordre"**.
6. Systemet oppretter ordre med:
   - `scheduled_date = i dag`
   - `technician_id = innlogget tekniker`
   - Ingen utstyrsvalg (alle anlegg tilgjengelig)
   - Oransje markering i kalender

**Forskjell fra planlagt ordre:**
- Ingen datovalg (alltid i dag)
- Ingen utstyrsvelger (tilgjengelig etter opprettelse)
- Raskere opprettelsesflyt

---

### 4.2 Tekniker planlegger eget oppdrag

**Scenario:** Tekniker er ute hos kunde og avtaler oppfølgingsservice.

**Hvem:** Tekniker  
**Hvor:** Tekniker-app → "Planlegg oppdrag" (`/app/planlegg.html`)

**Fremgangsmåte:**

1. Tekniker klikker **"Planlegg oppdrag"** fra hovedmenyen.
2. Søker etter og velger kunde.
3. Fyller ut:
   - **Beskrivelse** eller velger **Tripletex-prosjekt** (hvis tilgjengelig)
   - **Besøksnummer** (valgfritt)
   - **Serviceadresse** (valgfritt — standardadresse fra kunde brukes)
   - **Anlegg** — checkbox-liste, kan velge alle eller spesifikke
   - **Kundenotat** (valgfritt)
   - **Dato** — hurtigvalg: "Neste uke", "Om 1 måned", "Om 3 måneder", "Om 6 måneder" — eller manuelt datovalg
4. Klikker **"Planlegg oppdrag"** → Bekreftelsesdialog → Ordre opprettes.
5. Teknikeren tildeles automatisk til ordren.

**Utstyrscluster:** Tekniker kan gruppere utstyr i clustere (f.eks. "Bygg A", "2. etasje") for enklere valg ved fremtidige ordrer.

---

### 4.3 Søk og overta ordre

**Scenario:** En tekniker er syk og en annen tekniker må ta over oppdraget.

**Hvem:** Tekniker  
**Hvor:** Tekniker-app → "Søk ordre" (`/app/search-orders.html`)

**Fremgangsmåte:**

1. Tekniker klikker **"Søk ordre"** fra hovedmenyen.
2. Ser alle ordrer fra **andre teknikere** (standard: alle minus egen).
3. Kan filtrere på:
   - **Tekniker** (velg spesifikk eller alle)
   - **Status** (Aktive, Alle, Planlagt, Under arbeid)
   - **Søketekst** (kundenavn, adresse, ordrenummer)
4. Klikker på en ordre for å se detaljer i modal.
5. Klikker **"Overta ordre"** for å flytte ordren til seg selv.
6. Ordren vises nå i teknikerens egen kalender.

---

### 4.3b Ledige oppdrag fra Felles/pool

**Scenario:** Administrator legger et oppdrag i `Felles` i stedet for å tildele en konkret tekniker.

**Hvem:** Tekniker  
**Hvor:** Tekniker-app → Planlagte service (`/app/index.html`)

**Fremgangsmåte:**

1. Tekniker åpner Planlagte service og ser seksjonen `Ledige oppdrag`.
2. Tekniker filtrerer listen på `I dag`, `I morgen`, `+1 uke` eller `+1 mnd`.
3. Pool-oppdrag markeres med grå prikk i kalenderen.
4. Tekniker klikker `Plukk` på ønsket oppdrag.
5. Backend kjører atomisk claim via `POST /api/orders/:id/claim`.
6. Hvis oppdraget fortsatt er ledig, settes `technician_id` til innlogget tekniker, status settes til `scheduled`, og oppdraget flyttes til teknikerens egne ordre.
7. Hvis en annen tekniker allerede har plukket oppdraget, returnerer API `409`, og listen refreshes.

---

### 4.4 Ekstra utstyr/anlegg under service

**Scenario:** Tekniker oppdager et anlegg hos kunden som ikke er registrert i systemet.

**Fremgangsmåte:**

1. Fra ordredetaljer eller planlegg-siden, klikker tekniker **"Nytt anlegg"**.
2. Fyller ut:
   - Systemnavn, Systemtype (ventilasjonsaggregat, boligventilasjon, vifter, custom)
   - Systemnummer, Plassering, Betjener, Lokasjon
   - Filterinformasjon (tilluft, avtrekk, drivrem — hvis aktuelt)
3. Anlegget knyttes til kunden og er tilgjengelig for fremtidige ordrer.
4. Anlegget kan umiddelbart inkluderes i gjeldende ordre.

---

### 4.5 Avviksregistrering (detaljert)

**Scenario:** Tekniker finner feil/mangler på et anlegg under service.

**Fremgangsmåte:**

1. I sjekklisten for et sjekkpunkt, velger tekniker **"Avvik"** (rød knapp).
2. Skriver en **avvikskommentar** som beskriver feilen.
3. Tar **avviksbilde** med kameraet:
   - Bildet nummereres automatisk (avvik nr. 1, 2, 3...)
   - Lagres i GCS under: `order-{id}/equipment-{id}/avvik/`
   - Metadata (beskrivelse, tidsstempel) lagres i `avvik_images`-tabellen
4. Kan ta flere bilder per avvik.
5. Avviket vises i PDF-rapporten med bilde, nummer og kommentar.

#### 4.5b Admin oppfølging av avvik
Når en tekniker registrerer et avvik, blir dette tilgjengelig for administrator i **Avvikshåndterings-modulen**. Her kan administrator tildele avviket til en tekniker for utbedring, sette tidsfrister, og følge status frem til avviket er lukket. 

For detaljert beskrivelse av administrasjon, API og arbeidsflyt for oppfølging, se [avvik-admin.md](avvik-admin.md).

**Visning i PDF:**
- Avviksbilder kan vises som **store bilder** (innstilling per tenant: `reportSettings.largeAvvikImages`)
- Hvert avvik nummereres for referanse

---

### 4.6 Delvis fullføring av ordre

**Scenario:** Tekniker kan ikke fullføre alle anlegg i én tur (venter på deler, tilgang nektet, etc.).

**Fremgangsmåte:**

1. Tekniker ferdigstiller de anleggene som er ferdige.
2. De øvrige forblir med status `in_progress` eller `not_started`.
3. Ordren forblir med status `scheduled` (ikke fullført).
4. Tekniker kan komme tilbake en annen dag og fortsette.
5. Ordren vises under **"Uferdige ordre"** i teknikerens kalender.
6. Ved endelig fullføring kan tekniker velge hvilke anlegg som skal inkluderes i rapporten — de øvrige settes til `excluded`.

---

### 4.7 PDF-regenerering

**Scenario:** Feil i generert rapport, eller endringer i innstillinger (logo, farger) krever ny PDF.

**Hvem:** Administrator  
**Hvor:** Admin → Rapporter

1. Administrator finner ordren i rapportlisten.
2. Klikker **"Regenerer PDF"**.
3. Systemet genererer ny PDF med oppdaterte innstillinger og overskriver den gamle.
4. Ny PDF-sti lagres i databasen.

---

## 5. HMS-prosesser (SJA og ROS)

### 5.1 Sikker Jobb Analyse (SJA)

**Formål:** Risikovurdering FØR arbeidet starter — dokumenterer identifiserte risikoer og tiltak.

**Hvem:** Tekniker  
**Hvor:** Tekniker-app → HMS → SJA (`/app/sja.html`)

**Fremgangsmåte:**

1. Tekniker åpner SJA fra ordredetaljsiden (knappen "SJA") eller fra HMS-menyen.
2. Hvis åpnet fra ordre, er følgende **forhåndsutfylt**:
   - Kundenavn, Ordrenummer, Arbeidssted, Servicetype, Dato, Tekniker
3. Tekniker velger **kategori** for SJA (f.eks. "Arbeid i høyden", "Elektrisk arbeid").
4. Systemet kobler automatisk SJA til nyeste **godkjente ROS-analyse** for valgt kategori.
5. Tekniker fyller ut tre obligatoriske felt:
   - **Beskrivelse av arbeidsoperasjon** — Hva skal gjøres?
   - **Identifiserte risikoer** — Hva kan gå galt?
   - **Tiltak / vernetiltak** — Hvilke sikkerhetstiltak er iverksatt?
6. Tekniker kan **ta bilder** av arbeidsstedet (vedlegges SJA).
7. Klikker **"Lagre SJA"**.
8. SJA kan redigeres og suppleres med flere bilder etter lagring.
9. PDF genereres on-demand (cached — regenereres ved endringer).

**Visning for admin:** Admin kan se alle SJA-er med ordrekobling, tekniker og ROS-referanse.

---

### 5.2 Risiko- og Sårbarhetsanalyse (ROS)

**Formål:** Overordnet risikoanalyse for arbeidstyper — brukes som grunnlag for SJA-er.

**Hvem:** Administrator (eller tekniker)  
**Hvor:** Admin-panel / HMS-meny

**Fremgangsmåte:**

1. Administrator oppretter ny ROS-analyse med:
   - **Tittel** (f.eks. "Arbeid i høyden — standard")
   - **Prosjekttype** og **Kategori**
   - **Skjemadata** med 5×5 risikomatrise:
     - Identifiserte risikoer FØR tiltak (sannsynlighet × konsekvens)
     - Tiltak beskrevet
     - Risikoer ETTER tiltak (sannsynlighet × konsekvens)
     - Risikoreduksjon i prosent (beregnet)
2. Status settes til `draft` eller `completed`.
3. Kun **fullførte** ROS-analyser kobles automatisk til SJA-er.
4. PDF genereres on-demand med fargekodede risikonivåer.

**Kobling SJA ↔ ROS:** Når tekniker velger en kategori i SJA, henter systemet automatisk nyeste fullførte ROS for den kategorien og knytter den til SJA-en via `ros_id`.

---

## 6. Kundeadministrasjon

### 6.1 Kundeoversikt og redigering

**Hvem:** Administrator  
**Hvor:** Admin → Kunder (`/admin/kunder.html`)

**Tre-kolonne-layout:**

| Venstre | Midten | Høyre |
|---------|--------|-------|
| Kundeliste med søk | Valgt kundes detaljer | Servicehistorikk |

**For en valgt kunde vises:**

- **Kundeinformasjon:** Navn, kundenummer, adresse, telefon, e-post, kontaktperson
- **Anlegg/Utstyr:** Liste over alle registrerte anlegg med:
  - Systemnavn, type, serienummer, plassering
  - Filterinformasjon (hvis aktuelt)
  - Redigerings- og sletteknapper
  - Cluster-tilhørighet
- **Kontaktpersoner:** Liste med:
  - Navn, e-post, telefon, rolle
  - **Rapportmottaker-checkbox** — bestemmer hvem som mottar servicerapporter
  - Redigering og sletting
- **Servicehistorikk:** Alle ordrer for denne kunden med dato, status, tekniker og PDF-lenke

---

### 6.2 Legg til utstyr

**Hvem:** Administrator eller Tekniker

1. Velg kunde.
2. Klikk **"Legg til anlegg"**.
3. Fyll ut:
   - **Systemnavn** (f.eks. "Aggregat 1. etasje")
   - **Systemtype** (Ventilasjonsaggregat / Boligventilasjon / Vifter / Custom)
   - **Systemnummer** (serienummer/identifikator)
   - **Plassering** (f.eks. "Teknisk rom, 2. etasje")
   - **Betjener** (hva anlegget betjener, f.eks. "Kontorlandskap")
   - **Lokasjon** (fysisk plassering)
   - **Filter** (tilluft, avtrekk, drivrem — valgfritt)
   - **Cluster** (gruppering — valgfritt)
4. Anlegget er umiddelbart tilgjengelig for ordrer.

**Sletting:** Utstyr "slettes" via soft delete (status settes til `inactive`), ikke hard delete. Utstyr som er inaktivt vises ikke i ordrer.

---

### 6.3 Cluster-administrasjon (utstyrsgruppering)

**Formål:** Gruppere utstyr som hører sammen — f.eks. "Bygg A", "Kjeller", "2. etasje".

**Fremgangsmåte:**

1. Fra kundedetaljer, klikk **"Opprett cluster"**.
2. Gi clusteret et navn.
3. Valgfritt: Koble til Tripletex-prosjekt (prosjekt-ID og navn).
4. Velg utstyr som skal tilhøre clusteret (batch-valg med checkboxes).
5. Clustere vises som grupper i utstyrsvalget ved ordreopprettelse.

---

## 7. Tripletex-integrasjon

### 7.1 Overordnet

ServFix har **enveis, skrivebeskyttet** integrasjon med Tripletex:

| Hva | Retning | Beskrivelse |
|-----|---------|-------------|
| Kunder | Tripletex → ServFix | Import av kundedata (navn, adresse, kontakter, org.nr) |
| Kontakter | Tripletex → ServFix | Import av kundekontakter (inkl. "servfixmail"-kontakt) |
| Prosjekter | Tripletex → ServFix | Sanntidsoppslag av Tripletex-prosjekter ved ordreopprettelse |
| Fakturering | Kun lokal | ServFix sporer fakturering, men skriver ALDRI til Tripletex |

**Konfigurasjon:**
- Tripletex konfigureres per tenant i `servfix_admin.tenant_integrations`.
- Runtime laster konfigurasjonen via admin-databasen, men importerte kunder og kontakter skrives bare til tenantens egen database.
- I Fase 1a finnes en midlertidig env-fallback for eksisterende prod-tenant under utrulling, men nye tenants skal konfigureres via admin-laget, ikke globale env-variabler.

### 7.2 Kundeimport

**Hvem:** Administrator  
**Hvor:** Admin → Kunder → "Importer fra Tripletex"

**Fremgangsmåte:**

1. Administrator klikker **"Importer fra Tripletex"**.
2. **Forhåndsvisning:** Systemet henter alle kunder fra Tripletex og viser:
   - Nye kunder (finnes ikke lokalt)
   - Oppdaterte kunder (endringer i Tripletex)
   - Uendrede kunder (hoppes over)
3. Administrator velger hvilke kunder som skal importeres med checkboxes.
4. Klikker **"Importer valgte"**.
5. Systemet:
   - Oppretter/oppdaterer kunder i lokal database
   - Henter fysisk og postal adresse for hver kunde
   - Finner "servfixmail"-kontakt (kontakt med etternavn "servfixmail") og setter som rapportmottaker
   - Returnerer statistikk: `{ importert, oppdatert, hoppet over, kontakter opprettet, feil }`

**Beskyttelse av lokale endringer:** Hvis en administrator har redigert en kunde lokalt (f.eks. endret adresse), vil `updated_at > created_at` og kunden **hoppes over** ved re-import. Dette forhindrer at lokale endringer overskrives.

### 7.3 Prosjektoppslag

Ved ordreopprettelse (planlegger) kan admin/tekniker søke etter Tripletex-prosjekter:
- Sanntidssøk med 500ms debounce
- Søker på prosjektnavn og prosjektnummer parallelt
- Velgt prosjekt lagres som `agreement_number` på ordren

---

## 8. PDF-generering og rapportering

### 8.1 PDF-typer i systemet

| Type | Generator | Lagres i GCS | Sendes på e-post | Trigger |
|------|-----------|-------------|------------------|---------|
| **Servicerapport** | UnifiedPDFGenerator | Ja | Ja | Automatisk ved ordrefullføring |
| **Tilbuds-PDF** | QuotePDFGenerator | Nei (in-memory) | Ja (vedlegg) | On-demand |
| **SJA-PDF** | SjaPdfGenerator | Ja | Nei | On-demand (cached) |
| **ROS-PDF** | RosPdfGenerator | Ja | Nei | On-demand (cached) |

### 8.2 Servicerapport-innhold (detaljert)

En servicerapport-PDF inneholder, i rekkefølge:

1. **Rapportheading** — Firmalogo, farget banner med rapporttittel
2. **Firmainformasjon** — Navn, adresse, telefon, e-post, org.nr
3. **Kundeinformasjon** — Kundenavn, adresse, ordrenummer, avtalenummer, besøksnummer, dato
4. **For hvert inkludert anlegg:**
   - Anleggsdetaljer (navn, type, nummer, plassering, filterinfo)
   - Sjekklisteresultat med fargekoding:
     - **Grønn/OK** — alt i orden
     - **Rød/Avvik** — feil funnet, kommentar vedlagt
     - **Gul/Byttet** — komponent byttet ut
   - Avviksbilder (nummerert, evt. store bilder per innstilling)
   - Driftskjema (temperaturer, trykk, luftmengder)
   - Produkter brukt (tabell med beskrivelse)
   - Tilleggsarbeid (timer og beskrivelse)
5. **Generelle bilder** — Ikke avviksspesifikke bilder
6. **Generell kommentar** — Fritekst fra tekniker
7. **Signatur** — Digital signatur med tidsstempel

### 8.3 Tilbuds-PDF-innhold

1. **Overskrift** — "Tilbud" med firmalogo
2. **Kundeinformasjon** — Navn, adresse, kontakt
3. **Tilbudsoversikt** — Per post:
   - Beskrivelse av arbeid
   - Estimerte timer × timepris
   - Produkter med mengde og pris
4. **Sammendrag** — Sum eks. mva, 25% mva, total inkl. mva
5. **Forbehold** — Standardtekst (konfigurerbar per tenant)

---

## 9. E-post og kundeleveranse

### 9.1 Sende servicerapport

**Trigger:** Administrator klikker "Send til kunde" i rapportoversikten.

**Prosess:**
1. System finner mottakere: alle kontakter med `is_report_recipient = true`
2. Laster ned PDF fra GCS
3. Sender e-post via SMTP med:
   - **Fra:** Firmanavn (innstillinger)
   - **Til:** Rapportmottaker(e)
   - **Emne:** "Servicerapport — [Kundenavn] — Ordre [Ordrenr]"
   - **Vedlegg:** PDF-rapport
4. Oppdaterer `pdf_sent_timestamp` på ordren

### 9.2 Sende tilbud

**Trigger:** Administrator klikker "Send til kunde" på et tilbud.

**Prosess:**
1. System finner rapportmottaker fra kundekontakter
2. Genererer tilbuds-PDF (in-memory)
3. Sender e-post med:
   - **Emne:** Tilbudsreferanse
   - **Brødtekst:** HTML-formatert tilbudssammendrag med fargekodede tabeller
   - **Vedlegg:** Tilbuds-PDF
4. Oppdaterer tilbudsstatus til `sent` + `sent_to_customer = true` + `sent_date`

---

## 10. Utstyr og anlegg

### 10.1 Utstyrstyper

| Type | Kode | Typisk sjekkliste |
|------|------|-------------------|
| Ventilasjonsaggregat | `ventilasjonsaggregat` | Motorer, reimer, filtre, varmeveksler, drenerering |
| Boligventilasjon | `boligventilasjon` | Forenklet sjekkliste for boliger |
| Vifter | `vifter` | Vifte, lager, rem, vibrasjon |
| Custom | `custom` | Tilpasset sjekkliste |

### 10.2 Filterinformasjon

Utstyr kan ha filterinformasjon (valgfritt):

| Felt | Beskrivelse |
|------|-------------|
| `has_filters` | Hovedbryter — aktiverer filterfelter |
| `filter_supply` | Tilluft-filter |
| `filter_exhaust` | Avtrekks-filter |
| `filter_drive_supply` | Aggregat tilluft |
| `filter_drive_exhaust` | Aggregat avtrekk |

Filterinfo vises som badge på utstyrskort og i rapporter.

### 10.3 Utstyrsclustere

Clustere grupperer utstyr logisk:
- Knyttes til én kunde
- Valgfri kobling til Tripletex-prosjekt
- Vises som grupper i utstyrsvalg ved ordreopprettelse
- Forenkler valg ved gjentakende service

---

## 11. Tilbudshåndtering

### 11.1 Opprett tilbud

**Hvem:** Tekniker (fra ordredetaljer) eller Administrator  
**Scenario:** Tekniker oppdager ekstra arbeid som må avklares med kunden.

**Fremgangsmåte:**

1. Fra ordredetaljer, klikker tekniker **"Tilbud"**.
2. Oppretter nytt tilbud med:
   - **Beskrivelse** av foreslått arbeid
   - **Estimerte timer** og timepris
   - **Produkter** (type, antall, pris)
3. Tilbudet knyttes til ordren og lagres med status `pending`.
4. Administrator kan se tilbudet i sin tilbudsoversikt.

### 11.2 Tilbudets livssyklus

```
pending ──→ sent ──→ accepted
                 └──→ rejected
```

| Status | Beskrivelse | Handling |
|--------|-------------|----------|
| `pending` | Opprettet, ikke sendt | Admin kan redigere, slette, sende |
| `sent` | Sendt til kunde på e-post | Venter på svar fra kunde |
| `accepted` | Kunde har godkjent | Arbeidet kan utføres |
| `rejected` | Kunde har avslått | Arkiveres |

### 11.3 Tilbud i kontekst

- Tilbud vises på ordredetaljsiden (for tekniker)
- Dashboard-KPI: "Tilbud venter på godkjenning"
- Admin kan se alle tilbud filtrert på status

---

## 12. Fakturering og oppfølging

ServFix håndterer **ikke** selve faktureringen — dette gjøres i regnskapssystemet (f.eks. Tripletex). Men ServFix sporer faktureringsstatusen:

### 12.1 Faktureringsstatus per ordre

| Felt | Beskrivelse |
|------|-------------|
| `sent_til_fakturering` | Rapport sendt til kunde/faktureringsavdeling |
| `is_invoiced` | Faktura er opprettet i regnskapssystem |
| `invoice_number` | Fakturanummer fra regnskapssystem |
| `invoice_date` | Fakturadato |
| `invoice_comment` | Eventuell kommentar |

### 12.2 Dashboard-KPIer for fakturering

| KPI | Beregning |
|-----|-----------|
| **Rapporter ikke sendt** | Ordrer med `pdf_generated = true` OG `sent_til_fakturering = false` |
| **Venter på fakturering** | Ordrer med `pdf_generated = true` OG `is_invoiced = false` |

---

## 13. Innstillinger og tilpasning

### 13.1 Firmainnstillinger

**Hvem:** Administrator  
**Hvor:** Admin → Innstillinger

| Innstilling | Beskrivelse |
|-------------|-------------|
| Firmanavn | Vises i rapporter og e-poster |
| Adresse | Firma-adresse i rapporter |
| Telefon, E-post, Org.nr | Kontaktinfo i rapporter |
| Logo | Opplastet bilde — vises i rapporter, login-side, e-poster |
| Rapportfarger | Heading-farge og tekstfarge i PDF-rapporter |
| Store avviksbilder | Vis avviksbilder i full størrelse i rapport |
| Forbehold-tekst (tilbud) | Standardtekst nederst i tilbuds-PDF |

### 13.2 HMS-innstillinger

| Innstilling | Beskrivelse |
|-------------|-------------|
| HMS-meny aktivert | Viser/skjuler HMS-knappen i tekniker-appen |
| SJA per ordre aktivert | Viser SJA-knapp på ordredetaljer |

### 13.3 App-meny

Admin kan konfigurere hovedmenyen i tekniker-appen:

| Menyvalg | Standardtittel | Konfigurasjon |
|----------|----------------|---------------|
| Planlagte service | `Planlagte service` | Synlig/skjult + egendefinert tittel |
| Planlegg oppdrag | `Planlegg oppdrag` | Synlig/skjult + egendefinert tittel |
| Opprett hasteordre | `Opprett hasteordre` | Synlig/skjult + egendefinert tittel |
| Søk ordre | `Søk ordre` | Synlig/skjult + egendefinert tittel |
| HMS | `HMS` | Synlig/skjult + egendefinert tittel |

Verdiene lagres i GCS-basert `settings.json` under `app_menu`. HMS-menyen vises bare hvis både `app_menu.hms.visible` og `hmsSettings.hmsMenuEnabled` tillater det.

### 13.4 Planlegger-innstillinger

Admin kan konfigurere hvilke planleggerfaner som er tilgjengelige for tenantens administratorer:

| Innstilling | Beskrivelse |
|-------------|-------------|
| Vis Enkel-fane | Aktiverer forenklet drag & drop-planlegging |
| Vis Avansert-fane | Aktiverer full planlegger med prosjekt, cluster og ekstra ordrefelt |
| Vis Periode-fane | Aktiverer periodeplaner for gjentakende ordre |
| Standardfane | Bestemmer hvilken aktiv fane som åpnes først |

Disse verdiene lagres i GCS-basert `settings.json` under `module_flags`. Hvis standardfanen er deaktivert, åpnes første aktive fane i stedet. Fanelinjen vises bare når minst to faner er aktive.

### 13.5 Sjekkliste-maler

Administrator kan konfigurere sjekkliste-maler per utstyrstype:
- Legge til/fjerne sjekkpunkter
- Endre rekkefølge
- Legge til instruksjoner per sjekkpunkt (veiledning for tekniker)
- Aktivere/deaktivere driftskjema
- Aktivere/deaktivere produktregistrering

---

## 14. Ordretyper og opprettelsesflyter

### 14.1 Oversikt

| Type | Opprettet av | Trigger | Dato | Utstyr |
|------|-------------|---------|------|--------|
| **Planlagt (admin enkel)** | Administrator | Enkel-fanen: drag-and-drop tekniker til kunde | Valgt | Flat anleggsliste |
| **Planlagt (admin avansert)** | Administrator | Avansert-fanen: drag-and-drop til kunde/prosjekt | Valgt | Cluster-gruppert anleggsliste |
| **Periodisk (admin)** | Administrator | Periode-fanen: forhåndsvis og generer fra regel | Flere datoer | Valgt fra kundens utstyr |
| **Planlagt (tekniker)** | Tekniker | Fra "Planlegg oppdrag" | Valgt (hurtigvalg eller manuelt) | Valgt fra kundens utstyr |
| **Hasteordre** | Tekniker | Fra "Opprett hasteordre" | I dag (automatisk) | Alle (velges senere) |
| **Overtatt** | Tekniker | Fra "Søk ordre" → "Overta" | Beholder opprinnelig | Beholder opprinnelig |

### 14.2 Felles for alle ordretyper

- Unikt ordre-ID: `PROJ-ÅÅÅÅ-timestamp`
- Kundedata-snapshot (JSONB) tas ved opprettelse
- Service-rapporter opprettes automatisk for hvert anlegg ved første åpning
- Status starter som `scheduled` (eller `pending` uten tekniker)

---

## 15. Statusflyter og tilstandsdiagrammer

### 15.1 Ordrestatus

```
pending ───────────▶ scheduled ───────────▶ completed
(uten tekniker)      (tekniker tildelt)       (alle anlegg ferdig,
                                               PDF generert)
                     
Merknad: Ingen reversering. Fullført ordre kan ikke gjenåpnes.
```

### 15.2 Service-rapport (per anlegg) status

```
not_started ──▶ in_progress ──▶ completed ──▶ excluded
(ny, tom)       (data lagret)   (ferdigstilt)  (ikke inkludert
                                                i PDF)
```

### 15.3 Tilbudsstatus

```
pending ──▶ sent ──▶ accepted
                └──▶ rejected
```

### 15.4 SJA/ROS-status

```
draft ──▶ completed
```

---

## 16. Vedlegg: Akseptansetestcaser

### Kategori A: Autentisering

| # | Testcase | Forventet resultat |
|---|----------|-------------------|
| A1 | Tekniker logger inn med gyldig passord | Redirected til hovedmeny, session opprettes |
| A2 | Tekniker logger inn med feil passord | Feilmelding, ingen session |
| A3 | Admin logger inn med gyldig e-post/passord | Redirected til dashboard |
| A4 | Admin logger inn med feil passord | Feilmelding |
| A5 | Tekniker prøver å aksessere admin-side | 401/redirect til login |
| A6 | Uautentisert bruker prøver API-kall | 401-respons |
| A7 | Tekniker logger ut | Session slettet, redirect til login |

### Kategori B: Ordreopprettelse

| # | Testcase | Forventet resultat |
|---|----------|-------------------|
| B1 | Admin oppretter planlagt ordre fra Enkel-fanen | Ordre opprettet med riktig tekniker, dato, beskrivelse og valgte anlegg |
| B2 | Enkel-fanen åpner forenklet modal | Ingen prosjekt-dropdown, cluster-admin, serviceadresse, besøksnummer eller kundenotat vises |
| B3 | Admin oppretter planlagt ordre fra Avansert-fanen | Ordre opprettet med riktig tekniker, dato og cluster-gruppert utstyr |
| B4 | Admin oppretter ordre med Tripletex-prosjekt | `agreement_number` satt fra prosjekt |
| B5 | Admin oppretter ordre med serviceadresse | Adresse lagret separat fra kundeadresse |
| B6 | Admin oppretter periodeplan og forhåndsviser | Forhåndsvisning viser forventede ordre før generering |
| B7 | Admin genererer ordre fra periodeplan | Flere ordre opprettes på korrekte datoer med valgt tekniker og anlegg |
| B8 | Tekniker oppretter hasteordre | Ordre opprettet med dagens dato, tekniker = seg selv |
| B9 | Tekniker oppretter planlagt oppdrag med hurtigdato | Riktig dato beregnet (f.eks. 1 måned frem) |
| B10 | Tekniker oppretter ordre med spesifikke anlegg valgt | Kun valgte anlegg i `included_equipment_ids` |
| B11 | Ordre opprettes — kundesnapshot lagret | `customer_data` inneholder navn, adresse, kontakt etc. |
| B12 | Planleggerfane er deaktivert i innstillinger | Fanen skjules, og standardfane faller tilbake til første aktive fane |

### Kategori C: Servicegjennomføring

| # | Testcase | Forventet resultat |
|---|----------|-------------------|
| C1 | Tekniker åpner service for anlegg | Sjekkliste vises basert på utstyrstype |
| C2 | Tekniker fyller ut "OK" på sjekkpunkt | Verdi lagret, status grønn |
| C3 | Tekniker registrerer avvik med kommentar | Avvik lagret med kommentar |
| C4 | Tekniker tar avviksbilde | Bilde lastet opp til GCS, lagt til rapport |
| C5 | Tekniker tar generelt bilde | Bilde lagret i `photos`-array |
| C6 | Tekniker legger til produkt | Produkt lagret i `products_used` |
| C7 | Tekniker legger til tilleggsarbeid | Tilleggsarbeid lagret i `additional_work` |
| C8 | Tekniker lagrer sjekkliste uten å ferdigstille | Status = `in_progress`, data bevart |
| C9 | Tekniker navigerer bort med ulagrede endringer | Advarsel vises |
| C10 | Tekniker lagrer, eksisterende bilder bevares | `photos`-array IKKE overskrevet ved save |
| C11 | Tekniker fyller ut driftskjema | Data lagret i `checklist_data.driftSchedule` |

### Kategori D: Ferdigstilling og PDF

| # | Testcase | Forventet resultat |
|---|----------|-------------------|
| D1 | Tekniker ferdigstiller anlegg | Status = `completed`, `completed_at` satt |
| D2 | Tekniker ferdigstiller ordre (alle anlegg inkludert) | Ordrestatus = `completed`, PDF genereres |
| D3 | Tekniker ferdigstiller ordre med noen anlegg ekskludert | Ekskluderte anlegg = `excluded`, kun inkluderte i PDF |
| D4 | PDF genereres med alle seksjoner | Sjekkliste, bilder, avvik, produkter, signatur i PDF |
| D5 | PDF-generering feiler | Ordrestatus er fortsatt `completed`, admin kan regenerere |
| D6 | Admin regenererer PDF | Ny PDF generert, gammel overskrevet |
| D7 | PDF-fremdrift vises (SSE) | Fremdriftsbar oppdateres i sanntid |
| D8 | PDF inneholder base64-bilder | Ingen eksterne URL-er i rendret HTML |

### Kategori E: Tilbud

| # | Testcase | Forventet resultat |
|---|----------|-------------------|
| E1 | Tekniker oppretter tilbud fra ordredetaljer | Tilbud lagret med status `pending` |
| E2 | Tilbud med timer og produkter | Korrekt totalsum beregnet |
| E3 | Admin sender tilbud til kunde | E-post sendt med PDF-vedlegg, status = `sent` |
| E4 | Admin godkjenner tilbud | Status = `accepted` |
| E5 | Admin avslår tilbud | Status = `rejected` |
| E6 | Tilbud slettes | Tilbud fjernet |
| E7 | Tilbuds-PDF genereres | PDF med korrekt mva-beregning (25%) |

### Kategori F: HMS (SJA og ROS)

| # | Testcase | Forventet resultat |
|---|----------|-------------------|
| F1 | Tekniker oppretter SJA fra ordre | SJA opprettet med ordrekobling, forhåndsutfylte felt |
| F2 | SJA med valgt kategori | Automatisk kobling til nyeste fullførte ROS for kategorien |
| F3 | Tekniker laster opp bilde til SJA | Bilde lagret i GCS og lagt til `photos`-array |
| F4 | Admin oppretter ROS-analyse | ROS lagret med 5×5 risikomatrise |
| F5 | ROS settes til `completed` | Tilgjengelig for automatisk SJA-kobling |
| F6 | SJA-PDF genereres | PDF med risikoer, tiltak, bilder, signatur |
| F7 | ROS-PDF genereres | PDF med fargekodede risikonivåer |
| F8 | SJA bilde slettes | Bilde fjernet fra GCS og `photos`-array |

### Kategori G: Kundeadministrasjon

| # | Testcase | Forventet resultat |
|---|----------|-------------------|
| G1 | Admin søker etter kunde | Resultater filtrert på navn/nummer |
| G2 | Admin importerer kunder fra Tripletex (forhåndsvisning) | Viser nye/oppdaterte kunder uten å lagre |
| G3 | Admin importerer valgte kunder | Kunder lagret lokalt med adresser og kontakter |
| G4 | Lokalt redigert kunde hoppes over ved re-import | `updated_at > created_at` = skip |
| G5 | "servfixmail"-kontakt settes som rapportmottaker | Automatisk identifisert og flagget |
| G6 | Admin endrer rapportmottaker | `is_report_recipient`-flagg oppdatert |
| G7 | Admin legger til nytt anlegg | Anlegg opprettet med riktige felter |
| G8 | Admin sletter anlegg | Soft delete (status = `inactive`) |
| G9 | Admin oppretter utstyrscluster | Cluster opprettet med kundekobling |
| G10 | Admin batch-tilordner utstyr til cluster | Alle valgte utstyr oppdatert |

### Kategori H: Rapporter og fakturering

| # | Testcase | Forventet resultat |
|---|----------|-------------------|
| H1 | Admin ser rapportoversikt | Grupperte rapporter per ordre med status |
| H2 | Admin laster ned PDF | PDF strømmet med korrekt filnavn |
| H3 | Admin sender rapport til kunde | E-post til rapportmottaker(e) med vedlegg |
| H4 | Admin markerer "Sendt til fakturering" | `sent_til_fakturering = true` |
| H5 | Admin markerer "Fakturert" med fakturanummer | `is_invoiced = true`, fakturanummer lagret |
| H6 | Dashboard viser korrekte KPIer | Tall stemmer med faktisk status |

### Kategori I: Søk og overtakelse

| # | Testcase | Forventet resultat |
|---|----------|-------------------|
| I1 | Tekniker søker alle ordrer | Viser ordrer fra andre teknikere |
| I2 | Tekniker filtrerer på tekniker/status | Kun matchende ordrer vist |
| I3 | Tekniker overtar ordre | `technician_id` endret, ordre vises i egen kalender |
| I4 | Søk på kundenavn/adresse/ordrenr | Korrekte resultater |

### Kategori J: Tenant-isolasjon (sikkerhet)

| # | Testcase | Forventet resultat |
|---|----------|-------------------|
| J1 | Tekniker for tenant A prøver å se data fra tenant B | 401/403, ingen data returnert |
| J2 | Admin med bundet tenant prøver å bytte | 403-feil |
| J3 | Super-admin bytter tenant via header | Korrekt data for valgt tenant |
| J4 | Innlogging fra feil subdomain | Avvist i produksjon |

---

> **Merk:** Denne prosessbeskrivelsen er basert på kodeanalyse per april 2026 og dekker funksjonalitet som er implementert i kodebasen. Noen funksjoner kan ha blitt lagt til eller endret etter denne datoen.
