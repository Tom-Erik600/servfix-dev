# Order Lifecycle

## Purpose
Manages the full lifecycle of service orders — from creation and technician assignment through equipment servicing to completion with PDF generation. Orders are the central entity that ties together customers, equipment, service reports, quotes, and billing.

## Scope
**Included:**
- Order creation (admin and technician paths)
- Technician assignment and scheduling
- Equipment selection per order
- Order completion with transactional PDF generation
- Service report linkage and status tracking
- Quote association (optional)
- Email triggers on report delivery

**Not included:**
- Checklist validation details (see checklist-validation.md)
- PDF generation internals (see pdf-report-generation.md)
- Tripletex customer sync (orders are NOT synced from Tripletex)
- Invoice creation in external systems

## Main rules
- All queries must use `db.getTenantConnection(tenantId)` — no cross-tenant access.
- Customer data is snapshotted as JSONB at order creation time. Changes in Tripletex do not retroactively update existing orders.
- Order completion must succeed even if PDF generation fails for individual reports.
- Equipment is linked to customers (via `customer_id`), not directly to orders. The `included_equipment_ids` JSONB array controls which equipment is part of a specific order.
- Technician assignment is nullable. Orders without a technician use status `pending` and can be claimed by technicians from the available-orders pool.
- Order IDs follow the format `PROJ-{YYYY}-{timestamp}`.

## Status transitions

```
pending ──────→ scheduled ──────→ completed
  │                │
  │  (assign       │  (POST
  │  technician)   │  /:orderId/
  │                │  complete)
  └────────────────┘
```

| Status | Meaning | Set when |
|--------|---------|----------|
| `pending` | Created by admin, no technician assigned | Admin POST without technicianId |
| `scheduled` | Technician assigned, date set | Admin/tech POST with technicianId, or technician assigned later |
| `completed` | All work done, PDFs generated | POST `/:orderId/complete` |

**Rules:**
- `pending` → `scheduled`: Technician is assigned by admin update, drag/drop, or technician claim.
- `scheduled` → `completed`: Completion endpoint called. Irreversible.
- No status can be skipped. No reverse transitions.

## Available Orders / Pool Claim

Admin can create unassigned orders by using the `Felles`/pool technician in the admin planner. These orders have `technician_id = null`, status `pending`, and appear in the technician app as `Ledige oppdrag`.

Technicians fetch available orders with a range filter:

```http
GET /api/orders/available?range=today|tomorrow|week|month
```

The backend returns pending orders where `technician_id IS NULL` and `scheduled_date` is either null or inside the selected range. The technician app always fetches the month range for calendar indicators, then filters client-side for the visible list. Pool orders are marked with a gray dot in the calendar.

Technicians claim an available order with:

```http
POST /api/orders/:id/claim
```

The claim is atomic:

```sql
UPDATE orders
   SET technician_id = $1,
       status = 'scheduled',
       updated_at = NOW()
 WHERE id = $2
   AND technician_id IS NULL
```

If no row is updated, the API returns `409` because another technician already claimed the order.

## Inputs

### Order creation
| Field | Type | Required | Source |
|-------|------|----------|--------|
| `customer_id` | INTEGER | Yes | Tripletex or local |
| `customer_name` | VARCHAR | Yes | From customer data |
| `customer_data` | JSONB | Yes | Snapshot at creation (name, email, phone, addresses, contact person) |
| `customer_data.agreement_number` | STRING | No | Set when a Tripletex project is selected (from project number) |
| `customer_data.visit_number` | STRING | No | Optional visit number entered by admin at order creation |
| `description` | TEXT | No | Admin/technician input |
| `service_type` | VARCHAR | No | Service category |
| `technician_id` | VARCHAR | No | Assigned technician (determines pending vs scheduled) |
| `scheduled_date` | DATE | No | Planned service date |
| `scheduled_time` | TIME | No | Planned service time |
| `included_equipment_ids` | JSONB | No | Array of selected equipment IDs |

