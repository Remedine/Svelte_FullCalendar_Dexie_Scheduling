# Testing Plan — Capital City Windows Scheduler

**Project:** Remedine/Svelte_FullCalendar_Dexie_Scheduling  
**Date:** 2026  
**Goal:** Establish a practical, maintainable test suite for an offline-first Svelte 5 + Dexie + PocketBase + FullCalendar scheduling/CRM application.

## 1. Current State

- **Zero tests** exist in the repository (confirmed via full src grep for `describe|it|test|expect|vitest|jest|playwright`).
- No test runner, no `@testing-library`, no `fake-indexeddb`, no E2E config.
- `package.json` scripts only cover dev/build/check/lint/format.
- Core complexity lives in:
  - `src/lib/db/index.ts` (~1800 LOC): Dexie schema v19, optimistic CRUD + `syncQueue`, `processSyncQueue` (massive), `create*`/`update*`/`pull*FromServer`, ID resolution (`pbId` vs local UUID), `generateInvoiceDocx`, `isInvoiceOverdue`, `ensureInvoiceForJob`, hybrid client/job/invoice/user merging.
  - Stores (`auth.svelte.ts`, `options.svelte.ts`, `toast.svelte.ts`): runes-based global state + session restore + PB pull orchestration.
  - Calendar layer: two FullCalendar instances (`Calendar.svelte`, `SplitCalendar.svelte`) with drag/drop/resize, external MonthPicker drop, crew avatar injection, filtering, area colors from options.
  - Invoice flows: `JobInvoicePanel.svelte` + `JobDetailsModal.svelte` + `generateInvoiceDocx` + file (docx) handling via `_files` in queue.
  - Pages: rich `/jobs` filtering/enrichment/pagination, clients "Related Jobs" expansion using `getPaginatedJobsForClient`.
- Historical bug patterns visible in comments: ID resolution races, 404 fallbacks on invoice regenerate, duplicate user cleanup, date local-vs-UTC shifts, stale pbId after server deletes, last-write-wins by `updatedAt`.

**Risk if untested:** Sync correctness, invoice financial data, calendar date math, offline optimistic behavior, and crew assignment are the highest business-impact areas.

## 2. Testing Strategy (Adapted Pyramid)

Because this is a **local-first PWA with heavy client DB + external sync**, classic "many unit tests" is less valuable than:

```
          E2E (Playwright) — critical user journeys + offline + sync
                 ↑
        Component + Integration (Vitest + @testing-library/svelte)
                 ↑
   Focused Unit + Extracted Pure Logic (fast, no DB/network)
```

Priorities:
1. **Pure functions & derived logic** first (fast feedback, high ROI).
2. **ID resolution, merge, and overdue rules** — these have repeatedly caused production issues.
3. **Invoice generation + billing math** paths.
4. **Sync queue processor branches** (via extraction + stubbing).
5. **Calendar interaction surfaces** primarily via E2E (FullCalendar is DOM/plugin heavy).
6. **Auth + options + toast** stores lightly (they are small).

Avoid:
- Trying to unit test every Svelte component in isolation early.
- Running real PocketBase in every unit test (too slow/flaky).
- Snapshotting entire FullCalendar DOM.

## 3. Recommended Tooling

**Core additions (devDependencies):**
- `vitest`
- `@vitest/ui` (optional nice runner)
- `@testing-library/svelte` (Svelte 5 / runes compatible version)
- `@testing-library/user-event`
- `fake-indexeddb` (or `dexie` + memory adapter; fake-indexeddb is most reliable for full Dexie)
- `happy-dom` (or jsdom) — happy-dom is lighter and often faster with SvelteKit
- `@playwright/test` for E2E
- `msw` (optional later for stubbing PB HTTP in some integration tests)

**Vite / Vitest config strategy:**
- Create `vitest.config.ts` (or extend `vite.config.ts`).
- Alias `$lib` correctly for tests.
- Setup file that installs `fake-indexeddb` globals + resets Dexie between tests.
- Environment: `happy-dom` (or `jsdom`).

**New scripts (package.json):**
```json
"test": "vitest run",
"test:watch": "vitest",
"test:ui": "vitest --ui",
"test:coverage": "vitest run --coverage",
"test:e2e": "playwright test",
"test:e2e:ui": "playwright test --ui"
```

