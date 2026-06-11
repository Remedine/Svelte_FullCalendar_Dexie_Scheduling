# E2E Tests (Playwright)

This directory is for end-to-end tests using Playwright.

See the root [../docs/TESTING_PLAN.md](../docs/TESTING_PLAN.md) for the phased plan.

## Running

```bash
pnpm test:e2e
pnpm test:e2e:ui
```

The `playwright.config.ts` at the project root starts the SvelteKit dev server automatically.

## Current Status (Phase 0)

- Infrastructure and config are in place.
- Real specs will be added in later phases (calendar flows, job creation + invoice generation, offline queue, rich /jobs filtering, client related-jobs, etc.).
- Many flows require a running or mocked PocketBase; initial specs may focus on UI shell + public pages or use route interception.

Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling
