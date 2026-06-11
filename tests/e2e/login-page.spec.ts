import { test, expect } from '@playwright/test';

// )=- Extended E2E example (Phase 5).
// Tests the login page shell + a mocked successful login flow.
// Since full auth requires a running PocketBase with test users + subsequent pulls,
// we use page.route() to intercept the PB auth endpoint and simulate success.
// This exercises the loginWithEmail path + client-side state update without a real PB.
// Future specs can expand to full flows (calendar, jobs, invoices) with more intercepts or a test pb_data.
// Covers form interaction, network mocking, and post-login UI hints (e.g. role badge in header).
// Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling + TESTING_PLAN.md

test('login page renders email/password form', async ({ page }) => {
	await page.goto('/login');

	// Expect form elements for email auth (from the login page implementation).
	await expect(page.locator('input[type="email"]')).toBeVisible();
	await expect(page.locator('input[type="password"]')).toBeVisible();
	await expect(page.locator('button:has-text("Login")')).toBeVisible();

	// Basic a11y / structure check
	const form = page.locator('form');
	await expect(form).toBeVisible();
});

test('can submit login form with mocked PB success and see app state update', async ({ page }) => {
	await page.goto('/login');

	// Mock the PB auth-with-password endpoint (the one used by loginWithEmail in pb.ts).
	await page.route('**/api/collections/users/auth-with-password', async route => {
		if (route.request().method() === 'POST') {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					token: 'fake.jwt.token',
					record: {
						id: 'test-user-pb-id',
						email: 'test@example.com',
						name: 'Test User',
						role: 'admin',
						firstName: 'Test',
						lastName: 'User',
						active: true,
						verified: true
					}
				})
			});
		} else {
			await route.continue();
		}
	});

	// Fill and submit the form (triggers the real loginWithEmail + pulls, but pulls are also mockable if needed).
	await page.fill('input[type="email"]', 'test@example.com');
	await page.fill('input[type="password"]', 'password123');
	await page.click('button:has-text("Login")');

	// After mocked success, the app should update auth state.
	// Look for post-login UI (role badge from layout or calendar header, or redirect away from /login).
	// We wait for the role badge that appears in the app header after auth (see +layout or calendar pages).
	await expect(page.locator('.calendar__role-badge, text=Admin')).toBeVisible({ timeout: 10000 });

	// Optional: confirm we're no longer on the login page
	await expect(page).not.toHaveURL(/\/login/);
});

// )=- Additional simple E2E (Phase 5).
// Verifies PWA setup (manifest link from vite-plugin-pwa). This is static and doesn't require auth.
// Helps ensure the PWA features (offline shell, installability) are wired correctly.
// Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling + TESTING_PLAN.md

test('PWA manifest link is present for installability', async ({ page }) => {
	await page.goto('/');
	const manifestLink = page.locator('link[rel="manifest"]');
	await expect(manifestLink).toHaveAttribute('href', '/manifest.webmanifest');
});

// )=- Advanced E2E (Phase 5): Post-login calendar smoke with additional mocks.
// After the mocked login (which sets auth state), we navigate to the split calendar and verify the shell renders (filters, container).
// We mock additional PB fetches (e.g. jobs list, options) to prevent 404s and allow UI to load without real backend.
// This exercises more of the client-side app (SplitCalendar, MonthPicker, filters, role badge) in a controlled way.
// Future: expand to actual job creation via dateClick, drag/drop, invoice modal, etc.
// Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling + TESTING_PLAN.md + JOBS_AND_INVOICES_SPEC.md

