// tests/e2e/auth.setup.ts
// Kjøres én gang før alle tester — logger inn og lagrer session
import { test as setup, expect } from '@playwright/test';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '.env.e2e') });

const authFile = path.join(__dirname, '.auth-state.json');

setup('Logg inn som admin', async ({ page }) => {
    const baseUrl = process.env.E2E_BASE_URL || 'https://airtechdev.servfix.no';
    await page.goto(`${baseUrl}/admin/login.html`);

    await page.fill('input[type="email"], input[name="email"]', process.env.E2E_ADMIN_EMAIL!);
    await page.fill('input[type="password"], input[name="password"]', process.env.E2E_ADMIN_PASSWORD!);
    await page.click('button[type="submit"]');

    // Vent på redirect til dashboard
    await page.waitForURL(`${baseUrl}/admin/dashboard.html`, { timeout: 10000 });
    await expect(page).toHaveURL(/dashboard/);

    await page.context().storageState({ path: authFile });
});
