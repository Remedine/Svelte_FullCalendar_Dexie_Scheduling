# Agent C: Calendar & Jobs

**Commit reviewed:** `64e9233`  
**Workspace:** Capital City Windows CRM (offline-first SvelteKit)  
**Date:** 2026-07-16  
**Scope:** `src/lib/calendar/**`, job modals/panels, `/jobs` + `/calendar` routes, `calendar.ts` / `crew.ts` / `dates.ts`

---

## Scope

| Area | Paths | Approx size |
|------|--------|-------------|
| Split calendar god-component | `src/lib/calendar/SplitCalendar.svelte` | **2666 lines** |
| Legacy calendar (unused) | `src/lib/calendar/Calendar.svelte` | ~200+ lines |
| Month picker | `src/lib/calendar/MonthPicker.svelte` | ~local date dupes |
| Job form (create/edit from calendar) | `src/lib/components/JobFormModal.svelte` | **1264 lines** |
| Job details (from /jobs + clients) | `src/lib/components/JobDetailsModal.svelte` | **~850+ lines** |
| Orphan invoice panel | `src/lib/components/JobInvoicePanel.svelte` | **~922 lines** (superseded) |
| Active invoice UI | `src/lib/components/InvoiceEditor.svelte` | snapshot editor |
| Jobs list | `src/routes/(app)/jobs/+page.svelte` | rich filters + cards |
| Calendar routes | `calendar/+page.svelte`, `calendar/split/+page.svelte` | both mount SplitCalendar |
| Utils | `utils/calendar.ts`, `crew.ts`, `dates.ts` | small, mostly solid |

---

## Summary

Calendar and jobs are the most multi-model, multi-phase surface in the app. **Read paths** for crew scoping are partially centralized (`isJobAssignedToCrew`), and date TZ helpers are mostly extracted to `dates.ts`. **Write paths and UX**, however, are split across two competing job modals, two complete/cancel policies, display-name crew identity, and a single FullCalendar component that owns mobile gestures, filters, realtime, optimistic patches, and DOM avatar chrome.

Highest-impact issues:

1. **Crew role falls open to all jobs** when display name is empty.  
2. **Complete rules disagree** between form (end-time gate + deep-link to invoice) and details (start-time gate + inline status).  
3. **`assignedCrew` is display-name identity** — fragile across rename, first/last vs `name`, trim mismatches.  
4. **Calendar opens JobForm; jobs page opens JobDetails** — duplicated cancel/complete and no shared read surface from schedule.  
5. **SplitCalendar is a maintenance bottleneck** (~2.7k lines) and blocks safe role / mobile refactors.

Utils (`calendar.ts`, `dates.ts`, partial `crew.ts`) are the bright spot and a model for further extraction.

---

## Findings

### F1 — Crew scope fails open when display name is empty

| Field | Value |
|-------|--------|
| **Severity** | **High** |
| **File:line** | `src/lib/calendar/SplitCalendar.svelte:1062-1067`; `src/routes/(app)/jobs/+page.svelte:224-228`; `src/lib/calendar/Calendar.svelte:115-118` |
| **Theme** | Role-based views / assignedCrew |
| **Description** | When `role === 'crew'`, jobs are filtered by `getUserDisplayName(auth.currentUser)`. If that string is empty (`name` and first/last missing), SplitCalendar **returns the full `jobs` array**, and the jobs page **applies no crew filter**. |
| **Why** | Privacy / data isolation failure: a crew user with incomplete profile data sees every scheduled job (including unassigned and other crews). Offline-first means this is client-enforced only. |
| **Fix** | Fail closed: if role is crew and no resolvable display name (or better, no user id match), show empty list + toast/profile prompt. Prefer matching on stable user id/pbId once `assignedCrew` is migrated. |
| **Effort** | S |

```1062:1067:src/lib/calendar/SplitCalendar.svelte
	const crewScopedJobs = $derived.by(() => {
		if (auth.currentUser?.role !== 'crew') return jobs;
		const crewName = getUserDisplayName(auth.currentUser);
		if (!crewName) return jobs;
		return jobs.filter((job: any) => isJobAssignedToCrew(job, crewName));
	});
```

---

