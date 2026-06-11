import { defineConfig, devices } from '@playwright/test';

/**
 * )=- Basic Playwright config for E2E (Phase 0 of TESTING_PLAN.md).
 * Starts the SvelteKit dev server automatically.
 * Base tests will run against http://127.0.0.1:5173.
 *
 * For full-stack E2E (auth, real sync, invoices) we will later either:
 *   - Seed a test PocketBase instance, or
 *   - Use route interception + MSW-style mocks for the PB REST API.
 *
 * Run with: pnpm test:e2e
 * UI mode: pnpm test:e2e:ui
 *
 * Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling
 */
export default defineConfig({
	testDir: './tests/e2e',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: 'html',
	use: {
		baseURL: 'http://127.0.0.1:5173',
		trace: 'on-first-retry',
		screenshot: 'only-on-failure'
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] }
		}
		// Add mobile projects later when we have responsive E2E coverage
	],
	webServer: {
		command: 'pnpm dev',
		url: 'http://127.0.0.1:5173',
		reuseExistingServer: !process.env.CI,
		timeout: 120 * 1000
	}
});
