import { test, expect } from '@playwright/test';

/**
 * Offline navigation for the full app shell (every authenticated page + login).
 * Run via `pnpm test:e2e:offline` (production node build + service worker).
 */
const APP_SHELL_ROUTES = [
	'/login',
	'/calendar',
	'/calendar/split',
	'/jobs',
	'/clients',
	'/profile',
	'/admin/crew',
	'/admin/options',
	'/admin/import'
] as const;

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

/** Warm each shell path online so NetworkFirst can serve them offline. */
async function warmAppShellRoutes(page: import('@playwright/test').Page) {
	for (const route of APP_SHELL_ROUTES) {
		await page.goto(route, { waitUntil: 'load' });
		await expect(page).toHaveTitle(/Capital City Windows/i);
	}
}

test.describe('offline app shell', () => {
	test.describe.configure({ mode: 'serial' });

	test('service worker installs on production build', async ({ page }) => {
		await ensureServiceWorkerActive(page);
	});

	test('every app shell route loads after going offline', async ({ page, context }) => {
		test.setTimeout(180_000);
		await ensureServiceWorkerActive(page);
		await page.reload({ waitUntil: 'load' });

		const controlled = await hasServiceWorkerController(page);
		test.skip(!controlled, 'Headless Chromium did not attach SW controller — manual PWA verify on device');

		await warmAppShellRoutes(page);

		await context.setOffline(true);

		for (const route of APP_SHELL_ROUTES) {
			const response = await page.goto(route, { waitUntil: 'domcontentloaded' });
			expect(response?.status()).toBe(200);
			await expect(page).toHaveTitle(/Capital City Windows/i);
			const body = await page.textContent('body');
			expect(body?.toLowerCase()).not.toMatch(/can't be reached|err_internet|offline error/i);
		}
	});

	test('hard refresh works offline on calendar, profile, and admin options', async ({
		page,
		context
	}) => {
		test.setTimeout(180_000);
		await ensureServiceWorkerActive(page);

		for (const route of ['/calendar', '/profile', '/admin/options'] as const) {
			await page.goto(route, { waitUntil: 'load' });
			const controlled = await hasServiceWorkerController(page);
			test.skip(
				!controlled,
				'Headless Chromium did not attach SW controller — manual PWA verify on device'
			);

			await context.setOffline(true);
			await page.reload({ waitUntil: 'domcontentloaded' });
			await expect(page).toHaveTitle(/Capital City Windows/i);
			await context.setOffline(false);
		}
	});
});
