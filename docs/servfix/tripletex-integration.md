# Tripletex Integration

## Purpose
Integrates with Tripletex as a read-only customer master data source. Customers, addresses, and contacts are imported from Tripletex and cached locally in PostgreSQL. ServFix does not write data back to Tripletex — invoicing is tracked locally but not synced.

## Scope
**Included:**
- Authentication (consumer token + employee token → session token)
- Customer import (full, preview, selective)
- Address and contact resolution
- Servfixmail contact management (report recipients for billing)
- Project listing from Tripletex
- Local invoice tracking (marking reports as invoiced)
- Contact import per customer (import all Tripletex contacts for a specific customer)

**Not included:**
- Order sync from Tripletex (field `tripletex_order_id` exists but is unused)
- Write-back to Tripletex (no invoice creation, no customer updates)
- Payment processing
- Tripletex webhooks or real-time sync

## Main rules
- Tripletex is read-only. ServFix never creates or modifies data in Tripletex.
- All Tripletex credentials must come from environment variables — never hardcoded.
- Customer data is imported and stored locally. After import, all app logic uses local data only.
- The `servfixmail` contact (Tripletex contact with `lastName='servfixmail'`) determines where service reports are emailed for billing.
- All queries must use `db.getTenantConnection(tenantId)` — Tripletex credentials are shared, but data storage is tenant-isolated.
- Local customer edits (where `updated_at > created_at`) are protected from being overwritten during re-import.

## Authentication

```
Consumer Token + Employee Token (from .env)
        ↓
PUT /token/session/:create
        ↓
Session Token (valid until Dec 31 of current year)
        ↓
Basic Auth header: "Basic 0:{sessionToken}" (base64)
        ↓
All subsequent API calls
```

| Config | Env variable | Description |
|--------|-------------|-------------|
| Base URL | `BASE_URL` | `https://api-test.tripletex.tech/v2` (test) or `https://tripletex.no/v2` (prod) |
| Consumer token | `CONSUMER_TOKEN` | Identifies the application |
| Employee token | `EMPLOYEE_TOKEN` | Identifies the user/tenant |

**Token lifecycle:**
- Session token is cached in memory (service singleton).
- Expires at end of year (Dec 31).
- No automatic refresh — requires service restart if token expires early.

## Data flow

```
Tripletex API
    ↓ (read-only)
tripletexService.js — auth, customers, contacts, addresses
    ↓
customerImportService.js — import logic, upsert, servfixmail resolution
    ↓
Local DB (customers, customer_contacts tables)
    ↓
customerService.js — local CRUD layer used by all app logic
    ↓
Orders / Reports / Email — always use local data, never Tripletex directly
```

## Inputs

### Tripletex API endpoints used
| Method | Endpoint | Purpose |
|--------|----------|---------|
| PUT | `/token/session/:create` | Get session token |
| GET | `/customer` | List customers (paginated, 100/page) |
| GET | `/customer/{id}` | Get single customer |
| GET | `/address/{id}` | Get address details |
| GET | `/contact` | List contacts for customer |
| GET | `/project` | List open projects for customer |

### Local database tables

**`customers`:**
| Column | Type | Description |
|--------|------|-------------|
| `id` | PK | Local ID |
| `name` | VARCHAR | Company name |
| `organization_number` | VARCHAR | Org number |
| `customer_number` | VARCHAR | Customer number |
| `physical_address` | VARCHAR | Formatted from Tripletex address |
| `postal_address` | VARCHAR | Formatted from Tripletex address |
| `phone`, `email`, `invoice_email` | VARCHAR | Contact info |
| `external_source` | VARCHAR | Always `'tripletex'` for imported |
| `external_id` | VARCHAR | Tripletex customer ID |
| `notes` | TEXT | Local-only field |
| `is_active` | BOOLEAN | Active status |
| `created_at`, `updated_at` | TIMESTAMP | Tracking |

**`customer_contacts`:**
| Column | Type | Description |
|--------|------|-------------|
| `customer_id` | FK | Links to local customer |
| `name`, `email`, `phone` | VARCHAR | Contact info |
| `role` | VARCHAR | Contact role |
| `is_report_recipient` | BOOLEAN | True for servfixmail contacts only — **not** set automatically during contact import |

