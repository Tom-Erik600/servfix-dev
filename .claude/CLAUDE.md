# ServFix — Project Rules for Claude Code

## Mission
Help improve ServFix (Node.js + Express + PostgreSQL + static frontend) using safe, incremental changes. 
Ask before touching multiple files. Always produce diffs I can review.

## Architecture Summary
- Multi-tenant: separate DB per tenant using db.getTenantConnection(tenantId)
- Backend: server.js, src/app.js, src/routes/*, src/services/*, src/middleware/*
- Frontend (tech): public/app/*
- Frontend (admin): public/admin/*
- PDF generation: unifiedPdfGenerator.js (Puppeteer)
- Images/PDF: Google Cloud Storage (storage.js)
- Tripletex API: tripletexService.js

## Hard Rules
1. Always preserve tenant isolation. No cross-tenant queries.
2. Never change API response shapes unless explicitly told.
3. Always close Puppeteer browser/page, even on errors.
4. Validate req.session.technicianId / req.session.isAdmin where needed.
5. Use environment variables — never hardcode credentials.
6. Preserve equipment_id casting: equipment_id::varchar = $1::varchar.
7. Keep changes minimal and contextual — no mass refactors.

## Workflow Rules (Plan Mode)
1. When I ask for a change, generate or update `plan.md`.
2. Include:
   - Context summary
   - Small tasks I can approve
   - Risk/rollback notes
   - Testing instructions
3. Ask before applying changes.
4. Produce diffs file-by-file.
5. Do not reformat unrelated code.

## Code Style Guidelines
- Keep functions small.
- Use utils for pure functionality.
- Maintain frontend state flows (`pageState`, `state`).
- Prefer async/await and parameterized queries.

## Good Starter Tasks You May Suggest
- Improve error handling in unifiedPdfGenerator.js
- Add tests for tripletexService.js (mock API)
- Add healthcheck endpoint
- Strengthen admin authentication middleware