### F2 — Complete job gate is inconsistent (end vs start)

| Field | Value |
|-------|--------|
| **Severity** | **High** |
| **File:line** | `JobFormModal.svelte:227-234`, `366-426`; `JobDetailsModal.svelte:199-208`, `386-392` |
| **Theme** | Cancel/complete |
| **Description** | **Form:** `canCompleteJob` requires `now >= job.end`, saves full payload as `completed`, `ensureInvoiceForJob(..., 'generated')`, navigates to `/jobs?jobId=…&tab=invoice`. **Details:** “Mark complete” is disabled only when `now < job.start`, calls `updateJob` status only (no billable re-save), same invoice helper, stays in modal. |
| **Why** | Same business action has different eligibility windows and side effects. A job past start but before end is completable from details, not from form; form may re-write totals/tax from current form state. |
| **Fix** | Single pure helper, e.g. `canCompleteJob(job, now)` + `completeJob(jobId)` in `$lib/db` used by both UIs. Align policy (recommend end-time gate + invoice generation + optional deep-link). |
| **Effort** | M |

```227:234:src/lib/components/JobFormModal.svelte
	const canCompleteJob = $derived(
		isEditing &&
			!!editingJobId &&
			currentJob.status !== 'completed' &&
			currentJob.status !== 'cancelled' &&
			!!jobEndDate &&
			new Date() >= jobEndDate
	);
```

```199:208:src/lib/components/JobDetailsModal.svelte
	async function quickUpdateJobStatus(newStatus: Job['status']) {
		if (!job?.id) return;
		if (newStatus === 'completed' && new Date() < new Date(job.start)) {
			alert('Cannot mark complete before the job start time.');
			return;
		}
		await updateJob(job.id, { status: newStatus });
		if (newStatus === 'completed') {
			await ensureInvoiceForJob(job, 'generated');
```

---

### F3 — `assignedCrew` is display-name identity (systemic)

| Field | Value |
|-------|--------|
| **Severity** | **High** |
| **File:line** | `src/lib/db/index.ts:199`, `509-520`; `src/lib/utils/crew.ts:11-17`; `JobFormModal.svelte:151-169`, `566-571`; `SplitCalendar.svelte:819-830`, `1071-1075`; `crewAssignment.ts:19-25` |
| **Theme** | assignedCrew model bugs |
| **Description** | Jobs store `assignedCrew: string[]` of human display names. Matching is inconsistent: `isJobAssignedToCrew` trims both sides; form checkbox uses exact `.includes(crew)`; calendar filter uses `filters.crew.includes(c)` without trim; form crew list uses only `u.name` while SplitCalendar uses `name \|\| first+last`; notifications resolve users by the same fragile name equality. DB has `getUserCrewNameAliases` for rename propagation — proof the model is brittle. |
| **Why** | Rename, missing `name`, whitespace, or first/last-only users break assignment, crew filters, photos, notifications, and role scoping independently. MultiEntry Dexie index equals exact strings only. |
| **Fix** | Short term: one `resolveCrewLabel(user)` + always-trim compare (expand `isJobAssignedToCrew` / form options). Medium: store user `pbId`s (or local ids) in `assignedCrew`, keep display name derived. |
| **Effort** | M (trim/unify) / L (id migration) |

---

### F4 — Calendar vs jobs: two job UX surfaces (form vs details)

| Field | Value |
|-------|--------|
| **Severity** | **Medium** |
| **File:line** | `SplitCalendar.svelte:1330`, `1502`, `1514`, `1524`; `jobs/+page.svelte:403-406`, `194-196`; `+layout.svelte:368-371` |
| **Theme** | Duplication between jobs page and calendar modals |
| **Description** | Calendar click/select opens **JobFormModal** (edit/create). Jobs cards / deep links open **JobDetailsModal** (read + invoice + light actions → form on “Edit job”). Cancel UI is fully duplicated (confirm modal in form vs inline form in details) with different layout/copy. |
| **Why** | Spec intended details modal as the shared hub (`JOBS_AND_INVOICES_SPEC.md`); calendar never adopted it. Users complete/cancel/invoice from different places with different rules (see F2). |
| **Fix** | Calendar event click → `openJobDetailsModal` (with edit callback); keep form for create + full edit only. Extract shared `CancelJobForm` snippet/component. |
| **Effort** | M |

