# Plan: Fase 3.5 Bug-fix — PDF korrupsjon + loading-feedback

**Dato**: 2026-05-30  
**Status**: Klar til implementasjon  
**Aktiv boulder**: fase3.5-bugfix

---

## Bakgrunn

Etter deploy av fase 3.5 (`servfix-app-00267-djb`) rapporterte bruker to bugs:
1. **Bug #1**: Ingen loading-indikator under eksport — filen dukker plutselig opp uten feedback
2. **Bug #2**: PDF-fil kan ikke åpnes i Edge/browser ("Noe gikk galt")

Rotårsak for bug #2 er bekreftet (se Diagnose-seksjon nedenfor).

---

## Diagnose (bekreftet av explore-agent)

### Bug #2 — PDF korrupsjon
**Rotårsak**: Puppeteer `^24.15.0` returnerer `Uint8Array` fra `page.pdf()`, ikke `Buffer`.  
Express.js behandler `Uint8Array` som et JSON-serialiserbart objekt og sender `{"0":37,"1":80,...}` i stedet for binærdata.  
Browser mottar JSON → kan ikke åpne som PDF.

**Fil**: `src/services/deviationsExport.js`  
**Linje**: `return pdfBuffer;` (etter `page.pdf()`)  
**Fix**: `return Buffer.from(pdfBuffer);`

**Defensiv fix i route**: `src/routes/admin/deviations.js` PDF-respons-blokk  
Legg til: `Content-Length: pdfBuffer.length` + `Cache-Control: no-transform`

### Bug #1 — Ingen loading-feedback
**Rotårsak**: `triggerExport()`-funksjonen i `avvik.js` IIFE mangler loading-state.

**Referanse-pattern**: `rapporter.js` linjer 1355-1408 (admin-kontekst)  
**Mønster**: Knapp-mutasjon (ingen full-screen overlay):
- Lagre original `innerHTML`
- `btn.disabled = true` + `btn.innerHTML = '⏳ Eksporterer...'` + `opacity: 0.7`
- I `finally`: restore original tekst + `disabled = false` + `opacity: 1`

---

## Scope

### I scope
- `src/services/deviationsExport.js` — `Buffer.from()` fix
- `src/routes/admin/deviations.js` — defensiv header-fix
- `public/admin/assets/js/avvik.js` — loading-state i modal `triggerExport()`
- `tests/admin-deviations-export.test.js` — oppdatere mock for Buffer.from (om nødvendig)

### Utenfor scope
- Ingen endringer i fase 1/2/3-kode
- Ingen nye dependencies
- Ingen endringer i andre PDF-generatorer (unifiedPdfGenerator.js)
- Ingen prod-deploy

---

## TODOs

- [x] 1. `src/services/deviationsExport.js` — wrap `pdfBuffer` med `Buffer.from()`
- [x] 2. `src/routes/admin/deviations.js` — legg til `Content-Length` + `Cache-Control: no-transform` i PDF-respons
- [x] 3. `public/admin/assets/js/avvik.js` — legg til knapp-loading-state i `triggerExport()` etter `rapporter.js`-mønsteret
- [x] 4. `tests/admin-deviations-export.test.js` — verifiser at mock er kompatibel med `Buffer.from()`; legg til test for at returnert verdi er Buffer-instans
- [x] 5. Dev-deploy og smoke-test (gcloud run deploy)

---

## Final Verification Wave

- [x] F1. Kode-review: Oracle leser de 4 endrede filene og bekrefter: (a) Buffer.from() er korrekt plassert, (b) loading-state har success + error + finally branches, (c) ingen scope creep
- [x] F2. Test-suite: 209+ tester passerer; ingen nye failures; export-test-filen har ≥15 passing (ikke todo)
- [ ] F3. Hands-on QA: Playwright åpner admin-avvik-siden, trykker Eksporter, ser loading-indikator, laster ned PDF, bekrefter at PDF åpnes
- [x] F4. Deploy-verifisering: Ny Cloud Run-revisjon er live; `GET /api/admin/deviations/export?format=pdf` returnerer binær PDF (Content-Type: application/pdf, Content-Length > 0); `format=csv` fortsatt fungerer

---

## Avhengigheter

```
B1 (service fix)
  └── B2 (route headers) — uavhengig, kan parallelliseres med B1
  └── B4 (test update) — avhenger av B1 (Buffer.from endrer return-type)

B3 (frontend loading) — fullstendig uavhengig av B1/B2/B4

B5 (deploy) — avhenger av B1 + B2 + B3 + B4

F1/F2/F3/F4 — avhenger av B5
```

**Wave-plan**:
- **Wave 1** (parallell): B1 + B2 + B3
- **Wave 2** (etter Wave 1): B4
- **Wave 3** (etter Wave 2): B5
- **Wave 4** (etter Wave 3): F1 + F2 + F3 + F4 (parallell)