### Completion request
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `includedEquipmentIds` | Array | No | Filter which equipment reports to generate PDFs for. If omitted, all reports are included. |

## Outputs

### Order completion response
```json
{
  "success": true,
  "orderId": "PROJ-2026-1710934200000",
  "message": "Ordre ferdigstilt med 3 servicerapporter",
  "generatedPDFs": [
    {
      "reportId": "SR-123",
      "equipmentType": "boligventilasjon",
      "equipmentName": "Ventilasjon 1. etg",
      "pdfPath": "tenants/{tenantId}/service-reports/2026/03/..."
    }
  ],
  "includedEquipmentCount": 3
}
```

### Database updates on completion
| Table | Column | Update |
|-------|--------|--------|
| `orders` | `status` | Set to `completed` |
| `service_reports` | `pdf_path` | GCS path to generated PDF |
| `service_reports` | `pdf_generated` | Set to `true` |

### Email triggers
| Event | Trigger | Recipient |
|-------|---------|-----------|
| Report sent to customer | Manual send after completion | Customer contact email |
| Report sent to billing | Manual `send-til-fakturering` | Tripletex servfixmail contact |
| Quote sent to customer | Manual send | Customer email |

## Completion workflow (detailed)

```
1. COMMIT ORDER STATUS (must complete first)
   ├─ Verify order exists
   ├─ UPDATE orders SET status = 'completed'
   └─ COMMIT — order status change is persisted before any external calls

2. FETCH SERVICE REPORTS
   ├─ SELECT sr.*, e.* FROM service_reports sr
   │  JOIN equipment e ON sr.equipment_id = e.id
   │  WHERE sr.order_id = $1
   └─ Filter by includedEquipmentIds if provided

3. GENERATE PDFs (best-effort, after commit)
   ├─ Initialize UnifiedPDFGenerator
   ├─ generateReport(reportId, tenantId)
   ├─ Upload to GCS
   └─ Continue even if individual PDFs fail

4. RETURN RESULT
   └─ Success with generated PDFs list (partial results on failures)
```

**Note:** The current implementation runs PDF generation inside the transaction. The ideal model is to commit order status first, then generate PDFs as a side effect. This should be considered for future refactoring.

## Failure cases

| Failure | Behavior |
|---------|----------|
| Order not found | 404 returned |
| No technician assigned on completion | Completion still proceeds (no guard) |
| Individual PDF generation fails | Error logged, other PDFs still generated, order still completes |
| GCS upload fails for a report | PDF not stored, `pdf_generated` stays false for that report |
| Database transaction fails | Rolls back, order status unchanged |
| Concurrent completion calls | First wins, second sees already-completed order |
| Concurrent claim calls for available order | First atomic update wins; later request returns `409` |
| Duplicate completion request | Must return success without duplicating side effects (idempotent) |
| Missing customer_data on creation | Falls back to minimal data (name only) |
| Equipment has no service report | Skipped during PDF generation (no error) |

## Critical invariants (must not be broken)
- Order data must never contain or reference another tenant's customers, equipment, or reports.
- Order completion is logically independent of PDF generation — PDF generation is a side effect, not part of the core transaction. Order status must commit before PDFs are generated.
- Database transactions must not remain open during long-running PDF generation or external calls (Puppeteer, GCS).
- Customer data snapshot in `customer_data` JSONB must not be modified after order creation. This includes sub-fields like `agreement_number` and `visit_number` — these can only be corrected via the "rediger PDF"-modal in the reports view, which edits the service report data, not the order itself.
- All external communication (PDF, email, billing) must use the stored `customer_data` snapshot, not live customer data.
- The `included_equipment_ids` array must be the single source of truth for which equipment belongs to an order. Service reports generated for an order must correspond only to equipment in this array.
- Technician order detail (`orders.html`) must, when `included_equipment_ids` is present, show only the selected equipment for that order rather than all customer equipment.
- Service report status must be independent of order status — a report can be `completed` before the order is.
- Order status transitions are one-way: `pending` → `scheduled` → `completed`. No reversals.
- Claiming an available order must remain atomic and guarded by `technician_id IS NULL`.
- Completing the same order multiple times must be idempotent — it must not duplicate side effects or corrupt state.