test('after mocked login, split calendar shell renders with filters and role', async ({ page }) => {
	await page.goto('/login');

	// Reuse the auth mock from previous test setup (but since tests are independent, re-mock here)
	await page.route('**/api/collections/users/auth-with-password', async route => {
		if (route.request().method() === 'POST') {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					token: 'fake.jwt.token',
					record: {
						id: 'test-user-pb-id',
						email: 'test@example.com',
						name: 'Test User',
						role: 'admin',
						firstName: 'Test',
						lastName: 'User',
						active: true,
						verified: true
					}
				})
			});
		} else {
			await route.continue();
		}
	});

	// Mock jobs and options fetches that the calendar/split page will trigger on load (to avoid errors and allow render)
	await page.route('**/api/collections/jobs**', async route => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ items: [], page: 1, perPage: 50, totalItems: 0, totalPages: 0 })
		});
	});

	await page.route('**/api/collections/options**', async route => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				items: [{
					defaultJobDurationHours: 2,
					taxRate: 6.5,
					invoiceDueDays: 30,
					areasOfTown: [{ id: 'downtown', label: 'Downtown', color: '#1e40af' }],
					defaultBillableItems: [],
					cancelReasons: [],
					lastUpdated: new Date().toISOString(),
					updatedBy: 'System'
				}]
			})
		});
	});

	await page.fill('input[type="email"]', 'test@example.com');
	await page.fill('input[type="password"]', 'password123');
	await page.click('button:has-text("Login")');

	// Wait for auth state
	await expect(page.locator('.calendar__role-badge, text=Admin')).toBeVisible({ timeout: 10000 });

	// Navigate to split calendar (the main scheduling view)
	await page.goto('/calendar/split');

	// Verify key UI shell elements from SplitCalendar.svelte (sidebar, main calendar wrapper, filters)
	await expect(page.locator('.split-calendar-container')).toBeVisible();
	await expect(page.locator('.split-calendar__sidebar')).toBeVisible();
	await expect(page.locator('.filters')).toBeVisible(); // the filter panel
	await expect(page.locator('.split-calendar__main')).toBeVisible();

	// Role badge should persist in header
	await expect(page.locator('.calendar__role-badge')).toBeVisible();
});

// )=- Further E2E advancement (Phase 5): Jobs page shell after mocked login.
// Similar to calendar test, mocks auth + jobs + options to load the rich jobs page UI (filters, search, cards area).
// Verifies elements from the Phase 5 overhaul: .job-page__filters, search input, etc.
// This covers the /jobs admin hub for browsing/filtering jobs and invoices.
// Reference: JOBS_AND_INVOICES_SPEC.md Phase 5 + TESTING_PLAN.md

test('after mocked login, jobs page shell renders with filters and search', async ({ page }) => {
	await page.goto('/login');

	// Auth mock
	await page.route('**/api/collections/users/auth-with-password', async route => {
		if (route.request().method() === 'POST') {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					token: 'fake.jwt.token',
					record: {
						id: 'test-user-pb-id',
						email: 'test@example.com',
						name: 'Test User',
						role: 'admin',
						firstName: 'Test',
						lastName: 'User',
						active: true,
						verified: true
					}
				})
			});
		} else {
			await route.continue();
		}
	});

	// Mock for jobs page data loads (jobs, clients, users, invoices via getInvoiceForJob etc.)
	await page.route('**/api/collections/jobs**', async route => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ items: [], page: 1, perPage: 25, totalItems: 0, totalPages: 0 })
		});
	});

	await page.route('**/api/collections/clients**', async route => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ items: [], page: 1, perPage: 100, totalItems: 0, totalPages: 0 })
		});
	});

	await page.route('**/api/collections/users**', async route => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ items: [], page: 1, perPage: 100, totalItems: 0, totalPages: 0 })
		});
	});

	await page.route('**/api/collections/invoices**', async route => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ items: [], page: 1, perPage: 50, totalItems: 0, totalPages: 0 })
		});
	});

	await page.route('**/api/collections/options**', async route => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				items: [{
					defaultJobDurationHours: 2,
					taxRate: 6.5,
					invoiceDueDays: 30,
					areasOfTown: [],
					defaultBillableItems: [],
					cancelReasons: [],
					lastUpdated: new Date().toISOString(),
					updatedBy: 'System'
				}]
			})
		});
	});

	await page.fill('input[type="email"]', 'test@example.com');
	await page.fill('input[type="password"]', 'password123');
	await page.click('button:has-text("Login")');

	await expect(page.locator('.calendar__role-badge, text=Admin')).toBeVisible({ timeout: 10000 });

	// Go to jobs page (rich filters per spec)
	await page.goto('/jobs');

	// Verify key elements from the /jobs page (Phase 5 rich UI)
	await expect(page.locator('.job-page__filters')).toBeVisible();
	await expect(page.locator('input[placeholder*="Search"]')).toBeVisible(); // searchTerm input
	await expect(page.locator('text=No jobs match your filters').or(page.locator('.job-card, .job-list'))).toBeVisible({ timeout: 5000 });
});

