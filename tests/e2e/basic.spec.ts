import { test, expect } from '@playwright/test';

// )=- Basic E2E skeleton (Phase 5 of TESTING_PLAN.md).
// The app is a fully client-side PWA with PocketBase auth, so real end-to-end flows
// (login, create job on calendar, Mark Complete → generate invoice, drag/drop, filters)
// will require either a seeded test PB instance or heavy route interception + local Dexie priming.
// For now we have a minimal smoke that the shell loads without hard server errors.
// Future specs can use page.route() to mock /api/* or run against a disposable pb_data for CI.
// Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling + TESTING_PLAN.md

test('app shell loads without crashing', async ({ page }) => {
	await page.goto('/');

	// The root layout + client app should at least render the html shell.
	// Title comes from the PWA manifest + app.html or +layout.
	await expect(page).toHaveTitle(/Capital City Windows|CCW Scheduler/i);

	// Sanity: the body should exist and not show a catastrophic error page.
	const bodyText = await page.textContent('body');
	expect(bodyText).not.toMatch(/error|500|internal server/i);
});
