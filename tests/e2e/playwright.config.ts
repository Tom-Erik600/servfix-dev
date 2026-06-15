// tests/e2e/playwright.config.ts
import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '.env.e2e') });

export default defineConfig({
    testDir: path.join(__dirname),
    fullyParallel: false,
    retries: 1,
    timeout: 30_000,
    use: {
        baseURL: process.env.E2E_BASE_URL || 'https://airtechdev.servfix.no',
        storageState: path.join(__dirname, '.auth-state.json'),
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
    },
    projects: [
        {
            name: 'setup',
            testMatch: /auth\.setup\.ts/,
            use: { storageState: undefined },
        },
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
            dependencies: ['setup'],
        },
    ],
});
