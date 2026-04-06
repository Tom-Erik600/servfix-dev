Queue service-date sourcing updated in src/routes/admin/reports.js.

Previous expression: MAX(sr.created_at) as last_service_date
New expression: o.scheduled_date as last_service_date

Updated PDF rendering in src/services/unifiedPdfGenerator.js to use effective service date for header/meta display.
Fallback chain: customer_data.service_date -> report.service_date -> empty string.
Caveat: date rendering is formatted as DD.MM.YYYY; date-only ISO strings are normalized without timezone drift.
Task 3: GET /api/admin/reports/:reportId/edit-data now returns serviceDate as YYYY-MM-DD via customer_data.service_date -> scheduled_date.
Task 5: PUT /api/admin/reports/:reportId/update-content now persists metadata.service_date into orders.customer_data via the existing metadata merge, without changing PDF regeneration.
Task 4: report edit modal now includes editable service date field (id: edit-service-date), prefilled from edit-data.serviceDate (fallback scheduledDate), and saved as metadata.service_date.
Task 5: update-content metadata merge is now guarded with object check before spreading, so metadata.service_date persists when provided and missing metadata no longer risks invalid spread.
Queue ordering adjusted to prioritize orders.scheduled_date DESC (NULLS LAST) with MAX(sr.created_at) as secondary tie-breaker.
