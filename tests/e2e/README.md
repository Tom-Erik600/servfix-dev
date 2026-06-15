# ServFix E2E Test — Tilbud & Avvik

## Oppsett (én gang)

```bash
npm install --save-dev @playwright/test
npx playwright install chromium
```

Legg til i `package.json`:
```json
"test:e2e": "playwright test tests/e2e/"
```

---

## Miljøvariabler

Opprett `tests/e2e/.env.e2e` (ikke commit):
```
E2E_BASE_URL=https://airtechdev.servfix.no
E2E_ADMIN_EMAIL=<din admin-epost>
E2E_ADMIN_PASSWORD=<passord>
```

---

## Kjøring

```bash
# Alle E2E-tester
npx playwright test tests/e2e/

# Kun tilbud-flyt
npx playwright test tests/e2e/tilbud.spec.ts

# Med synlig nettleser (debug)
npx playwright test tests/e2e/ --headed

# Trinnvis / pause
npx playwright test tests/e2e/ --debug
```