---

## Nøkkeldetaljer for implementasjon

### B1 — Buffer.from fix (deviationsExport.js)

Finn blokken som ligner:
```javascript
const pdfBuffer = await page.pdf({ ... });
await page.close();
return pdfBuffer;
```

Endre siste linje til:
```javascript
return Buffer.from(pdfBuffer);
```

Legg også til `waitUntil: 'load'` som fallback i `setContent` (fra `'networkidle0'`) for Cloud Run-stabilitet:
```javascript
await page.setContent(html, { waitUntil: 'load' });
```

### B2 — Defensive headers (deviations.js route)

Finn PDF-respons-blokken (ca. linje 147-152):
```javascript
res.status(200)
  .type('application/pdf')
  .setHeader('Content-Disposition', `attachment; filename="avvik-${tenantId}-${today}.pdf"`)
  .send(pdfBuffer);
```

Endre til:
```javascript
res.status(200)
  .type('application/pdf')
  .setHeader('Content-Disposition', `attachment; filename="avvik-${tenantId}-${today}.pdf"`)
  .setHeader('Content-Length', pdfBuffer.length)
  .setHeader('Cache-Control', 'no-transform')
  .send(pdfBuffer);
```

### B3 — Loading-state i avvik.js

I `triggerExport()`-funksjonen i export-IIFE (helt nederst i avvik.js), legg til rundt `fetch`-kallet:

```javascript
// Finn eksport-knappen (er i modalen)
const exportBtn = document.getElementById('avvikExportConfirmBtn'); // eller tilsvarende ID/selektor
const originalBtnHtml = exportBtn ? exportBtn.innerHTML : '';

// VIS LOADING
if (exportBtn) {
  exportBtn.disabled = true;
  exportBtn.innerHTML = '⏳ Eksporterer...';
  exportBtn.style.opacity = '0.7';
  exportBtn.style.cursor = 'not-allowed';
}

try {
  // ... eksisterende fetch-kode ...
} catch (err) {
  // ... eksisterende feilhåndtering ...
} finally {
  // GJENOPPRETT KNAPP
  if (exportBtn) {
    exportBtn.disabled = false;
    exportBtn.innerHTML = originalBtnHtml || 'Last ned';
    exportBtn.style.opacity = '1';
    exportBtn.style.cursor = 'pointer';
  }
}
```

**NB**: Les avvik.js eksport-IIFE grundig for å finne eksakt knapp-ID/selektor og eksisterende try/catch struktur. Ikke dupliser try/catch — innpas loading-state i eksisterende struktur.

### B4 — Test-kompatibilitet

I `tests/admin-deviations-export.test.js`, sjekk at puppeteer-mock returnerer noe som `Buffer.from()` kan wrape:
```javascript
// Eksisterende mock (trolig):
mockPage.pdf.mockResolvedValue(Buffer.from('%PDF-1.4 test'));

// Buffer.from(Buffer) er en no-op kopi — fortsatt kompatibelt. Ingen endring nødvendig.
// Men legg til en test:
it('generateDeviationsPdf returnerer Buffer-instans', async () => {
  const result = await generateDeviationsPdf([], {});
  expect(Buffer.isBuffer(result)).toBe(true);
});
```

### B5 — Dev-deploy

```bash
gcloud run deploy servfix-app \
  --project servfix-dev \
  --region europe-north1 \
  --source . \
  --quiet
```

---

## Risiko

| Risiko | Sannsynlighet | Konsekvens | Mitigering |
|--------|--------------|------------|------------|
| `waitUntil: 'load'` for rask — HTML ikke rendret | Lav | PDF ser tom ut | Bruk `'domcontentloaded'` som kompromiss; testjuster |
| Knapp-selektor i avvik.js er annerledes enn antatt | Middels | Loading vises ikke | Les avvik.js grundig før endring |
| Buffer.from() på allerede-Buffer er no-op | Ingen risiko | — | Bekreftet trygt |
| `Content-Length` feil etter Buffer.from() wrapping | Lav | Kan avkorte respons | `pdfBuffer.length` beregnes ETTER Buffer.from(); sett header ETTER kall til generateDeviationsPdf |

---

## Relevante filer

- `src/services/deviationsExport.js` — **B1 primærfix**
- `src/routes/admin/deviations.js` — **B2 header-fix**, PDF-blokk ca. linje 143-155
- `public/admin/assets/js/avvik.js` — **B3 loading-UI**, export-IIFE helt nederst
- `tests/admin-deviations-export.test.js` — **B4 test-update**
- `public/admin/assets/js/rapporter.js` linje 1355-1408 — **referanse-mønster** for loading-state
- `src/utils/safePuppeteer.js` — referanse for launchBrowserSafely (les ikke endre)
- `.omo/notepads/fase3.5-avvik-eksport/` — inherited wisdom fra fase 3.5-implementasjonen
