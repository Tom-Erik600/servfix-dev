# Checklist Validation

## Purpose
Captures structured service data per equipment through dynamic checklists. Technicians fill in status checks, measurements, products used, and discrepancies (avvik) during field work. This data feeds directly into service report PDFs and billing.

## Scope
**Included:**
- Checklist templates per equipment type (boligventilasjon, ventilasjonsaggregat, vifter, custom)
- Dynamic checklist rendering based on template input types
- Status capture (OK / Avvik / Byttet) with comments and photos
- Numeric and text field capture (temperatures, measurements)
- Products used and additional work line items
- Component-level save and report-level completion
- Avvik (discrepancy) handling with images
- Checklist instructions per template item

**Not included:**
- PDF generation (handled by unifiedPdfGenerator.js, see pdf-report-generation.md)
- Email delivery of reports (handled by emailService.js)
- Equipment master data management

## Main rules
- All checklist data is stored as JSONB in `service_reports.checklist_data` — no separate row-per-item tables.
- Templates are tenant-scoped. All queries must use `db.getTenantConnection(tenantId)`.
- Each checklist response must store the item `label` alongside the value for historical accuracy in PDFs.
- Photos must be preserved across partial updates — never clear photos unless explicitly modified.
- The `custom` equipment type uses free-text description only, not structured checklist items.
- Frontend validation is required before save (systemnummer + plassering for non-custom types).
- Report status transitions: `not_started` → `in_progress` → `completed`. No skipping or reversing.

## Inputs

### Checklist templates (`checklist_templates` table)
| Field | Type | Description |
|-------|------|-------------|
| `name` | VARCHAR | Template name |
| `equipment_type` | VARCHAR | Links to equipment type |
| `template_data` | JSONB | System fields + checklist items definition |
| `is_active` | BOOLEAN | Whether template is in use |

### Template item input types
| Input type | UI control | Value stored |
|------------|-----------|--------------|
| `ok_avvik` | Status buttons (OK/Avvik) | `{ status: "ok" }` or `{ status: "avvik", avvikComment: "..." }` |
| `ok_avvik_comment` | Status buttons + required comment | Same as above, comment required |
| `dropdown_ok_avvik` | Dropdown + status | Status + comment |
| `switch_select` | Dropdown (AUTO/Sommer/Vinter/AV/PÅ) | Selected option string |
| `numeric` | Number input | `{ temperature: 25 }` or `{ value: "2.3" }` |
| `text` | Text input | Free-text string |
| `textarea` | Multi-line text | Free-text string |
| `tilstandsgrad_dropdown` | Risk grade dropdown | Grade value |
| `konsekvensgrad_dropdown` | Risk grade dropdown | Grade value |

### Checklist instructions (`checklist_instructions` table)
- Per-item guidance text for technicians
- Keyed by `(template_name, checklist_item_id)`

## Outputs

### Stored in `service_reports` table
| Column | Type | Content |
|--------|------|---------|
| `checklist_data` | JSONB | `{ checklist: {...}, systemData: {...}, driftSchedule: {...}, metadata: {...} }` |
| `products_used` | JSONB | Array of `{ name, price }` |
| `additional_work` | JSONB | Array of `{ description, hours, price }` |
| `photos` | TEXT[] | Array of GCS URLs |
| `status` | VARCHAR | `not_started`, `in_progress`, `completed` |

### Stored in `avvik_images` table
| Column | Type | Content |
|--------|------|---------|
| `service_report_id` | FK | Links to service report |
| `checklist_item_id` | FK | Links to template item |
| `image_url` | TEXT | GCS URL |
| `metadata` | JSONB | Description, timestamp |

### Data transformation on save
Frontend `reportData` is split by `splitReportDataForDB()`:
- `reportData.checklist` → `checklist_data.checklist`
- `reportData.systemFields` → `checklist_data.systemData`
- `reportData.products` → `products_used`
- `reportData.additionalWork` → `additional_work`

## Failure cases