## Contact import per customer

Contacts for a specific customer can be imported from Tripletex on demand via the admin customer page (`/admin/kunder.html`).

**Endpoint:** `POST /api/admin/customers/:customerId/contacts/import-from-tripletex`

**Behavior:**
- Fetches all contacts from Tripletex for the given customer (`GET /contact?customerId={externalId}`)
- For each contact: upserts into `customer_contacts` using `(customer_id, email)` as the unique key
- New contacts are inserted with `is_report_recipient = false` — this is never set automatically during import
- Existing contacts with the same email are updated (name, phone, role)
- Returns `{ imported: N }` where N is the count of inserted/updated contacts

**Important rules:**
- `is_report_recipient` is **never** automatically set during contact import. Admins must set it manually after import if needed.
- The servfixmail contact (`lastName='servfixmail'`) is resolved separately during the full customer import flow — it is not part of per-customer contact import.
- Import is idempotent: re-running does not create duplicates.

## Outputs

### Import results
| Import type | Endpoint | Returns |
|-------------|----------|---------|
| Preview | `POST /api/admin/customers/import/preview` | `{ new: [...], updated: [...], unchanged: [...] }` |
| Full import | `POST /api/admin/customers/import` | `{ imported: N, errors: [...] }` |
| Selective | `POST /api/admin/customers/import/apply` | `{ applied: N, errors: [...] }` |

### Invoice tracking (local only)
| Column | Table | Description |
|--------|-------|-------------|
| `sent_til_fakturering` | `service_reports` | Report sent to customer |
| `is_invoiced` | `service_reports` | Marked as invoiced |
| `invoice_number` | `service_reports` | Invoice number for tracking |
| `invoice_date` | `service_reports` | When invoice was created |
| `invoice_comment` | `service_reports` | Optional billing note |
| `pdf_sent_timestamp` | `service_reports` | When PDF was emailed |

## Import workflow (detailed)

```
1. PREVIEW (fast, no address lookups)
   ├─ Fetch all customers from Tripletex (paginated)
   ├─ Compare with local DB by external_id
   └─ Return: new, updated, unchanged counts

2. FULL IMPORT (slow, with address lookups)
   ├─ Re-fetch all customers from Tripletex
   ├─ For each customer (batches of 5):
   │  ├─ Fetch physical + postal addresses in parallel
   │  ├─ Find servfixmail contact (lastName='servfixmail')
   │  └─ UPSERT to local DB (external_source='tripletex', external_id=tripletexId)
   └─ Skip customers where updated_at > created_at (local edits protected)

3. SELECTIVE IMPORT
   ├─ Apply only user-selected customers from preview
   ├─ Same address/contact resolution as full import
   └─ Reset updated_at=created_at for applied updates (allows future re-import)
```

## Failure cases

| Failure | Behavior |
|---------|----------|
| Invalid consumer/employee tokens | Session token request fails, 401 returned |
| Session token expired | All API calls fail until service restart |
| Tripletex API unreachable | Import fails, local data preserved unchanged |
| Address lookup fails for a customer | Silently returns null, import continues without address |
| Contact lookup fails for a customer | Silently returns empty array, import continues |
| Rate limiting from Tripletex | No handling — batch size of 5 is the only mitigation |
| Duplicate external_id on import | UPSERT handles it (ON CONFLICT UPDATE) |
| Customer has no servfixmail contact | No report recipient set, email send will need manual recipient |
| Health check fails | `GET /api/customers/health` returns error details for debugging |

## Critical invariants (must not be broken)
- Tripletex is read-only. ServFix must never create, update, or delete data in Tripletex via API.
- Runtime operations in ServFix must continue to work when Tripletex is unavailable, as long as required customer data has already been imported locally.
- Local customer edits must not be overwritten by import unless the user explicitly selects the customer for re-import.
- A customer can have multiple `is_report_recipient = true` contacts. All of them receive the service report email. The flag is admin-controlled only — never set automatically during import.
- Missing servfixmail contact must not block customer import — it only affects automatic billing recipient resolution.
- Contact import (`import-from-tripletex`) must never automatically set `is_report_recipient = true`. That flag is admin-controlled only.
- After import, all application logic must use local database data — never call Tripletex API for runtime operations. New features must not introduce direct Tripletex API calls into order, report, or technician runtime flows unless explicitly approved by design.
- Imported Tripletex data must only be written to the current tenant's local database and must never become visible across tenants.
- Re-running the same import must be idempotent — it must not create duplicate customers, contacts, or inconsistent local state.
- Invoice tracking is local only. The `is_invoiced` and `invoice_number` fields are for internal tracking, not synced to any external system.
- Session tokens must never be logged or exposed in API responses.

