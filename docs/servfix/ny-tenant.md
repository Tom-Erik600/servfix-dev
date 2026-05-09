# ServFix — Opprette ny tenant

> Sist oppdatert: 2026-05-09  
> Formål: Steg-for-steg guide for å opprette en ny tenant i test- eller produksjonsmiljøet.

---

## Oversikt

Hver tenant i ServFix består av disse delene:

| Del | Hva | Hvor |
|-----|-----|------|
| **Tenant-rad** | Registrering i `servfix_admin.tenants` | Cloud SQL |
| **Tenant-database** | Isolert PostgreSQL-database med alle tabeller | Cloud SQL |
| **Settings-fil** | `settings.json` med modul-flagg og meny-config | Google Cloud Storage |
| **Integrasjonsrad** | Valgfri rad i `servfix_admin.tenant_integrations` for Tripletex | Cloud SQL |

Hvis tenanten skal bruke Tripletex, skal credentials legges inn per tenant i `servfix_admin.tenant_integrations` via admin-endepunktet. Nye tenants skal ikke settes opp med globale `CONSUMER_TOKEN` / `EMPLOYEE_TOKEN` i env.

Subdomenet `varingtest.servfix.no` løses automatisk til tenant-id `varingtest` av applikasjonen — ingen DNS- eller CORS-konfigurasjon er nødvendig (alle `*.servfix.no`-subdomener er allerede tillatt).

---

## Eksempel: `varingtest` / `varing_db`

Alle steg under bruker dette eksempelet:

- **Tenant-id:** `varingtest`
- **Databasenavn:** `varing_db`
- **Subdomene:** `varingtest.servfix.no`
- **Miljø:** Test (`servfix-test:europe-north1:servfix-test-db`)

---

## Forutsetninger

- `gcloud` CLI installert og autentisert mot riktig prosjekt
- Cloud SQL Proxy kjørende lokalt på port 5433 mot testmiljøet:
  ```
  npm run cloud-proxy-test
  ```
- Node-avhengigheter installert (`npm install`)
- `servfix_admin.tenant_integrations` må allerede være opprettet i miljøet via miljømigrasjonen for Fase 1a

---

## Steg 1 — Opprett databasen i Cloud SQL

Koble til Cloud SQL via proxy og opprett databasen:

```bash
psql -h localhost -p 5433 -U postgres -d postgres -c "CREATE DATABASE varing_db;"
```

Verifiser at databasen ble opprettet:

```bash
psql -h localhost -p 5433 -U postgres -d postgres -c "\l" | grep varing
```

---

## Steg 2 — Registrer tenant i servfix_admin

```bash
psql -h localhost -p 5433 -U postgres -d servfix_admin
```

```sql
INSERT INTO tenants (id, name, database_name, is_active)
VALUES ('varingtest', 'Varing Test', 'varing_db', true);
```

Verifiser:

```sql
SELECT id, name, database_name, is_active FROM tenants WHERE id = 'varingtest';
```

---

## Steg 3 — Kjør grunnleggende schema mot ny database

Migrasjonene (001–008) forutsetter at basistabellene allerede finnes. Kjør derfor `000-base-schema.sql` først:

```bash
psql -h localhost -p 5433 -U postgres -d varing_db -f migrations/000-base-schema.sql
```

Verifiser at tabellene ble opprettet:

```bash
psql -h localhost -p 5433 -U postgres -d varing_db -c "\dt"
```

Forventet output: 15+ tabeller inkludert `orders`, `technicians`, `equipment`, `service_reports` osv.

---

## Steg 4 — Kjør alle SQL-migrasjoner mot ny tenant

Migrasjonene er idempotente og bruker `--tenant=`-flagget for å kjøre mot én tenant:

```bash
node migrations/001-create-customers-tables.js --tenant=varingtest
node migrations/002-move-pdf-invoice-to-orders.js --tenant=varingtest
node migrations/003-orders-technician-nullable.js --tenant=varingtest
node migrations/004-orders-add-updated-at.js --tenant=varingtest
node migrations/006-create-recurring-orders.js --tenant=varingtest
```

> Migrasjonene 005, 007 og 008 oppdaterer GCS `settings.json` — se neste steg.

---

## Steg 5 — Opprett settings.json i GCS

Migrasjonene 005, 007 og 008 legger til modul-flagg og meny-defaults i GCS, men krever at `settings.json` finnes fra før. Opprett filen manuelt først:

```bash
echo '{
  "tenantId": "varingtest",
  "companyName": "Varing Test",
  "lastUpdated": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'"
}' > /tmp/settings.json

gsutil cp /tmp/settings.json gs://servfix-files-test/tenants/varingtest/assets/settings.json
```

Kjør deretter GCS-migrasjonene:

