# PDF Report Generation

## Purpose
Generates professional PDF documents from application data (service reports, quotes, ROS risk assessments, SJA safety analyses) using Puppeteer. PDFs are used for customer delivery, email attachments, and regulatory documentation.

## Scope
**Included:**
- Service report PDFs (order completion, preview, regeneration, email)
- Quote PDFs (generate, download, send to customer)
- ROS risk assessment PDFs (5×5 risk matrix, before/after comparison)
- SJA job safety analysis PDFs (risks, measures, photos, signatures)
- Company branding (logo, header/footer from tenant settings)
- Image inlining (GCS photos converted to base64 data URIs)
- GCS upload and database state tracking

**Not included:**
- PDF viewing/rendering in browser (handled by frontend)
- Email sending logic (handled by emailService.js)
- File cleanup or expiration of old PDFs

## Main rules
- Puppeteer browser and page must always be closed in a `finally` block to prevent memory leaks in Cloud Run.
- All data access must use `db.getTenantConnection(tenantId)` — no cross-tenant queries.
- All images must be converted to base64 data URIs before rendering HTML. External URLs are not allowed in rendered content.
- GCS paths must be scoped: `tenants/{tenantId}/...`
- Quote PDFs must never be persisted to GCS unless explicitly changed by design. All other PDFs are stored in GCS.
- Puppeteer must run with `--no-sandbox`, `--disable-setuid-sandbox`, `--disable-dev-shm-usage`, `--disable-gpu`.
- Chromium path detection must handle Cloud Run (`/usr/bin/chromium`) and local (bundled Puppeteer) environments.

## Inputs

| Generator | Database tables | Other inputs |
|-----------|----------------|--------------|
| **Service Reports** (unifiedPdfGenerator.js) | `service_reports` JOIN `equipment` | Tenant settings JSON from GCS, photos from GCS |
| **Quotes** (quotePDFGenerator.js) | `quotes` JOIN `orders` | Tenant settings JSON from GCS |
| **ROS** (rosPdfGenerator.js) | `hms_ros` (form_data JSON with risk matrix) | Tenant settings JSON from GCS |
| **SJA** (sjaPdfGenerator.js) | `hms_sja` (risks, measures, photos) | Tenant settings JSON from GCS, photos from GCS |

**Tenant settings** loaded from `tenants/{tenantId}/assets/settings.json` in GCS:
- `companyInfo`: name, address, phone, email
- `logo`: URL to company logo image
- `reportSettings`: `largeAvvikImages` (bool), `reportHeadingColor` (hex string, default `#1d4ed8`), `reportHeadingTextColor` (hex string, default `#ffffff`)
- `quoteSettings`: forbeholdText (terms/conditions for quotes)

## Outputs

| Generator | GCS storage path | Database updates | Response type |
|-----------|-----------------|------------------|---------------|
| **Service Reports** | `tenants/{tenantId}/service-reports/{yyyy}/{mm}/{orderId}/servicerapport_{reportId}_{timestamp}.pdf` | `pdf_path`, `pdf_generated = true`, `pdf_sent_timestamp` | JSON or inline PDF |
| **Quotes** | Not stored in GCS | `status`, `sent_to_customer`, `sent_date` | JSON with buffer size, or email attachment |
| **ROS** | `tenants/{tenantId}/hms/ros/{yyyy}/{mm}/ros_{rosId}_{timestamp}.pdf` | `pdf_url` | JSON with `pdfUrl` |
| **SJA** | `tenants/{tenantId}/hms/sja/{yyyy}/{mm}/sja_{sjaId}_{timestamp}.pdf` | `pdf_url` | JSON with `pdfUrl` |

## Failure cases

| Failure | Behavior |
|---------|----------|
| Chromium not found | Throws error — tries `PUPPETEER_EXECUTABLE_PATH`, `/usr/bin/chromium`, then bundled Puppeteer |
| Browser not initialized | Throws `Error: Browser not initialized — call init() first` |
| Report/data not found | Throws `Error: Report not found: {reportId}` |
| GCS bucket not configured | Throws error on upload (bucket is `null` in dev without config) |
| Image fetch fails | Warning logged, PDF continues without the image (non-fatal) |
| Puppeteer page timeout | 45-second timeout with `waitUntil: networkidle0` |
| Browser close hangs | 10-second timeout with `Promise.race()`, then force kill |
| Bulk regeneration partial failure | Returns array of results — successful reports + error details per failed report |
| PDF generation during order completion fails | Error logged but does not block order completion |