**Svelte 5 / runes considerations:**
- Use latest `@testing-library/svelte` that supports runes (`$state`, `$derived`, `$effect`, snippets).
- For component tests, render + `await tick()` patterns still work; prefer `fireEvent` / userEvent over manual dispatch where possible.
- Test files themselves (`.test.ts`) are plain TS — no AGENTS.md runes rules apply. Any `.svelte` test fixtures should follow runes + BEM if they render real app components.

## 4. Prioritized Inventory — What to Test

### Tier 1 — Pure / Near-Pure Helpers (Start Here — Week 1)

From `src/lib/db/index.ts` and components:
- `isInvoiceOverdue(invoice)` — multiple cases (null, paid, future due, past due).
- `safeClone(obj)` — Dates, functions, Svelte proxies, deep objects, arrays.
- `dataUrlToBlob(dataUrl)` — roundtrip fidelity for common mime types (used for photos + invoice files).
- `getValidAreaOfTown(area)` (trivial now, but was complex before).
- `getUserPhotoSrc(photo, user)` — data:, http:, bare PB filename paths.
- Local date helpers (`dateToInputValue`, `inputValueToDate`, `getLocalDateString`, `parseLocalDate`, `toDateString`) from SplitCalendar + JobInvoicePanel — **critical** for avoiding the July 9 vs 10 bugs.
- Billable math helpers if extracted (subtotal, tax, total).
- Filter predicates from `/jobs` and SplitCalendar (crew/area/status matching).

**Recommendation:** Extract small pure modules early (e.g. `src/lib/utils/dates.ts`, `src/lib/utils/invoice.ts`) so they are trivial to test and reusable.

### Tier 2 — DB Layer Integration (Fake Dexie)

With `fake-indexeddb`:
- All `get*` query functions (`getUpcomingJobs`, `getJobsForRange`, `getPaginatedJobsForClient`, `getInvoiceForJob`, `getInvoicesForClient`).
- Client/job/user/invoice ID resolution (`resolveClientPbId`).
- `createJob` / `updateJob` / `cancelJob` / `ensureInvoiceForJob` / `createInvoice` — happy paths + resolution of clientId to pbId.
- Duplicate cleanup (`cleanupDuplicateUsers`).
- Basic queue item creation (`addToSyncQueue`).

**Do not** fully unit-test `processSyncQueue` as one giant function. Instead:
- Extract pure payload builders (`buildJobPbPayload`, `normalizeInvoiceForCreate`, etc.).
- Test the decision branches (has pbId? files present? 404 fallback promotion from update→create?).

### Tier 3 — Stores (Light Integration)

- `auth.svelte.ts`: session restore from localStorage + Dexie, `setCurrentUser`, `logout`.
- `options.svelte.ts`: default creation, pull logic (stub pb), save/sync paths.
- `toast.svelte.ts`: show/dismiss/clear (very fast win).

### Tier 4 — Components (Svelte Testing Library)

High value:
- `JobInvoicePanel.svelte` — Generate Draft flow (mock `generateInvoiceDocx` + `createInvoice`), file upload replace, date input helpers, status callbacks.
- `BillableItemRow.svelte` — add/edit/remove line items + totals recalc.
- `ClientForm.svelte` and `ClientPicker.svelte`.
- `JobDetailsModal.svelte` (via its module `openJobDetailsModal` + re-render after actions).
- `SyncStatus.svelte`.

Lower priority initially (or E2E only):
- FullCalendar wrappers (`Calendar.svelte`, `SplitCalendar.svelte`, `MonthPicker.svelte`) — too much plugin DOM magic.

### Tier 5 — E2E with Playwright (Golden Paths + Hard-to-Unit Surfaces)

Must-have flows:
1. Login (email) → sees crew/admin badge → calendar loads jobs.
2. Create job from calendar (select + openJobModal) → appears in list + Dexie.
3. Drag/resize job on SplitCalendar → dates update, refetch, no revert on error.
4. Mark Complete on a job → invoice created with correct dueDate from options, `generateInvoiceDocx` called, primary file metadata present.
5. Regenerate / re-upload .docx on existing invoice → correct fallback create logic exercised (the 404 paths).
6. /jobs page: apply facets (area, crew, status, has-invoice, amount, search, date range, include cancelled) → correct cards + overdue badges.
7. Clients page: expand related jobs → click row → opens JobDetailsModal with client context.
8. Offline simulation: queue items created while offline; on reconnect `processSyncQueue` is triggered (use Playwright route interception or browser context offline).
9. "Jump to calendar" from job details → Split view focuses correct date via `?date=` param.

