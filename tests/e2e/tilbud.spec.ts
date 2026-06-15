// tests/e2e/tilbud.spec.ts
// Ende-til-ende-test: Tilbudsliste → Detaljer → Status-handlinger
import { test, expect, Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Hjelpere
// ---------------------------------------------------------------------------

async function goToTilbud(page: Page) {
    await page.goto('/admin/tilbud.html');
    await page.waitForSelector('#quotes-container', { state: 'visible' });
    await page.waitForFunction(() => {
        const el = document.getElementById('quotes-container');
        return el && !el.innerText.includes('Laster');
    }, { timeout: 10_000 });
}

async function selectFirstQuoteWithStatus(page: Page, status: string): Promise<boolean> {
    const item = page.locator(`.quote-item .status-${status}`).first();
    if (await item.count() === 0) return false;
    await item.locator('..').click(); // Klikk på forelder-item
    await page.waitForSelector('#quote-details-content', { state: 'visible' });
    return true;
}

// ---------------------------------------------------------------------------
// TILBUDSLISTE
// ---------------------------------------------------------------------------

test.describe('Tilbudsliste', () => {

    test('Laster tilbud og viser liste', async ({ page }) => {
        await goToTilbud(page);
        const items = page.locator('.quote-item');
        await expect(items.first()).toBeVisible({ timeout: 8000 });
    });

    test('Status-filter fungerer', async ({ page }) => {
        await goToTilbud(page);
        const filter = page.locator('#status-filter');
        await filter.selectOption('pending');
        await page.waitForTimeout(300);
        const items = await page.locator('.quote-item').count();
        // Alle synlige items skal ha status-pending
        if (items > 0) {
            const nonPending = await page.locator('.quote-item .status-pending').count();
            expect(nonPending).toBe(items);
        }
    });

    test('SENDT-badge er grønn (ikke blå)', async ({ page }) => {
        await goToTilbud(page);
        const sentBadge = page.locator('.quote-item .status-sent').first();
        if (await sentBadge.count() === 0) { test.skip(); return; }

        const color = await sentBadge.evaluate(el => getComputedStyle(el).color);
        // Grønn = rgb(6, 95, 70) = #065f46
        expect(color).toMatch(/6.*95.*70|065f46/i);
    });

});

// ---------------------------------------------------------------------------
// TILBUDSDETALJER
// ---------------------------------------------------------------------------

test.describe('Tilbudsdetaljer', () => {

    test('Viser «Opprettet»-dato', async ({ page }) => {
        await goToTilbud(page);
        await page.locator('.quote-item').first().click();
        await page.waitForSelector('#quote-details-content');

        const detailText = await page.locator('#quote-details-content').innerText();
        expect(detailText).toContain('Opprettet');
        // Norsk datoformat: "14. jun. 2026" e.l.
        expect(detailText).toMatch(/\d{1,2}\.\s+\w{3,4}\.\s+\d{4}/);
    });

    test('Viser «Godkjent av kunde»-dato kun for accepted', async ({ page }) => {
        await goToTilbud(page);

        // Test at accepted-tilbud viser dato
        const found = await selectFirstQuoteWithStatus(page, 'accepted');
        if (!found) { test.skip(); return; }

        const detailText = await page.locator('#quote-details-content').innerText();
        expect(detailText).toContain('Godkjent av kunde');
    });

    test('«Godkjent av kunde»-dato IKKE vist for pending', async ({ page }) => {
        await goToTilbud(page);
        const found = await selectFirstQuoteWithStatus(page, 'pending');
        if (!found) { test.skip(); return; }

        const detailText = await page.locator('#quote-details-content').innerText();
        expect(detailText).not.toContain('Godkjent av kunde');
    });

    test('«Se servicerapport»-knapp er i action-raden', async ({ page }) => {
        await goToTilbud(page);
        // Finn tilbud med rapport
        const items = page.locator('.quote-item');
        let found = false;
        const count = await items.count();
        for (let i = 0; i < Math.min(count, 5); i++) {
            await items.nth(i).click();
            await page.waitForSelector('#quote-details-content');
            const rapportBtn = page.locator('.action-buttons-modern button', { hasText: 'Se servicerapport' });
            if (await rapportBtn.count() > 0) {
                // Bekreft den er i action-buttons-modern (samme rad som andre knapper)
                await expect(rapportBtn).toBeVisible();
                found = true;
                break;
            }
        }
        if (!found) test.skip();
    });

});

// ---------------------------------------------------------------------------
// TILBUD STATUS-HANDLINGER
// ---------------------------------------------------------------------------

test.describe('Tilbuds-knapper og status-flyt', () => {

    test('"Send til kunde"-knapp vises for pending/rejected', async ({ page }) => {
        await goToTilbud(page);
        const found = await selectFirstQuoteWithStatus(page, 'pending');
        if (!found) { test.skip(); return; }

        await expect(page.locator('.action-buttons-modern button', { hasText: 'Send til kunde' })).toBeVisible();
        await expect(page.locator('.action-buttons-modern button', { hasText: 'Marker som sendt' })).toBeVisible();
    });

    test('"Godkjent av kunde"/"Avvist av kunde"-knapper vises KUN for sendte tilbud', async ({ page }) => {
        await goToTilbud(page);

        // For pending — disse knappene skal IKKE vises
        const found = await selectFirstQuoteWithStatus(page, 'pending');
        if (!found) { test.skip(); return; }

        await expect(page.locator('.action-buttons-modern button', { hasText: 'Godkjent av kunde' })).toHaveCount(0);
        await expect(page.locator('.action-buttons-modern button', { hasText: 'Avvist av kunde' })).toHaveCount(0);
    });

    test('"Godkjent av kunde"-knapper vises for sendt tilbud', async ({ page }) => {
        await goToTilbud(page);

        // Finn et sendt tilbud (status=sent og sent_to_customer=true)
        await page.locator('#status-filter').selectOption('sent');
        await page.waitForTimeout(300);
        const sentItem = page.locator('.quote-item .status-sent').first();
        if (await sentItem.count() === 0) { test.skip(); return; }
        await sentItem.locator('..').click();
        await page.waitForSelector('#quote-details-content');

        await expect(page.locator('.action-buttons-modern button', { hasText: 'Godkjent av kunde' })).toBeVisible();
        await expect(page.locator('.action-buttons-modern button', { hasText: 'Avvist av kunde' })).toBeVisible();
    });

    test('Status-dropdown mangler "Sendt"/"Godkjent"/"Avvist av kunde" for pending', async ({ page }) => {
        await goToTilbud(page);
        const found = await selectFirstQuoteWithStatus(page, 'pending');
        if (!found) { test.skip(); return; }

        // Åpne rediger-modal
        await page.locator('.action-buttons-modern button', { hasText: 'Rediger' }).click();
        await page.waitForSelector('#edit-quote-modal.show, #edit-quote-modal[style*="block"]', { timeout: 5000 }).catch(
            () => page.waitForSelector('#edit-quote-form', { timeout: 5000 })
        );

        const dropdown = page.locator('#edit-status');
        await expect(dropdown).toBeVisible();

        const options = await dropdown.locator('option').allTextContents();
        expect(options).not.toContain('Sendt');
        expect(options).not.toContain('Godkjent');
        expect(options).not.toContain('Avvist av kunde');
        // Disse skal fortsatt være der:
        expect(options).toContain('Venter');
        expect(options).toContain('Avvist av admin');

        // Lukk modal
        await page.keyboard.press('Escape');
    });

    test('Sendt tilbud: status-felt er skjult, readonly badge vises', async ({ page }) => {
        await goToTilbud(page);
        await page.locator('#status-filter').selectOption('sent');
        await page.waitForTimeout(300);
        const sentItem = page.locator('.quote-item .status-sent').first();
        if (await sentItem.count() === 0) { test.skip(); return; }
        await sentItem.locator('..').click();
        await page.waitForSelector('#quote-details-content');

        // Åpne rediger
        await page.locator('.action-buttons-modern button', { hasText: 'Rediger' }).click();
        await page.waitForTimeout(1000);

        // Status-dropdown skal ikke finnes
        await expect(page.locator('#edit-status')).toHaveCount(0);
        // Readonly-badge skal finnes
        await expect(page.locator('.sent-readonly-badge')).toBeVisible();

        await page.keyboard.press('Escape');
    });

});

// ---------------------------------------------------------------------------
// DEEPLINK
// ---------------------------------------------------------------------------

test.describe('Deeplink ?openQuote=', () => {

    test('Deeplink åpner korrekt tilbud i modal', async ({ page }) => {
        // Hent et tilbuds-ID fra lista først
        await goToTilbud(page);
        const firstItem = page.locator('.quote-item').first();
        const quoteId = await firstItem.getAttribute('data-quote-id');
        if (!quoteId) { test.skip(); return; }

        // Naviger med deeplink
        await page.goto(`/admin/tilbud.html?openQuote=${quoteId}`);
        await page.waitForSelector('#quote-details-content', { state: 'visible', timeout: 8000 });

        // Bekreft detaljer er lastet
        const title = await page.locator('#quote-details-content').innerText();
        expect(title.length).toBeGreaterThan(10);
    });

    test('Lagring via deeplink-modal gir ingen tom modal (v1.1 regresjontest)', async ({ page }) => {
        await goToTilbud(page);
        const firstItem = page.locator('.quote-item').first();
        const quoteId = await firstItem.getAttribute('data-quote-id');
        if (!quoteId) { test.skip(); return; }

        await page.goto(`/admin/tilbud.html?openQuote=${quoteId}`);
        await page.waitForSelector('#edit-quote-modal.show', { timeout: 8000 }).catch(() => {
            // Modal åpnes via deeplink
        });

        // Vent på at rediger-modal er åpen
        const editModal = page.locator('#edit-quote-modal');
        if (await editModal.isHidden()) {
            // Deeplink åpnet tilbud i detalj, ikke rediger-modal — ok
            await expect(page.locator('#quote-details-content')).toBeVisible();
            return;
        }

        // Klikk Avbryt — ingen tom modal skal dukke opp etterpå
        await page.locator('#edit-quote-modal button', { hasText: 'Avbryt' }).click();
        await page.waitForTimeout(500);

        const modalVisible = await editModal.evaluate(el => {
            return el.classList.contains('show') || (el as HTMLElement).style.display === 'block';
        });

        // Modalen skal ikke være synlig etter avbryt
        expect(modalVisible).toBe(false);
    });

});