## Critical invariants (must not be broken)
- A PDF must never be generated using data from another tenant.
- A PDF must always reflect the current state of the database at generation time.
- Service report PDFs must not be marked as generated (`pdf_generated = true`) unless upload to GCS succeeds.
- Order completion must not fail even if PDF generation fails.
- Missing images must never block PDF generation.
- All generated PDFs must be traceable via database fields (`pdf_path`, `pdf_url`, `pdf_generated`).

## Change strategy
When modifying PDF generation:
1. Identify which generator is affected (service report, quote, ROS, SJA).
2. Check relevant database tables and required fields.
3. Verify tenant isolation is preserved.
4. Ensure Puppeteer lifecycle (init → close) is intact.
5. Add or update tests if business rules are affected.
6. Validate GCS path and upload logic.
7. Ensure no breaking changes to existing PDF formats without explicit decision.

## Service report PDF structure (unifiedPdfGenerator.js)

A service report PDF is generated from one order, which may contain one or many equipment units (anlegg). The PDF is structured as follows:

### 1. Header
Customer name, order number, service date. Background color from `reportHeadingColor`.

### 2. Customer info table
Agreement number, technician, address, service address.

### 3. System overview (Systemoversikt)
Table listing all equipment units on the order: system type, system number, location (plassering), betjener.

### 4. Deviation table (Avvikstabell)
All deviations across all equipment units collected in one table: deviation ID, equipment name, system number, component, comment.
- **Images**: shown inline below each deviation row only if `largeAvvikImages = true` in tenant settings.

### 5. Checklist details — repeated per equipment unit
For each equipment unit (anlegg):
- Equipment name as heading (system number + name)
- System fields from template (e.g. model, serial number)
- Checklist table: Sjekkpunkt | Status | Merknad/Dokumentasjon
  - **Deviation images** (avvik_images): shown inline in the Merknad column on the correct checklist row. Always shown regardless of settings.
- Drift schedule (driftstider): start/stop per weekday, if registered
- Overall comment (`overallComment`) for this equipment unit, if present
- General equipment photos (`report.photos`) for this equipment unit, if present

### 6. Products used (Produkter brukt)
Shown once after all equipment sections. Name, quantity, price, total.

### 7. Additional work (Utførte tilleggsarbeider)
Shown once after all equipment sections. Description, hours, hourly rate, total.

### 8. Signature
Technician name, date, company sign-off.

## Image handling summary

| Image type | Source | Where shown | Condition |
|---|---|---|---|
| Deviation images | `avvik_images` table | Inline in checklist row (Merknad column) | Always |
| Deviation images (large) | `avvik_images` table | Below deviation row in avvik table | `largeAvvikImages = true` in settings |
| General equipment photos | `service_reports.photos` | Below comment, per equipment unit | Always, if present |

All images are converted to base64 data URIs before HTML rendering via `inlineAllImages()`. External URLs are never used in the rendered PDF.

## Test scenarios
Critical scenarios to cover:
- Generate PDF with all required data present.
- Generate PDF with missing optional images (should succeed with warnings).
- Generate PDF with missing required checklist data (should fail or handle gracefully).
- Generate PDF when GCS upload fails (must not mark as generated).
- Generate PDF in multi-tenant context (ensure strict isolation).
- Bulk regeneration with partial failures (must return per-report results).
- Order completion where PDF generation fails (order must still complete).
- Generate PDF with multiple equipment units — verify comment, photos, driftstider appear under each unit separately.
- Generate PDF with `largeAvvikImages = true` — verify images appear in avvik table.
- Generate PDF with `largeAvvikImages = false` — verify images do NOT appear in avvik table.
- Generate PDF with products and additional work — verify they appear only once after all equipment sections.

## Notes
- All four generators follow the same pattern: `init() → fetch data → process → inline images → generate HTML → render PDF → upload → update DB → close()`.
- `safePuppeteer.js` and `pdfDiagnostics.js` exist as utilities but are not actively used by the generators.
- GCS bucket defaults: `servfix-files` (prod), `servfix-files-test` (test/staging), disabled in dev.
- ROS PDFs include a color-coded 5×5 risk matrix with before/after risk reduction percentage.
- SJA PDFs embed photos from GCS as inline base64 images.
- Service report PDFs are auto-generated on order completion and can be bulk-regenerated.
- Service report heading ("Servicerapport: ...") uses `reportHeadingColor` as background color and `reportHeadingTextColor` as text color. Section headers ("Sjekkpunkter", "Avvik" etc.) use `reportHeadingColor` as text/border color only — no background.