## Change strategy
When modifying the order lifecycle:
1. Identify which phase is affected (creation, assignment, completion, post-completion).
2. Check if the change impacts the completion transaction — this is the most critical path.
3. Verify tenant isolation in all queries.
4. Ensure PDF generation remains non-blocking for order completion.
5. Test with orders that have 0, 1, and many equipment items.
6. Confirm `customer_data` snapshot is not mutated by the change.
7. Validate that admin and technician creation paths both still work.
8. Check downstream effects on email, billing, and PDF delivery.

## Test scenarios
Critical scenarios to cover:
- Create order as admin without technician (must get status `pending`).
- Create order as technician (must get status `scheduled`).
- Assign technician to pending order (must transition to `scheduled`).
- Fetch available orders with `today`, `tomorrow`, `week`, and `month` range filters.
- Claim available order as technician (must set `technician_id`, status `scheduled`, and `updated_at`).
- Claim already-claimed order concurrently (must return `409`).
- Complete order with all service reports finished (happy path).
- Complete order where one PDF fails (order must still complete, partial results returned).
- Complete order with `includedEquipmentIds` filter (only selected equipment gets PDFs).
- Complete order with no service reports (must succeed with empty PDFs list).
- Concurrent completion of same order (must not corrupt data).
- Duplicate completion request (must be idempotent — no duplicated PDFs or state changes).
- Verify customer_data snapshot is preserved after Tripletex customer update.
- Verify PDF and email use stored customer_data snapshot, not live Tripletex data.

## Definition of done
An order lifecycle change is considered complete when:
- Order status transitions work correctly for all paths (admin, technician).
- Completion transaction is atomic — status update commits even if PDFs fail.
- No critical invariants are violated.
- Equipment selection filtering works correctly.
- All API endpoints return expected response shapes.
- Admin and technician frontends both reflect the change correctly.

## Notes
- Tripletex integration is read-only for customers. Orders are NOT synced from Tripletex despite a table comment suggesting otherwise.
- The `in_progress` status appears in frontend filter code (planlegger.js) but is never explicitly set in backend code.
- Quotes are optional and independent — order completion does not require an approved quote.
- The admin planlegger uses drag-drop to assign technicians. Dragging the `Felles`/pool card creates an unassigned order instead.
- `sent_til_fakturering` on service reports tracks whether the report has been forwarded for billing.

### API endpoints

**Technician API** (`/api/orders`):

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | List orders for logged-in technician |
| GET | `/today` | Orders scheduled for today |
| GET | `/available?range=today|tomorrow|week|month` | Available unassigned orders for technician claim |
| GET | `/all` | All orders (search page) |
| GET | `/:id` | Order detail with equipment and service status |
| PUT | `/:id` | Update order (technician assignment, details) |
| POST | `/` | Create new order |
| POST | `/:id/claim` | Atomically claim available unassigned order |
| POST | `/:orderId/complete` | Complete order + generate PDFs |
| PATCH | `/:orderId/equipment` | Update included equipment selection |
| GET | `/:id/reports` | List service reports for order |
| POST | `/:id/regenerate-reports` | Regenerate PDFs for completed order |
| GET | `/service-report/:reportId/preview` | PDF preview (in-memory) |

**Admin API** (`/api/admin/orders`):

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | List all orders (filters: dateFrom, dateTo, status) |
| POST | `/` | Create new order |

**Admin Reports API** (`/api/admin/reports`):

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | All completed reports grouped by order |
| GET | `/:reportId/pdf` | Download PDF |