---

### F5 — No write role gates on calendar for crew

| Field | Value |
|-------|--------|
| **Severity** | **Medium** |
| **File:line** | `SplitCalendar.svelte:1310` (`editable: true`), `1330`, `1501-1503`, `1535-1564` |
| **Theme** | Role-based views |
| **Description** | Crew users are filtered on **read** but still get FullCalendar `editable: true`, dateClick/select create, drag/resize, and full JobForm (crew assign, billables, cancel). There is no `auth.currentUser.role` check around write handlers. |
| **Why** | If product intent is “crew sees only my jobs,” they can still reschedule, cancel, reassign, or create jobs from calendar. PocketBase rules may or may not block server-side; local Dexie + sync queue will still accept optimistic writes. |
| **Fix** | Explicit policy: either crew read-only calendar (`editable: false`, no select/create, form read-only) or document that crew is trusted full editor on assigned jobs only. Enforce in UI + ideally PB rules. |
| **Effort** | S–M |

---

### F6 — ID type mess: `id` vs `pbId` vs clientId resolution

| Field | Value |
|-------|--------|
| **Severity** | **Medium** |
| **File:line** | `JobFormModal.svelte:118` (`editingJobId = job.id \|\| null`); `JobDetailsModal.svelte:79-89` (string open = `db.jobs.get` only); `jobs/+page.svelte:188-191` (id **and** pbId); `SplitCalendar.svelte:662`, `772-778`, `1111-1116`; `updateJobDates` in `db/index.ts:775-800` |
| **Theme** | ID type mess |
| **Description** | Highlight/jump paths dual-match `id`/`pbId`. Form edit key is **only** `job.id`. Details string open misses `where('pbId')`. `updateJobDates` resolves both and patches siblings; form `updateJob`/`cancelJob` do not. Deep link after complete uses Dexie id, which is good if `editingJobId` was local id. |
| **Why** | After sync, dual rows or PB-only ids cause “Job not found”, failed save/cancel, or optimistic patch missing the calendar snapshot row. |
| **Fix** | Shared `resolveJobByAnyId(id): Promise<Job \| null>` used by form open, details open, deep links, and updates. Prefer always operating on canonical Dexie `job.id` after resolve. |
| **Effort** | M |

---

### F7 — Status model incomplete in calendar filters (`confirmed` missing)

| Field | Value |
|-------|--------|
| **Severity** | **Low–Medium** |
| **File:line** | `db/index.ts:200` (`'scheduled' \| 'confirmed' \| 'completed' \| 'cancelled'`); `SplitCalendar.svelte:633`, `1785`; bulk schema allows `confirmed` |
| **Theme** | Options / status coupling |
| **Description** | Calendar status chips are only scheduled/completed/cancelled. Jobs with `status: 'confirmed'` appear when no status filter is active, but cannot be targeted by status chip and get no dedicated CSS class (only completed/cancelled styled). |
| **Why** | Import/bulk can produce `confirmed`; calendar UI pretends the enum is 3-valued. |
| **Fix** | Either drop `confirmed` from the domain or add chip + event class + complete guards. |
| **Effort** | S |

---

### F8 — Cancelled jobs visibility: dual flags + jump coupling

| Field | Value |
|-------|--------|
| **Severity** | **Medium** |
| **File:line** | `SplitCalendar.svelte:629`, `915-924`, `969-976`, `1211-1220`, `1676-1693`; `JobDetailsModal.svelte:185-195` |
| **Theme** | Cancel/complete / options coupling |
| **Description** | Cancelled jobs are excluded at **fetch** (`getJobsForRange(..., includeCancelled)`) unless status filter includes cancelled **or** `jumpShowCancelled` from `?status=cancelled`. Filter toggle reloads data; date URL sync clears `status` and jump mode. Default job list on jobs page also hides cancelled unless toggled. |
| **Why** | Correct for performance, but easy to “lose” a cancelled job when navigating dates after jump-to-calendar. Cognitive load of two booleans (`filters.statuses` + `jumpShowCancelled`). |
| **Fix** | Single source of truth for includeCancelled; when jump mode clears, optionally leave cancelled chip on. Document in UI. |
| **Effort** | S |