// )=- Even more E2E (Phase 5): Jobs page with mocked data to test rich cards and invoice badges.
// Mocks return a sample job with invoice, checks for job title in UI and invoice status badge (per spec Phase 5/7 overdue treatment).
// This tests the client enrichment, search facets, and invoice status display without real data.
// Reference: JOBS_AND_INVOICES_SPEC.md Phase 5 + TESTING_PLAN.md

test('jobs page with mocked data shows job cards and invoice badges', async ({ page }) => {
	await page.goto('/login');

	// Auth mock (same as before)
	await page.route('**/api/collections/users/auth-with-password', async route => {
		if (route.request().method() === 'POST') {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					token: 'fake.jwt.token',
					record: {
						id: 'test-user-pb-id',
						email: 'test@example.com',
						name: 'Test User',
						role: 'admin',
						firstName: 'Test',
						lastName: 'User',
						active: true,
						verified: true
					}
				})
			});
		} else {
			await route.continue();
		}
	});

	// Mock jobs with one sample that has invoice (to test badge)
	await page.route('**/api/collections/jobs**', async route => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				items: [{
					id: 'job-1',
					title: 'Test Job with Invoice',
					start: '2026-10-01T10:00:00Z',
					end: '2026-10-01T12:00:00Z',
					client: 'client-1',
					status: 'completed',
					assignedCrew: ['Crew A'],
					areaOfTown: 'downtown',
					billableItems: [{ title: 'Clean', price: 500, quantity: 1, total: 500 }],
					subtotal: 500,
					taxRate: 0.065,
					taxAmount: 32.5,
					totalAmount: 532.5,
					notes: 'Test notes',
					created: '2026-01-01',
					updated: '2026-01-02'
				}],
				page: 1,
				perPage: 25,
				totalItems: 1,
				totalPages: 1
			})
		});
	});

	// Mock clients for enrichment
	await page.route('**/api/collections/clients**', async route => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				items: [{ id: 'client-1', name: 'Test Client', ...minimalClientForMock() }],
				page: 1,
				perPage: 100,
				totalItems: 1,
				totalPages: 1
			})
		});
	});

	// Mock invoices for the job (to show "has invoice" badge)
	await page.route('**/api/collections/invoices**', async route => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				items: [{
					id: 'inv-1',
					jobId: 'job-1',
					clientId: 'client-1',
					status: 'generated',
					dueDate: '2026-11-01',
					amount: 532.5,
					created: '2026-01-03',
					updated: '2026-01-03'
				}],
				page: 1,
				perPage: 50,
				totalItems: 1,
				totalPages: 1
			})
		});
	});

	// Other mocks as before for options/users
	await page.route('**/api/collections/users**', async route => {
		await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 1, perPage: 100, totalItems: 0, totalPages: 0 }) });
	});

	await page.route('**/api/collections/options**', async route => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				items: [{
					defaultJobDurationHours: 2,
					taxRate: 6.5,
					invoiceDueDays: 30,
					areasOfTown: [{ id: 'downtown', label: 'Downtown', color: '#1e40af' }],
					defaultBillableItems: [],
					cancelReasons: [],
					lastUpdated: new Date().toISOString(),
					updatedBy: 'System'
				}]
			})
		});
	});

	await page.fill('input[type="email"]', 'test@example.com');
	await page.fill('input[type="password"]', 'password123');
	await page.click('button:has-text("Login")');

	await expect(page.locator('.calendar__role-badge, text=Admin')).toBeVisible({ timeout: 10000 });

	await page.goto('/jobs');

	// Verify job card with title and invoice badge (e.g. "generated" or amount)
	await expect(page.locator('text=Test Job with Invoice')).toBeVisible({ timeout: 5000 });
	await expect(page.locator('text=generated').or(page.locator('text=Has Invoice')).or(page.locator('.invoice-badge'))).toBeVisible();
});

// Helper for mock (simplified client)
function minimalClientForMock() {
	return {
		serviceAddressStreet: '',
		serviceAddressCity: '',
		serviceAddressState: '',
		serviceAddressZip: '',
		areaOfTown: '',
		preferredBillingMethod: 'email',
		phone: '',
		email: '',
		created: '2026-01-01',
		updated: '2026-01-01'
	};
}
