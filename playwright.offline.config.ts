import { defineConfig, devices } from '@playwright/test';

const previewPort = 4173;
const baseURL = `http://127.0.0.1:${previewPort}`;

/** Production preview + service worker — offline page E2E only. */
export default defineConfig({
	testDir: './tests/e2e',
	testMatch: '**/offline-pages.spec.ts',
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: 1,
	reporter: 'html',
	timeout: 60_000,
	use: {
		baseURL,
		trace: 'on-first-retry',
		screenshot: 'only-on-failure',
		serviceWorkers: 'allow'
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: {
		command: 'node build',
		url: baseURL,
		reuseExistingServer: !process.env.CI,
		timeout: 120 * 1000,
		env: {
			PORT: String(previewPort),
			HOST: '127.0.0.1',
			ORIGIN: baseURL
		}
	}
});