---

### F9 — Options coupling on open paths (pull thrash)

| Field | Value |
|-------|--------|
| **Severity** | **Low–Medium** |
| **File:line** | `JobFormModal.svelte:78-85` (load + `pullFromPB` every open); `SplitCalendar.svelte:1139-1147` (pull on loadData deliberately removed); `JobDetailsModal.svelte:113-117` (load if missing only) |
| **Theme** | Options coupling |
| **Description** | Form aggressively pulls options when online on every open (areas, cancel reasons, tax, default duration/billables). Calendar intentionally stopped unconditional options pull for perf. Details only loads if empty. |
| **Why** | Correctness vs latency tradeoff is inconsistent; form open can be slow offline-to-online; calendar can show stale area colors until options hydrated elsewhere. |
| **Fix** | Shared `optionsStore.ensureFresh({ maxAgeMs })`; form and calendar use same policy. |
| **Effort** | S |

---

### F10 — Dead / superseded surfaces

| Field | Value |
|-------|--------|
| **Severity** | **Medium** (maintenance) |
| **File:line** | `Calendar.svelte` (no imports in `src/`); `JobInvoicePanel.svelte` (no component imports; spec says InvoiceEditor replaced it); dual routes `calendar/+page.svelte` + `calendar/split/+page.svelte` |
| **Theme** | God-component / duplication |
| **Description** | Legacy week calendar and old invoice panel still in tree (~1.1k+ lines). Two routes mount the same SplitCalendar with **different mobile height CSS**, risking “works on /calendar but not /split” bugs. |
| **Why** | Reviewers and agents waste time; tests/docs still reference JobInvoicePanel (`TESTING_PLAN.md`). |
| **Fix** | Delete or quarantine dead files; redirect one calendar route; update docs. |
| **Effort** | S |

---

### F11 — MonthPicker Svelte 4 residue + date helper duplication

| Field | Value |
|-------|--------|
| **Severity** | **Low** |
| **File:line** | `MonthPicker.svelte:4-7` (`createEventDispatcher`, never dispatched); `47-61` (local `getLocalDateString` / `toDateString`); SplitCalendar imports shared utils at `18` |
| **Theme** | Multi-model / dates |
| **Description** | MonthPicker still has unused dispatcher and reimplements date string helpers instead of `$lib/utils/dates`. |
| **Why** | AGENTS.md bans legacy patterns; TZ bugs can reappear if helpers diverge. |
| **Fix** | Import shared dates; remove dispatcher; use callback props only (already present). |
| **Effort** | S |

---

### F12 — Jobs page “this week” ignores shared `startOfLocalWeek`

| Field | Value |
|-------|--------|
| **Severity** | **Low** |
| **File:line** | `jobs/+page.svelte:267-272`; `dates.ts:103-108` |
| **Theme** | Duplication / dates |
| **Description** | `dates.ts` documents `startOfLocalWeek` as matching jobs “This week” filter, but jobs page inlines the same Sunday logic. Date range filters use `new Date(dateFrom)` (UTC-parse risk for `YYYY-MM-DD` in some browsers). |
| **Why** | Drift risk; date-input TZ bugs were a known historical pain. |
| **Fix** | Use `startOfLocalWeek` + `parseLocalDate` / `inputValueToDate` for range filters. |
| **Effort** | S |

---

### F13 — Mobile vs desktop complexity concentrated in SplitCalendar

| Field | Value |
|-------|--------|
| **Severity** | **Medium** (architecture) |
| **File:line** | `SplitCalendar.svelte:214-615` (mobile resize/scroll); `641-765` (viewport/day-only); `1316-1319` (long-press delays); `1505-1520` (tap-to-select then open); `calendar/+page.svelte:46-74` vs `split/+page.svelte:33-50` |
| **Theme** | Mobile vs desktop |
| **Description** | Mobile: forced day view, custom touch resize, edge auto-scroll, month-picker drag dwell, different long-press (1s vs 280ms), two-tap open. Desktop: week/month switcher, native FC resize. Layout height contract differs between the two calendar routes. |
| **Why** | Hard to test; regressions on one viewport silently reappear; god-component grows with every mobile fix. |
| **Fix** | Extract `mobileCalendarGestures.ts` + `useCalendarViewport.svelte.ts`; single layout wrapper for both routes. |
| **Effort** | L |