| Failure | Behavior |
|---------|----------|
| Missing systemnummer or plassering (non-custom) | Frontend blocks save with validation error |
| Missing description (custom type) | Frontend blocks save with validation error |
| Incomplete checklist items on finalize | Frontend blocks completion — all items must have values |
| Network error during save | Frontend shows error, data remains in form (not lost) |
| Invalid JSONB structure on backend | PostgreSQL rejects insert/update, 500 returned |
| Concurrent edits to same report | Last write wins — no optimistic locking |
| Missing template for equipment type | Checklist cannot render, user sees empty form |
| Photos upload fails | Photo not added to array, report save still succeeds |

## Critical invariants (must not be broken)
- Checklist data must never contain data from another tenant's template or report.
- A report must not transition to `completed` unless all checklist items have valid responses.
- Saved checklist labels must match the template at save time — used for PDF rendering even if template changes later.
- Products and additional work arrays must not be cleared on partial checklist updates.
- Avvik images must be linked to both the report and the specific checklist item.
- The `custom` type must never attempt to load or validate against a structured template.
- Checklist data must remain compatible with PDF generation — changes to JSONB structure must not break existing PDF rendering logic.
- Partial updates must merge with existing `checklist_data`, not replace the entire object unless explicitly intended.
- Concurrent updates must not corrupt `checklist_data` structure or remove existing valid data unintentionally.

## Change strategy
When modifying checklist validation:
1. Identify whether the change affects templates, frontend rendering, save logic, or completion validation.
2. Check if the change impacts the JSONB structure in `checklist_data` — this flows into PDF generation.
3. Verify tenant isolation is preserved in all database queries.
4. Ensure frontend validation rules match what the backend and PDF generator expect.
5. Test with all equipment types (boligventilasjon, ventilasjonsaggregat, vifter, custom).
6. Confirm avvik flow still works end-to-end (status → comment → photo → PDF).
7. Do not change the `splitReportDataForDB()` mapping without updating both frontend and PDF generator.

## Test scenarios
Critical scenarios to cover:
- Save checklist with all items filled (happy path for each equipment type).
- Save checklist with avvik status + comment + photo on multiple items.
- Attempt to finalize report with incomplete checklist items (must be blocked).
- Save partial update — verify products and photos are not cleared.
- Render checklist for equipment type with no active template (must handle gracefully).
- Save checklist for custom equipment type (free-text only, no structured validation).
- Concurrent saves to the same report from different tabs (last write wins behavior).
- Generate PDF from saved checklist data — verify labels and values match.

## Definition of done
A checklist validation change is considered complete when:
- All required fields are correctly validated before save and completion.
- No critical invariants are violated.
- Checklist data is correctly stored in JSONB format.
- Partial updates do not overwrite existing data unintentionally.
- Avvik flow (status → comment → photo → PDF) works end-to-end.
- Data renders correctly in PDF generation.
- Behavior is consistent across all equipment types (including custom).

## Notes
- There is currently no server-side validation of checklist responses against the template schema. All validation is frontend-only.
- No value range validation exists for numeric fields (e.g., temperature bounds).
- The JSONB storage strategy allows adding new fields without migrations but requires careful backward compatibility.
- `service.js` (v9.3) in the tech frontend is the primary checklist UI — vanilla JavaScript with global `state` object.
- Metadata in `checklist_data` tracks version and save timestamp for debugging.
- Backend validation should be considered for critical fields to prevent invalid data from bypassing frontend validation.

### API endpoints
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/checklist-templates` | Fetch all templates for tenant |
| POST | `/checklist-templates` | Save/update templates (admin) |
| GET | `/checklist-instructions/:templateName/:itemId` | Get instruction for item |
| GET | `/checklist-instructions/:templateName` | Get all instructions for template |
| POST | `/checklist-instructions/:templateName/:itemId` | Save/update instruction |
| DELETE | `/checklist-instructions/:templateName/:itemId` | Delete instruction |
| GET | `/servicereports/equipment/:equipmentId?orderId=X` | Get report for equipment |
| POST | `/servicereports` | Create new report |
| PUT | `/servicereports/:reportId` | Update report with checklist data |
| POST | `/servicereports/:reportId/complete` | Mark report as completed |
| POST | `/servicereports/:reportId/photos` | Add photos to report |
