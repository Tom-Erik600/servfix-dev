# Equipment Filters

## Purpose
Tracks whether a piece of equipment has filters, and which filter types are present. Used by technicians to identify filter maintenance tasks before visiting a customer, and shown in service reports for documentation.

## Scope
**Included:**
- Filter flag and filter type configuration per equipment item
- Admin UI for setting filter properties (kunder.html equipment modal)
- Technician app display (filter badges on equipment cards, filter info in anlegg-info grid)
- API read/write for both admin and technician routes

**Not included:**
- Filter replacement history or service intervals
- Filter part numbers or specifications
- Checklist items related to filter service (those are in service templates)

## Data model

### Database columns (`equipment` table)

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `has_filters` | BOOLEAN | `false` | Master flag — equipment has at least one filter |
| `filter_supply` | BOOLEAN | `false` | Tilluft-filter (supply air filter) |
| `filter_exhaust` | BOOLEAN | `false` | Avtrekk-filter (exhaust air filter) |
| `filter_drive_supply` | BOOLEAN | `false` | Aggregat tilluft-filter (drive-side supply filter) |
| `filter_drive_exhaust` | BOOLEAN | `false` | Aggregat avtrekk-filter (drive-side exhaust filter) |

**Rule:** `filter_supply`, `filter_exhaust`, `filter_drive_supply`, and `filter_drive_exhaust` are only meaningful when `has_filters = true`. The admin UI enforces this by hiding the type checkboxes unless "Har filtre" is checked. The backend does not enforce it — the frontend is the sole guard.

### Migration
`database/equipment_filters_migration.sql` — idempotent, run on all tenant databases.

## Admin UI (`/admin/kunder.html`)

- Checkbox "Har filtre" controls `has_filters`
- When checked, four sub-checkboxes appear:
  - Tilluft
  - Avtrekk
  - Aggregat tilluft
  - Aggregat avtrekk
- When "Har filtre" is unchecked, sub-checkboxes are hidden (but not reset in DB — unchecking `has_filters` is the only meaningful state change)
- Filter fields appear in both the "Opprett anlegg" and "Rediger anlegg" modals

## Technician app display

### Equipment cards (`orders.html`)
- Equipment with `has_filters = true` gets an amber badge listing active filter types
- Format: `🔧 Filter: Tilluft, Avtrekk` (only active types shown)
- Badge is omitted entirely if `has_filters = false` or no types are active

### Anlegg-info grid (`service.html`)
- Filter row shown in the equipment info section when `has_filters = true`
- Lists active filter types as comma-separated text

## API

### Admin routes (`/api/admin/equipment`)
Filter fields included in GET (list + single), POST (create), and PUT (update) payloads.

### Technician routes (`/api/equipment`)
Filter fields included in GET (list + single), POST (create), and PUT (update) payloads.

**Request/response shape (both routes):**
```json
{
  "hasFilters": true,
  "filterSupply": true,
  "filterExhaust": false,
  "filterDriveSupply": false,
  "filterDriveExhaust": true
}
```
Note: camelCase in JSON payloads, snake_case in database columns.

## Critical invariants
- `has_filters` is the authoritative flag for whether an equipment item has any filter maintenance requirement. Display logic must check this flag first.
- Filter type fields have no meaning when `has_filters = false` — they must not be shown to technicians in that case.
- Filter state must not affect order lifecycle, PDF generation, or checklist validation — it is purely informational metadata.

## Files

| File | Role |
|------|------|
| `database/equipment_filters_migration.sql` | DB migration (already run) |
| `src/routes/admin/equipment.js` | Admin API — filter fields in GET/POST/PUT |
| `src/routes/equipment.js` | Technician API — filter fields in GET/POST/PUT |
| `public/admin/kunder.html` | Admin modal — filter checkboxes |
| `public/admin/assets/js/kunder.js` | Populate/save filter fields, toggle visibility |
| `public/app/assets/js/orders.js` | Amber filter badges on equipment cards |
| `public/app/assets/js/service.js` | Filter types in anlegg-info grid |