---

### F14 — JobForm crew options only `u.name` (active filter strict)

| Field | Value |
|-------|--------|
| **Severity** | **Medium** |
| **File:line** | `JobFormModal.svelte:155-159`; compare `SplitCalendar.svelte:824-829`; jobs page `413-428` uses `active !== false` + first/last fallback |
| **Theme** | assignedCrew model bugs |
| **Description** | Form: `users.filter((u) => u.active).map((u) => u.name)` — drops users with empty `name` even if first/last exist; `u.active` falsy excludes undefined-active legacy rows. Jobs facets are more tolerant. Assigned names already on the job that are not in `crewOptions` cannot be toggled off via UI cleanly. |
| **Why** | Assignment UI and calendar filter chips can list different people. |
| **Fix** | Shared `listAssignableCrew(): { label, photo, userId }[]` using `getUserDisplayName` + `active !== false`. |
| **Effort** | S |

---

### F15 — Heavy narrative comments / perf archaeology in production UI

| Field | Value |
|-------|--------|
| **Severity** | **Low** (maintainability) |
| **File:line** | Throughout SplitCalendar (e.g. `25-30`, `851-866`, `1101-1110`, `1642`, `1676-1685`); JobDetails/Jobs Phase comments |
| **Theme** | Multi-model fingerprints |
| **Description** | Very long “why we removed refetch”, “Phase N”, “Batch A/B”, “dog slow”, Railway Rolldown notes embedded in component. |
| **Why** | Signal multi-agent iterative fixes without extracting modules; noise for human readers; comments sometimes reference removed code. |
| **Fix** | Move rationales to `docs/` ADR; keep one-line pointers in code. |
| **Effort** | S |

---

## Decomposition map

### `SplitCalendar.svelte` (~2666 lines) — cut lines

```
SplitCalendar.svelte (shell: layout + wiring, target ~300–400 lines)
│
├── calendar/
│   ├── fcConfig.ts                 # plugins, slot bounds, long-press, editable policy
│   ├── jobsRange.ts                # getCalendarJobsRange / reload / includeCancelled
│   ├── optimisticDates.ts          # applyOptimisticDatePatch
│   ├── eventMappers.ts             # job → FC event; classNames; colors
│   ├── highlightJump.ts            # ?jobId / ?date / scrollToHighlightedJob
│   ├── filters.svelte.ts           # crew/area/status filters + localStorage
│   └── realtimeRefresh.ts          # onJobsRealtime + poll + APP_DATA_SYNCED
│
├── calendar/mobile/
│   ├── edgeAutoScroll.ts
│   ├── touchResize.ts              # activeMobileResize gesture
│   └── selection.ts                # selectedMobileEventId / suppress dateClick
│
├── calendar/dnd/
│   ├── monthPickerDwell.ts         # edge-dwell month step while dragging
│   └── externalDrop.ts             # drag to MonthPicker day
│
├── components/
│   ├── CalendarFilters.svelte      # crew avatars / area chips / status (lines ~1711–1810)
│   ├── CalendarViewSwitcher.svelte # day/week/month (~1815–1832)
│   └── MonthPicker.svelte          # already separate; purge local date dupes
│
└── styles/
    └── split-calendar.css          # ~800 lines of FC/BEM CSS currently inlined
```

**Suggested extraction order (lowest risk first):**

1. CSS + MonthPicker date utils  
2. `jobsRange` + filters pure functions (unit testable)  
3. Mobile gesture modules (largest bug surface)  
4. FC init factory  
5. Thin presentational filter/view chrome  

### Job surfaces — cut lines

```
Job domain
├── $lib/jobs/completeJob.ts        # F2: single complete + invoice
├── $lib/jobs/cancelJobUi.svelte    # shared cancel reason UI
├── $lib/jobs/resolveJob.ts         # F6: id/pbId
├── $lib/jobs/crewLabels.ts         # F3/F14: list + match
│
├── JobFormModal.svelte             # create + full edit only (~keep form fields)
├── JobDetailsModal.svelte          # read hub; complete/cancel via shared helpers
├── InvoiceEditor.svelte            # keep (active)
└── JobInvoicePanel.svelte          # DELETE (orphaned)
```

