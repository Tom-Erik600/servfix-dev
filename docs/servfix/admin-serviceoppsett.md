# Admin Service Setup

## Purpose
Documents how the admin page for service setup works, what data it controls, and how those choices affect the technician service flow.

This area is important because the UI looks simple, but it controls checklist structure, item identifiers, and instruction behavior used later in `service.html` / `service2.html`.

## Scope
**Included:**
- Admin configuration of service templates
- Checklist item structure and ordering
- System field configuration
- Instruction storage and display
- How admin data maps into technician service pages

**Not included:**
- Order completion rules
- PDF generation internals
- Service report validation rules beyond checklist structure

## Main concepts

### Template
A service template represents one equipment/facility type, for example `Ventilasjonsaggregat`.

In the code there are two important identifiers:
- `name`: human-readable template name, e.g. `Ventilasjonsaggregat`
- `id` / `equipment_type`: machine identifier, e.g. `ventilasjonsaggregat`

Both may appear in the system. Instruction lookups should therefore tolerate both forms.

### Checklist item
Each checklist row has at least:
- `id`: stable machine key used by the application
- `label`: visible text shown to admins and technicians
- `inputType`: controls rendering (`ok_avvik`, `dropdown_ok_avvik`, `temperature`, etc.)

Important rule:
- Instructions are linked to `template + checklist item id`, not to the visible label.

That means:
- changing a label does **not** change the instruction binding
- two items can have similar labels but still be different rows if their `id` differs

## Data flow

### Admin side
The admin page is `public/admin/serviceoppsett.html` with logic in `public/admin/assets/js/serviceoppsett.js`.

Admin does the following:
- loads templates from `/api/checklist-templates`
- renders checklist items from template JSON
- stores instruction text through `/api/checklist-instructions/:templateName/:itemId`

### Technician side
The technician pages use the same template structure when rendering checklist rows.

Relevant files:
- `public/app/assets/js/service.js`
- `public/app/service.html`
- `public/app/service2.html`

The technician UI:
- loads the active template
- renders checklist rows using each item's `id`
- fetches instructions for the active template
- shows an instruction indicator only if a stored instruction matches the rendered item's `id`

## Instruction rules

### Source of truth
Instructions are stored in `checklist_instructions` with:
- `template_name`
- `checklist_item_id`
- `instruction_text`

### Matching behavior
An instruction is considered attached only when both match:
- the active template identifier
- the checklist item's exact `id`

### Practical consequence
If an instruction exists in the database but is not shown in the technician app, the most likely causes are:
- wrong template identifier (`name` vs `id` / `equipment_type`)
- wrong `checklist_item_id`
- label changed, but item `id` stayed the same and expectations followed the label instead of the id

## Critical invariants
- Checklist item `id` must be treated as stable once used in production.
- Labels may change; `id` should not change casually.
- Instruction bindings must not depend on visible label text.
- Admin and technician flows must render the same effective item ids for the same template.
- Template lookups should tolerate both human name and machine id where legacy data exists.

## Best practices for admins
- Treat checklist item labels as display text only.
- Do not assume renaming a row moves or recreates its instruction.
- If a checklist point is logically new, prefer creating a new item intentionally instead of silently reusing an unrelated old id.
- When troubleshooting, verify the item's actual `id`, not just the visible label.

## Troubleshooting

### Symptom: instruction is visible in admin modal, but not marked after refresh
Likely causes:
- instruction state reload is reading the wrong template identifier
- frontend expects a different response shape than the API returns

### Symptom: instruction is saved, but not shown in `service.html`
Likely causes:
- technician page is using a different template identifier
- stored `checklist_item_id` does not match the row's rendered `item.id`

### Symptom: same label appears, but instruction still does not match
Likely cause:
- label matches, id does not

## Recommended verification steps
1. In admin, identify the checklist item's real `id`.
2. Confirm which template identifier is being used (`name` and `id/equipment_type`).
3. Verify the stored row in `checklist_instructions` matches that template and item id.
4. Confirm the technician page renders the same `data-item-id`.

## Files to know
- `public/admin/serviceoppsett.html`
- `public/admin/assets/js/serviceoppsett.js`
- `public/app/assets/js/service.js`
- `src/routes/checklist-templates.js`
- `src/routes/checklist-instructions.js`