E2E also naturally covers:
- FullCalendar + external drop to MonthPicker.
- Crew avatar rendering (photo vs letter fallback).
- PWA install / service worker precache (stretch).

## 5. Mocking & Environment Challenges (and Solutions)

| Challenge                    | Solution |
|-----------------------------|----------|
| Dexie / IndexedDB           | `fake-indexeddb` + global polyfill in `vitest.setup.ts`. Reset DB name or delete stores between tests. Use unique DB names per test file if needed. |
| PocketBase `pb` singleton   | Export a `setPbForTesting(mock)` or use `vi.mock('$lib/db/pb')`. For deeper integration, stand up a lightweight test PB container only for E2E or a dedicated "integration" suite. |
| FullCalendar                | Stub the `Calendar` constructor + `events` callback for component tests. Rely on Playwright for real drag/drop/select behavior. |
| Blobs / file uploads / docx | Construct real `Blob`/`File` in tests. For `generateInvoiceDocx`, either (a) assert on the data passed to Packer, or (b) accept the Blob and inspect via `docx` reader in test (advanced) or just verify filename + that createInvoice received a blob. |
| Dates & TZ                  | Always use the local constructors (`new Date(y,m,d)`) in tests matching production. Test around month boundaries, DST transitions if the app runs in Alaska (AKST). |
| `navigator.onLine`          | `Object.defineProperty(navigator, 'onLine', { value: true, writable: true })` + dispatch `online`/`offline` events. |
| Svelte 5 runes reactivity   | Use `@testing-library/svelte` render + `await tick()` / `fireEvent` + `waitFor`. Test derived values by asserting on rendered output after state mutations. |
| Hybrid local UUID + pbId    | Every test that touches create + pull must assert both `id` (local) and `pbId` (server) are tracked correctly, and queries use the defensive `anyOf([local, pb])` sets. |
| Queue promotion / 404 fallbacks | These are the most important sync tests. Reproduce the exact scenarios from the comments (regenerate on local-only invoice, 404 on update after server delete). |

## 6. Phased Implementation Roadmap

**Phase 0 — Infrastructure (1–2 days)**
- Add vitest + testing libs + fake-indexeddb + playwright to package.json + pnpm install.
- `vitest.config.ts` + `vitest.setup.ts` (fake-indexeddb + $lib alias + Dexie reset helper).
- Playwright config (`playwright.config.ts`) with SvelteKit dev server or preview.
- Add test scripts.
- First green "smoke" test file (e.g. `src/lib/db/utils.test.ts`).

**Phase 1 — Pure Logic (highest confidence, fastest)**
- `isInvoiceOverdue`, `safeClone`, date helpers, `getUserPhotoSrc`.
- Extract date + invoice utils if not already.
- Add coverage reporting.

**Phase 2 — Dexie-backed queries + CRUD helpers**
- Query functions + ID resolution.
- `create*` / `update*` optimistic paths (assert queue items + local records).
- `cleanupDuplicateUsers`.

**Phase 3 — Critical business rules + extracted sync pieces**
- `ensureInvoiceForJob` + due date calculation from options.
- Invoice create/update with files (metadata only).
- Refactor `processSyncQueue` lightly to expose testable decision functions.
- Test the 404 + "promote update to create" branches.

**Phase 4 — Stores + small components**
- auth / options / toast.
- BillableItemRow, JobInvoicePanel (with heavy mocking of db + docx).

**Phase 5 — E2E golden paths (Playwright)**
- Implement the 9 flows listed in Tier 5.
- Add offline/online context toggling.
- Add a few visual regression anchors if useful (calendar layout after filters).

**Phase 6 — Polish, CI, Gates**
- GitHub Actions (or whatever CI) matrix: unit + e2e.
- Coverage threshold (start conservative: 60% statements on lib/db + utils, raise over time).
- Contract tests or property-based tests for ID resolution (optional advanced).
- Update readme + AGENTS.md notes about running tests.
- Add "how to add a test for a new db helper" section.

## 7. CI / Quality Gates

- Unit tests must pass on every PR.
- E2E on main + scheduled (they are slower and may require a PB instance or heavy mocking).
- Coverage report artifact (do not fail PRs on coverage drops initially).
- Lint + typecheck already exist — keep them as pre-requisites.

Example minimal GitHub Action sketch (to be added later):
```yaml
- run: pnpm test
- run: pnpm test:e2e   # with a headed=false + a test PB or mocked routes
```

## 8. Long-Term / Nice-to-Haves