### Route cleanup

| Route | Action |
|-------|--------|
| `/calendar` | Keep as primary; own layout height contract |
| `/calendar/split` | Redirect to `/calendar` or thin re-export with **identical** CSS |
| `Calendar.svelte` | Delete if unused (confirm no dynamic import) |

---

## Multi-model fingerprints

| Fingerprint | Where | Signal |
|-------------|--------|--------|
| `)= -` change markers + Phase N / Batch A/B | SplitCalendar, JobDetails, jobs page, dates.ts | Multi-agent “mark every edit” convention from AGENTS/spec |
| Remedine repo reference repeated in comments | Many files | Template copy-paste across models |
| Spec-driven Phase 5/7 comments vs calendar “perf plan” comments | jobs/details vs SplitCalendar | Different authors/sessions for list vs schedule |
| Aggressive offline-first + optimistic FC patches | SplitCalendar | Later performance pass layered on earlier FullCalendar integration |
| InvoiceEditor replaces JobInvoicePanel but both remain | components/ + docs | Incomplete cleanup after invoice redesign |
| Svelte 5 runes in most places; `createEventDispatcher` leftover | MonthPicker | Partial migration |
| Display-name crew + later `getUserCrewNameAliases` / rename helpers | db + crew utils | Patch series rather than redesign |
| Dual calendar routes with divergent mobile CSS | `calendar/` vs `calendar/split/` | Parallel layout experiments |
| `alert()` in form/details vs `toast` on calendar | JobForm/JobDetails vs SplitCalendar | UX inconsistency across authors |
| God-file with DOM `createElement` for avatars | SplitCalendar `eventDidMount` | FullCalendar imperative style mixed into Svelte |

---

## Top 5 cleanup actions

1. **Fail closed crew scoping + unify crew label matching** (F1, F3, F14)  
   - Empty name → no jobs; shared `resolveCrewLabel`; trim everywhere including form checkboxes and filter chips.

2. **Single `completeJob` / cancel policy** (F2, F4)  
   - One gate, one invoice side-effect path; both modals call it; prefer details as read hub from calendar clicks.

3. **`resolveJobByAnyId` for all open/edit/deep-link paths** (F6)  
   - Form, details, jobs deep link, calendar highlight already half-do this — finish the job.

4. **Carve SplitCalendar** (F13, decomposition map)  
   - Extract mobile gestures + filters first; target shell &lt; 500 lines for future role/editable policy work (F5).

5. **Delete dead code + unify calendar routes** (F10, F11)  
   - Remove `JobInvoicePanel`, unused `Calendar.svelte`, MonthPicker dispatcher; one calendar URL/layout.

---

## Utils health (in scope)

| Module | Verdict |
|--------|---------|
| `utils/calendar.ts` | Good: pure slot bounds; unit tested |
| `utils/dates.ts` | Good: local YYYY-MM-DD discipline; jobs page should consume more of it |
| `utils/crew.ts` | Incomplete: only display-name equality; needs aliases + fail-closed helpers |

---

## Out of scope notes (touched but not deep-reviewed)

- PocketBase collection rules for jobs (whether crew writes are server-blocked)  
- Full `InvoiceEditor` / docx pipeline correctness  
- Realtime `applyServerJobRecord` merge semantics beyond calendar refresh wiring  

---

## Final

**Report path:** `docs/reviews/2026-07-16-multi-agent/agents/C-calendar-jobs.md`

**Top 3 (act first):**

1. **Crew fail-open + name-identity bugs** — security/UX isolation (`SplitCalendar.svelte:1062-1067`, form/filter mismatch).  
2. **Complete/cancel policy split** — form end-gate vs details start-gate (`JobFormModal.svelte:227-234` vs `JobDetailsModal.svelte:199-208`).  
3. **SplitCalendar decomposition** — 2666-line god-component blocks safe mobile/role work; extract gestures + filters + job resolution next.
