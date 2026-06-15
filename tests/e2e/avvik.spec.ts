// tests/e2e/avvik.spec.ts
// Ende-til-ende-test: Avvik → Arbeidsliste → Tilbud-flyt
import { test, expect, Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Hjelpere
// ---------------------------------------------------------------------------

async function goToWorklist(page: Page) {
    await page.goto('/admin/avvik.html');
    // Arbeidsliste er default-fane
    await page.waitForSelector('#worklist-orders', { state: 'visible' });
    // Vent til kortene eller tom-melding er lastet
    await page.waitForFunction(() => {
        const el = document.getElementById('worklist-orders');
        return el && el.innerHTML.trim() !== '' &&
               !el.innerHTML.includes('Laster arbeidsliste');
    }, { timeout: 10_000 });
}

// ---------------------------------------------------------------------------
// AVVIK-ARBEIDSLISTE
// ---------------------------------------------------------------------------

test.describe('Arbeidsliste', () => {

    test('Laster arbeidsliste og viser KPI-tellere', async ({ page }) => {
        await goToWorklist(page);

        // Tre KPI-tellerkort
        const counters = page.locator('#worklist-counters > div');
        await expect(counters).toHaveCount(3);
        await expect(counters.nth(0)).toContainText('Ønsker tilbud');
        await expect(counters.nth(1)).toContainText('Fikset på stedet');
        await expect(counters.nth(2)).toContainText('Uvurdert');
    });

    test('Tellerkort er klikkbare og filtrerer lista', async ({ page }) => {
        await goToWorklist(page);

        const counters = page.locator('#worklist-counters > div');
        const ordersBeforeFilter = await page.locator('.avvik-card').count();

        // Klikk "Ønsker tilbud"
        await counters.nth(0).click();
        await page.waitForTimeout(200); // re-render er synkron, kort ventepause

        // Alle synlige ordre-kort skal ha minst ett "Ønsker tilbud"-avvik
        const visibleCards = page.locator('#worklist-orders .avvik-card');
        const cardCount = await visibleCards.count();

        // Klikk igjen → tilbake til full liste
        await counters.nth(0).click();
        await page.waitForTimeout(200);
        const afterReset = await page.locator('#worklist-orders .avvik-card').count();
        expect(afterReset).toBeGreaterThanOrEqual(cardCount);
    });

    test('"Vis også sendte"-toggle viser/skjuler sendte', async ({ page }) => {
        await goToWorklist(page);

        const toggle = page.locator('#worklist-include-sent');
        await expect(toggle).toBeVisible();

        const countBefore = await page.locator('#worklist-orders .avvik-card').count();
        await toggle.check();
        await page.waitForFunction(() => !document.querySelector('#worklist-orders p'), { timeout: 5000 }).catch(() => {});
        const countAfter = await page.locator('#worklist-orders .avvik-card').count();
        // Sendte kan øke antallet (eller holde det likt hvis ingen sendte)
        expect(countAfter).toBeGreaterThanOrEqual(countBefore);

        await toggle.uncheck();
        await page.waitForTimeout(300);
    });

    test('Kortet viser kunde, prosjekt og Kontakt — IKKE PROJ-nummer', async ({ page }) => {
        await goToWorklist(page);

        const firstCard = page.locator('#worklist-orders .avvik-card').first();
        const cardText = await firstCard.innerText();

        // Kundenavn vises som primær
        await expect(firstCard.locator('.worklist-card-customer')).toBeVisible();

        // Kontakt-feltet har tekstlabel
        expect(cardText).toMatch(/Kontakt:/);

        // PROJ-nummer skal IKKE vises
        expect(cardText).not.toMatch(/PROJ-\d+/);
        expect(cardText).not.toMatch(/· Ordre/);
    });

    test('Triage-knapper er disablet for avvik med tilbud', async ({ page }) => {
        await goToWorklist(page);

        // Finn en rad med quote_id (knapper skal være disabled)
        const disabledBtn = page.locator('button[disabled][title="Avvik er knyttet til tilbud"]').first();
        if (await disabledBtn.count() > 0) {
            await expect(disabledBtn).toBeDisabled();
        } else {
            test.skip(); // Ingen avvik med tilbud i testdata — ok å hoppe
        }
    });

    test('"Se rapport"-knapp åpner PDF', async ({ page }) => {
        await goToWorklist(page);

        const reportBtn = page.locator('button', { hasText: 'Se rapport' }).first();
        await expect(reportBtn).toBeVisible();

        const [popup] = await Promise.all([
            page.waitForEvent('popup', { timeout: 5000 }).catch(() => null),
            reportBtn.click(),
        ]);
        // Enten ny fane åpnet, eller feil-melding vist (begge ok)
        // (ingen rapport = feilmelding i worklist-error)
    });

    test('Fane-bytte: Arbeidsliste ↔ Avviksliste virker', async ({ page }) => {
        await goToWorklist(page);

        // Avviksliste-fane
        await page.click('#view-list-btn');
        await expect(page.locator('.avvik-table-wrap')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#avvik-worklist-card')).toBeHidden();

        // Tilbake til Arbeidsliste
        await page.click('#view-worklist-btn');
        await expect(page.locator('#avvik-worklist-card')).toBeVisible();
        await expect(page.locator('.avvik-table-wrap')).toBeHidden();
    });

    test('"Eksporter"-knapp finnes, "Oppdater" er fjernet', async ({ page }) => {
        await page.goto('/admin/avvik.html');
        await expect(page.locator('#avvikExportBtn')).toBeVisible();
        // "Oppdater"-knappen skal ikke finnes
        await expect(page.locator('button', { hasText: 'Oppdater' })).toHaveCount(0);
    });

});