## Change strategy
When modifying Tripletex integration:
1. Identify whether the change affects authentication, import, or local data usage.
2. Never add write operations to Tripletex without explicit business decision.
3. Test import with edge cases: customers without addresses, without contacts, with local edits.
4. Verify that batch processing stays within rate limits (currently 5 concurrent).
5. Ensure local customer edits are still protected after the change.
6. Test session token lifecycle (creation, caching, expiry).
7. Confirm servfixmail contact resolution still works correctly.
8. Check that all downstream features (orders, reports, email) still use local data.

## Test scenarios
Critical scenarios to cover:
- Full import with mix of new, updated, and unchanged customers.
- Import where some customers have no addresses (must not fail).
- Import where servfixmail contact exists vs doesn't exist.
- Import with locally edited customers (must not overwrite).
- Selective import of specific customers only.
- Session token creation with valid credentials.
- Session token creation with invalid credentials (must fail gracefully).
- Health check endpoint when Tripletex is reachable vs unreachable.
- Concurrent import requests (must not create duplicates).
- Email send to report recipient when servfixmail contact is missing.

## Definition of done
A Tripletex integration change is considered complete when:
- Authentication flow works correctly (token creation, caching, usage).
- Import correctly handles new, updated, unchanged, and locally-edited customers.
- Servfixmail contact resolution produces correct report recipients (all contacts with `is_report_recipient = true`).
- No write operations are added to Tripletex.
- Local data integrity is preserved (no overwrites of local edits).
- All downstream features still use local data correctly.
- Import can be run repeatedly without creating duplicate local records or breaking local edit protection.

## Notes
- The `tripletex_order_id` column on orders exists but is unused — orders are not synced from Tripletex.
- There are two Tripletex client files: `src/services/tripletexService.js` (active) and `services/tripletex-api.js` (legacy). Only the former is used.
- Session token is cached in memory as a singleton. Service restart required if token expires or credentials change.
- Address lookups during import are N+1 (one API call per customer per address type). This is a known inefficiency.
- No retry logic exists for Tripletex API calls. Failures are immediate.
- Batch size of 5 during import is the only rate-limit mitigation. No exponential backoff.
- Invoice tracking is purely local bookkeeping — not connected to any accounting system.

### API endpoints

**Admin Customer API** (`/api/admin/customers`):

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | List all local customers |
| POST | `/import/preview` | Preview import from Tripletex |
| POST | `/import` | Full import from Tripletex |
| POST | `/import/apply` | Selective import of chosen customers |
| GET | `/:customerId/contact` | Get primary contact |
| GET | `/:customerId/servfixmail` | Get report recipient (servfixmail) |
| GET | `/:customerId/contacts` | List all contacts |
| POST | `/:customerId/contacts` | Create contact |
| PUT | `/:customerId/contacts/:contactId` | Update contact |
| DELETE | `/:customerId/contacts/:contactId` | Delete contact |
| POST | `/:customerId/contacts/import-from-tripletex` | Import all Tripletex contacts for customer |
| GET | `/:customerId/projects` | List open Tripletex projects |

**Technician Customer API** (`/api/customers`):

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Test Tripletex connection |
| GET | `/:customerId/addresses` | Get customer addresses |
| GET | `/:customerId/projects` | List open Tripletex projects |
| PUT | `/:customerId/notes` | Update local customer notes |

**Admin Reports/Billing API** (`/api/admin/reports`):

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/order/:orderId/send` | Send all reports for order to customer |
| PUT | `/order/:orderId/invoice` | Mark all reports as invoiced |
| POST | `/:reportId/mark-invoiced` | Mark single report invoiced |