- Property-based testing on `safeClone` + ID resolution sets.
- Snapshot testing of the generated .docx structure (via a docx parser) for invoice fidelity.
- Visual regression on calendar views (Percy / Chromatic / Playwright screenshots) once the UI stabilizes.
- Contract tests between the queue processor and the expected PB collection schemas.
- Performance smoke for large job lists (1000+ jobs) in the /jobs page enrichment.

## 9. Compliance Notes (AGENTS.md)

- This plan document itself follows the spirit: references the repo, notes history from comments.
- When implementing tests that touch `.svelte` files, the rendered components must remain 100% runes + BEM.
- New test utilities in `src/lib` should be plain TS (no Svelte 4 patterns) and carry `)= -` comments for meaningful changes.
- Prefer extracting pure functions over testing through side-effecty component or db functions.

---

**Next concrete step after plan approval:**
Run the setup commands in Phase 0 and land the first passing unit test for `isInvoiceOverdue` + `safeClone`. This gives immediate green feedback and a template for all future tests.

**References:**
- JOBS_AND_INVOICES_SPEC.md (especially overdue derivation, file handling, ID resolution)
- All the `)= -` comments in `src/lib/db/index.ts` and `src/lib/db/pb.ts` that document past ID/sync bugs
- AGENTS.md (Svelte 5 runes, BEM, TypeScript, `async: true`)

This plan is intentionally pragmatic: it attacks the actual sources of bugs in this codebase rather than chasing 100% coverage of UI chrome.

---

## Current Progress (live updates as we "keep going")

**Latest status:**

- **6 test files** (src/lib/db/index.test.ts, src/lib/utils/dates.test.ts, src/lib/stores/toast.test.ts, src/lib/stores/options.test.ts, src/lib/stores/auth.test.ts, tests/e2e/basic.spec.ts)
- **~60 passing tests** (a few component tests remain skipped due to Svelte 5 + happy-dom + `@testing-library/svelte` server-build resolution for `mount`/`$state` — the skeleton + comments are ready; the plan itself recommends leaning on E2E for complex UI like FullCalendar anyway).
- High-value coverage added in recent iterations:
  - Pure logic + extracted, hardened date utilities (`dates.ts`, `calculateDueDate`).
  - DB queries, ID resolution, `ensureInvoiceForJob`, and optimistic CRUD (`createJob` with client/tax/billable defaults + queue, `updateJob`, `cancelJob`, `createClient`, `createInvoice`).
  - Stores: toast (complete), options (default creation + load), auth (set/logout + session restore with mocks for browser + localStorage + Dexie).
  - Basic E2E smoke test using the existing playwright.config.
- Every meaningful change carries `)= -` comments + references to Remedine/Svelte_FullCalendar_Dexie_Scheduling and this plan.
- `pnpm test` is green after every batch. Playwright is installed and the E2E config + webServer are wired.

See the agent's internal todo list for granular next items. We continue to follow the phased pyramid in this document.

**Latest status (continued "keep going" iteration):**
- **7+ test files** (E2E further expanded in login-page.spec.ts with jobs page shell test using chained route mocks for auth + jobs + clients + users + invoices + options; previous calendar and login flows; db/index.test.ts includes processSyncQueue mock).
- **66+ passing tests** (unit/DB/store strong; E2E not in unit run but syntax/structure good).
- Advanced Phase 5 more (mocked login + /jobs page with sample data, verifying job cards, invoice badges, filters per JOBS_AND_INVOICES_SPEC.md Phase 5/7).
- `)= -` comments added for the new E2E jobs-with-data test section (mocks for realistic cards and badges).
- Additional unit test for generateInvoiceDocx (handles missing client gracefully, using clientId fallback in doc).
- Extended optionsStore tests with saveToDexie (persists and updates state) and note on pull coverage.
- Component testing remains deprioritized (E2E preferred for complex surfaces like FullCalendar, modals, invoice panel per plan).
- `pnpm test` green (db tests now 37 in index.test.ts, stores expanded). E2E patterns established for post-auth views (calendar, jobs) with mocks to avoid real PB dependency, including data-driven cards.
- Phase 6: CI starter in place; plan updated.

Progress tracked; next could be E2E for invoice generate flow or more sync mocks. Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling + this plan.

**Example GitHub Actions (Phase 6 starter - added in this iteration):**
```yaml
name: Test
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - run: pnpm install
      - run: pnpm test
      - run: pnpm test:e2e  # may need setup for browsers/PB
```
(See .github/workflows/test.yml for the file.)