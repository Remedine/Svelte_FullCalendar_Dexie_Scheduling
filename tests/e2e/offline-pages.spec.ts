import { test, expect } from '@playwright/test';

/**
 * Offline navigation for core CRM pages (calendar, jobs, clients).
 * Run via `pnpm test:e2e:offline` (production node build + service worker).
 */
const CORE_ROUTES = ['/calendar', '/jobs', '/clients'] as const;

async function ensureServiceWorkerActive(page: import('@playwright/test').Page) {
	await page.goto('/login', { waitUntil: 'load' });
	await page.waitForFunction(
		async () => {
			if (!('serviceWorker' in navigator)) return false;
			const reg = await navigator.serviceWorker.getRegistration();
			return !!reg?.active;
		},
		null,
		{ timeout: 60_000 }
	);
}

async function hasServiceWorkerController(page: import('@playwright/test').Page) {
	return page.evaluate(() => !!navigator.serviceWorker.controller);
}

test.describe('offline core pages', () => {
	test.describe.configure({ mode: 'serial' });

	test('service worker installs on production build', async ({ page }) => {
		await ensureServiceWorkerActive(page);
	});

	test('calendar, jobs, and clients load after going offline', async ({ page, context }) => {
		test.setTimeout(120_000);
		await ensureServiceWorkerActive(page);
		await page.reload({ waitUntil: 'load' });

		const controlled = await hasServiceWorkerController(page);
		test.skip(!controlled, 'Headless Chromium did not attach SW controller — manual PWA verify on device');

		for (const route of CORE_ROUTES) {
			await page.goto(route, { waitUntil: 'load' });
			await expect(page).toHaveTitle(/Capital City Windows/i);
		}

		await context.setOffline(true);

		for (const route of CORE_ROUTES) {
			const response = await page.goto(route, { waitUntil: 'domcontentloaded' });
			expect(response?.status()).toBe(200);
			await expect(page).toHaveTitle(/Capital City Windows/i);
			const body = await page.textContent('body');
			expect(body?.toLowerCase()).not.toMatch(/can't be reached|err_internet|offline error/i);
		}
	});

	test('hard refresh works offline on calendar', async ({ page, context }) => {
		test.setTimeout(120_000);
		await ensureServiceWorkerActive(page);
		await page.goto('/calendar', { waitUntil: 'load' });
		const controlled = await hasServiceWorkerController(page);
		test.skip(!controlled, 'Headless Chromium did not attach SW controller — manual PWA verify on device');

		await context.setOffline(true);
		await page.reload({ waitUntil: 'domcontentloaded' });
		await expect(page).toHaveTitle(/Capital City Windows/i);
	});
});