```bash
node migrations/005-add-module-flags-defaults.js --tenant=varingtest
node migrations/007-add-avansert-tab-defaults.js --tenant=varingtest
node migrations/008-add-app-menu-defaults.js --tenant=varingtest
```

Verifiser innholdet i GCS:

```bash
gsutil cat gs://servfix-files-test/tenants/varingtest/assets/settings.json
```

---

## Steg 6 — Opprett admin-bruker for tenanten

Rediger `scripts/create-admin-user.js` midlertidig, eller kjør SQL direkte:

```bash
psql -h localhost -p 5433 -U postgres -d servfix_admin
```

```sql
INSERT INTO admin_users (email, password_hash, name, tenant_id)
VALUES (
  'admin@varingtest.no',
  '<bcrypt-hash-av-ønsket-passord>',
  'Admin Varing',
  'varingtest'
);
```

For å generere en bcrypt-hash:

```bash
node -e "const b = require('bcryptjs'); b.hash('ValgfriPassord123!', 10).then(h => console.log(h))"
```

---

## Steg 7 — Konfigurer Tripletex for tenanten (valgfritt)

Hvis tenanten skal bruke Tripletex, opprett en per-tenant konfigurasjon i `servfix_admin.tenant_integrations`.

Anbefalt flyt:

1. Test credentials uten å lagre dem:
   ```bash
   curl -X POST "https://servfix-test-561535995501.europe-north1.run.app/api/admin/integrations/varingtest/tripletex/test" \
     -H "Content-Type: application/json" \
     -H "Cookie: <admin-session-cookie>" \
     -d '{
       "consumer_token": "...",
       "employee_token": "...",
       "base_url": "https://tripletex.no/v2"
     }'
   ```

2. Lagre credentials når testen er OK:
   ```bash
   curl -X POST "https://servfix-test-561535995501.europe-north1.run.app/api/admin/integrations/varingtest/tripletex" \
     -H "Content-Type: application/json" \
     -H "Cookie: <admin-session-cookie>" \
     -d '{
       "consumer_token": "...",
       "employee_token": "...",
       "base_url": "https://tripletex.no/v2"
     }'
   ```

3. Verifiser at raden finnes i `servfix_admin`:
   ```sql
   SELECT tenant_id, provider, is_active, config_version, updated_at
   FROM tenant_integrations
   WHERE tenant_id = 'varingtest' AND provider = 'tripletex';
   ```

Viktig:
- Credentials skal ligge i databasen per tenant, ikke som globale env-variabler.
- Den midlertidige env-fallbacken i Fase 1a finnes kun for zero-downtime migrering av eksisterende prod-tenant og skal ikke brukes ved onboarding av nye tenants.

---

## Steg 8 — Verifiser

1. Sjekk at tenanten er registrert:
   ```bash
   node check-tenants.js
   ```
   Forventet output inkluderer: `varingtest  Varing Test  varing_db`

2. Test at applikasjonen løser tenanten korrekt ved å sende en forespørsel med riktig `Host`-header:
   ```bash
   curl -H "Host: varingtest.servfix.no" https://servfix-app-561535995501.europe-north1.run.app/health
   ```

3. Logg inn på `https://varingtest.servfix.no` med admin-brukeren opprettet i steg 6.

4. Hvis Tripletex er konfigurert, test at import eller helse-endepunkt fungerer for tenanten.

---

## Produksjonsmiljø

Samme prosess, men bruk:

- Cloud SQL Proxy på port 5432: `npm run cloud-proxy`
- GCS bucket: `servfix-files` (ikke `servfix-files-test`)
- Cloud SQL instans: `servfix-production:europe-north1:servfix-db`

> Vær ekstra forsiktig i prod — kjør alltid `--dry-run` på migrasjonene først.

> I prod skal Tripletex credentials fortsatt lagres per tenant i `servfix_admin.tenant_integrations`, ikke som globale env-variabler for nye tenants.

---

## Feilsøking

| Problem | Mulig årsak | Løsning |
|---------|-------------|---------|
| `ECONNREFUSED` på port 5433 | Cloud SQL Proxy ikke kjørende | Kjør `npm run cloud-proxy-test` |
| `relation "orders" does not exist` | Basetabellene mangler i ny DB | Sjekk at databasen ble initialisert med grunnleggende schema |
| `tenant not found or inactive` (403) | Tenant-raden mangler eller `is_active = false` | Verifiser steg 2 |
| GCS-migrasjon: `settings.json finnes ikke` | Filen ble ikke opprettet i steg 5 | Kjør `gsutil cp`-steget på nytt |
| `INTEGRATION_NOT_CONFIGURED` ved Tripletex-kall | Tenant mangler rad i `servfix_admin.tenant_integrations` | Kjør steg 7 og test/lagre Tripletex-konfigurasjonen |
