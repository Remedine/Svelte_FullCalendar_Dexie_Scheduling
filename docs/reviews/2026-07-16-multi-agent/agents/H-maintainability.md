# Agent H: Maintainability & structure

**Repo:** CapitalCity Windows CRM  
**Commit lens:** `64e9233` (workspace as reviewed)  
**Date:** 2026-07-16  
**Scope:** Structural quality / code-judo only (not product bugs or security depth).  
**Read-only** on product source; this file is the sole write target.

---

## Summary

The codebase is a local-first Svelte 5 + Dexie + PocketBase CRM that has grown through successive “phase” feature drops (invoices, backups/Drive, quick-unlock, mobile calendar). **Three files alone (~8k lines)** concentrate most operational risk: `src/lib/db/index.ts` (~2.7k), `src/lib/calendar/SplitCalendar.svelte` (~2.6k), and `src/routes/(app)/admin/options/+page.svelte` (~2.8k).

Positive signals already exist: invoice pure utils were extracted (`invoiceTotals`, `invoiceSnapshot`, `invoiceDocx/*`, `dates`, `tax`, `crew`); backups have a small pure package under `src/lib/backups/`; auth has a dedicated `src/lib/auth/*` cluster; user merge logic partially lives in `userSync.ts`.

The main maintainability debt is **god-modules and dual survivors**: dead legacy components still ship, the same domain behavior is implemented twice (invoice UI, auth logout, date helpers, photo force-modals), and the sync queue’s invoice path is a **copy-paste state machine** (~800 lines of near-identical FormData create/update/fallback blocks). Cleanup that deletes dead paths and collapses those copies would remove **~2–3k lines of concepts** without changing user-facing behavior.

---

## Findings (Severity = maintainability impact)

### Critical

1. **File:** `src/lib/db/index.ts:1883–2674`  
   **Theme:** God-module / spaghetti branching  
   **Description:** `runProcessSyncQueue` is a single nested `for` + multi-level `if (collection) if (type)` tree covering jobs, clients, users, and invoices. Invoice handling alone (~2176–2657) repeats FormData append + create/update + “promote create → update” + “404 → create fallback” **four times** with only minor differences.  
   **Why:** Every invoice/file edge case requires editing the same shape in multiple places; regressions are likely; unit testing a single branch is impractical.  
   **Suggested structural fix:** Extract `src/lib/db/sync/` with handlers `processJobQueueItem`, `processClientQueueItem`, `processUserQueueItem`, `processInvoiceQueueItem`, plus helpers `buildInvoiceFormData(local, files, deletes, relations)` and `pushInvoiceCreate|Update`. Keep `processSyncQueue` as single-flight orchestration only.  
   **Effort:** L (1–2 days for extract + smoke tests)  
   **Confidence:** high  
   **Would block a cleanup PR?** no (cleanup *is* the PR; must not change success/failure semantics)

2. **File:** `src/lib/db/index.ts` (whole file, ~2701 lines)  
   **Theme:** Wrong layer / barrel god-object  
   **Description:** One module owns: Dexie schema + multi-version upgrades, domain types (`Client`/`Job`/`User`/`Invoice`/`AppOptions`), CRUD for all collections, invoice snapshot domain logic, id resolution, photo/blob helpers, re-exports of pure invoice utils, *and* the entire sync engine. Call sites import the kitchen sink via `$lib/db`.  
   **Why:** Circular-dependency workarounds (`import('$lib/stores/auth.svelte')` at top), high coupling, slow navigation/review, impossible “small PR” for schema vs UI.  
   **Suggested structural fix:** Split into packages under `src/lib/db/`:
   - `schema.ts` / `types.ts` / `dexie.ts`
   - `jobs.ts`, `clients.ts`, `users.ts`, `invoices.ts`
   - `sync/queue.ts` + collection handlers
   - thin `index.ts` re-export for compatibility  
   **Effort:** L–XL (mechanical first, then tighten imports)  
   **Confidence:** high  
   **Would block a cleanup PR?** no

3. **File:** `src/lib/calendar/SplitCalendar.svelte` (~1–1700 script + ~1700–2620 styles)  
   **Theme:** God-component / special-case growth  
   **Description:** Single component owns FullCalendar init, job load/dedup/realtime, crew photos, filters, URL deep-link highlight, month-picker edge dwell, external drop, desktop drag, **and** a large mobile touch/resize/edge-scroll subsystem (~200–600). Nested `$effect` graph (~15+) refetches/reinits in subtle order.  
   **Why:** Mobile vs desktop calendars share one mutation surface; “fix drag” PRs routinely touch unrelated filter/realtime code.  
   **Suggested structural fix:** Decompose into:
   - `useSplitCalendarJobs.svelte.ts` (load, range, filters, realtime)
   - `mobileCalendarGestures.ts` (resize/selection/edge-scroll)
   - `monthPickerDragBridge.ts` (edge dwell + external drop)
   - `SplitCalendar.svelte` shell + FC config only  
   Extract large `:global(.fc-*)` CSS to `split-calendar.css`.  
   **Effort:** L  
   **Confidence:** high  
   **Would block a cleanup PR?** no

### High

4. **File:** `src/routes/(app)/admin/options/+page.svelte` (~2800 lines)  
   **Theme:** Page as multi-app  
   **Description:** One route tab-shell contains scheduling (areas/billables/cancel reasons + reorder clones), security, invoice letterhead, **full backups UX** (server list, Drive OAuth status, unify rows, restore dialog, upload, scheduled hour), and embeds `BulkImportPanel`. Triple-comment residue documents removed guards thrice. Local `safeClone` duplicates db helper.  
   **Why:** Backups/Drive churn forces full options page review; list/move helpers for three option arrays are copy-paste.  
   **Suggested structural fix:** Tab components: `OptionsScheduling.svelte`, `OptionsInvoice.svelte`, `OptionsSecurity.svelte`, `OptionsBackups.svelte` (import already partially separated). Shared `reorderListHelpers.ts` for up/down/default. Import `safeClone` from `$lib/db`.  
   **Effort:** M–L  
   **Confidence:** high  
   **Would block a cleanup PR?** no

5. **File:** Dead duals — `JobInvoicePanel.svelte` (~922), `Calendar.svelte` (~214), `ForcePhotoUpdateModal.svelte` (~266)  
   **Theme:** Multi-model merge residue / dead code  
   **Description:**
   - Live invoice UI is `InvoiceEditor` via `JobDetailsModal`; `JobInvoicePanel` is **never imported**.
   - Live calendar routes both mount `SplitCalendar`; `Calendar.svelte` is **never imported**.
   - Login uses `ForcePhotoUpdate`; `ForcePhotoUpdateModal` is a near-duplicate and **unused**.  
   **Why:** Reviewers and greps keep landing on obsolete APIs (`createInvoice`+`generateInvoiceDocx` draft path vs snapshot editor). Inflates perceived surface area.  
   **Suggested structural fix:** Delete the three dead files in a dedicated PR; confirm with `rg` + build.  
   **Effort:** S  
   **Confidence:** high  
   **Would block a cleanup PR?** no — **should be first cleanup PR**

6. **File:** `InvoiceEditor.svelte` (~1533) + dead `JobInvoicePanel.svelte`  
   **Theme:** Duplicated domain behavior  
   **Description:** `fetchPrimaryInvoiceBlob` + base64 email send + supporting upload/remove patterns are duplicated nearly line-for-line. Even after deleting the dead panel, InvoiceEditor still embeds email/blob I/O that belongs in `$lib/utils` or `$lib/invoices/clientActions.ts`.  
   **Why:** Future send-email API changes will miss one path if anything reintroduces a second panel.  
   **Suggested structural fix:** Extract `sendInvoiceEmail(invoice, job, clientEmail, amount)` and `fetchPbInvoiceBlob`.  
   **Effort:** S–M  
   **Confidence:** high  
   **Would block a cleanup PR?** no

7. **File:** Dual logout — `src/lib/stores/auth.svelte.ts:297–376` vs `src/lib/db/pb.ts:882–886`  
   **Theme:** Dual auth paths / thin abstraction  
   **Description:** Real logout (queue flush, DB wipe, device auth snapshot, session clear) lives on the auth store. `pb.logout()` only clears authStore + realtime and is a **trap** if called thinking it is app logout. Login is correctly centralized on `pb.loginWithEmail|Passkey`, but session restore is a multi-path resolver (localStorage, Dexie `appSession`, PB model, rebuild from session).  
   **Why:** Naming collision (`logout` in two modules) is a classic footgun; incomplete logout leaves stale Dexie/PB state.  
   **Suggested structural fix:** Rename `pb.logout` → `clearPbAuthStore` (or delete and inline); single exported `logoutApp` from auth. Document restore order in one place.  
   **Effort:** S  
   **Confidence:** high  
   **Would block a cleanup PR?** yes if a PR renames without updating all call sites — do as atomic rename

### Medium

8. **File:** `src/lib/calendar/MonthPicker.svelte:4–7, 47–59`  
   **Theme:** Utils duplication + Svelte 4 residue  
   **Description:** Local `getLocalDateString` / `toDateString` reimplement `$lib/utils/dates`. `createEventDispatcher` is imported but callbacks (`onDateSelect`, etc.) are the real API — dispatch is dead merge residue.  
   **Why:** Past calendar date bugs came from dual date semantics; this undoes Phase 1 extraction.  
   **Suggested structural fix:** Import dates utils; delete dispatcher.  
   **Effort:** S  
   **Confidence:** high  
   **Would block a cleanup PR?** no

9. **File:** `src/routes/(app)/admin/options/+page.svelte:214–226`  
   **Theme:** Duplicated helpers  
   **Description:** Page-local `safeClone` (weaker than db’s — no function/proxy strip).  
   **Suggested structural fix:** Import `safeClone` from `$lib/db` (or move pure clone to `$lib/utils/clone.ts` and use both places).  
   **Effort:** XS  
   **Confidence:** high  
   **Would block a cleanup PR?** no

10. **File:** `src/lib/components/JobFormModal.svelte` (~1220+) & page monsters `jobs/+page.svelte` (~1137), `clients/+page.svelte` (~1200+), `profile/+page.svelte` (~1484)  
    **Theme:** Large UI modules / logic in route  
    **Description:** Jobs/clients pages mix enrichment maps, filter DSLs, pull/sync listeners, and large BEM styles. Profile mixes badge UI, password, email change, passkeys, and quick-unlock setup. Job form still owns cancel-confirm sub-modal + billable totals (partially overlapping invoice totals).  
    **Why:** Feature PRs on “filters” or “quick unlock” force full-page conflict resolution.  
    **Suggested structural fix:** Extract filter engines to pure modules (already test-friendly); profile → `ProfileBadge`, `ProfileSecurity`, `ProfileQuickUnlock`; job form cancel confirm → small component.  
    **Effort:** M each  
    **Confidence:** medium  
    **Would block a cleanup PR?** no

11. **File:** `src/lib/db/index.ts:24–45` re-exports + invoice domain  
    **Theme:** Thin/wrong abstraction  
    **Description:** Pure invoice helpers already live under `$lib/utils/*`, but `$lib/db` re-exports them so UI imports domain math from the database layer. Snapshot write-back (`writeInvoiceSnapshotToClientJob`) also sits beside Dexie.  
    **Why:** Blurs “persistence” vs “domain” boundaries; encourages more logic into `index.ts`.  
    **Suggested structural fix:** Prefer direct `$lib/utils/invoice*` imports in new code; stop growing re-export surface; optionally `src/lib/invoices/` domain module.  
    **Effort:** S (policy) / M (move)  
    **Confidence:** medium  
    **Would block a cleanup PR?** no

12. **File:** Dexie versions `db.version(21)`–`(25)` in `index.ts:406–464`  
    **Theme:** Schema noise  
    **Description:** Repeated full `.stores({...})` blocks for additive tables (`crewNotifications`, `appSession`, `deviceAuth`) with near-identical store maps.  
    **Why:** Hard to see what actually changed per version; copy-paste risk on next bump.  
    **Suggested structural fix:** Extract `CURRENT_STORES` constant; versions only declare deltas where Dexie allows; document upgrade notes once.  
    **Effort:** S  
    **Confidence:** medium  
    **Would block a cleanup PR?** no (must preserve upgrade path)

13. **File:** Svelte 5 compliance residue — `QuickUnlock.svelte` / `Toast.svelte` still use `onMount`; MonthPicker uses `createEventDispatcher`  
    **Theme:** Multi-model / style drift  
    **Description:** AGENTS.md mandates runes-only; most app converted, leftovers remain.  
    **Suggested structural fix:** Convert remaining `onMount` to `$effect`; delete dispatcher.  
    **Effort:** S  
    **Confidence:** medium  
    **Would block a cleanup PR?** no

### Low

14. **File:** Widespread `// )=-` narrative comments referencing Remedine/phases  
    **Theme:** Noise / multi-agent fingerprint  
    **Description:** Valuable historically, but many paragraphs restate code or removed code (options page triple “removed role guard”).  
    **Why:** Slows reading; confuses “current design” vs “changelog”.  
    **Suggested structural fix:** Keep one design note per module; move history to CHANGELOG/PR.  
    **Effort:** ongoing XS  
    **Confidence:** high  
    **Would block a cleanup PR?** no

15. **File:** `User` schema still indexes `forcePinUpdate` while PIN login is removed (device quick-unlock PIN is separate)  
    **Theme:** Legacy fields  
    **Description:** Comments say PIN login removed; schema/userSync still carry `forcePinUpdate` / `pinHash` on user shapes.  
    **Why:** Mental model of “auth” is still dual.  
    **Suggested structural fix:** Document intentional device-only PIN vs deleted login PIN; drop unused user fields when PB migration allows.  
    **Effort:** M (data migration)  
    **Confidence:** medium  
    **Would block a cleanup PR?** yes if schema drop without migration plan

16. **File:** `src/lib/db/index.ts:581` `createJob(jobData: any)` and frequent `any` in UI job props  
    **Theme:** Typing holes  
    **Description:** Weakens the value of exported `Job` interface.  
    **Suggested structural fix:** Tighten create/update signatures to `Partial<Job>` / DTO types.  
    **Effort:** S–M  
    **Confidence:** medium  
    **Would block a cleanup PR?** no

---

## Code-judo opportunities ranked by impact (lines/concepts deleted)

| Rank | Move | Est. lines / concepts removed | Risk |
|-----:|------|-------------------------------|------|
| 1 | Delete dead `JobInvoicePanel.svelte` | ~920 lines | Very low (no imports) |
| 2 | Collapse invoice FormData create/update/fallback into 1–2 helpers inside sync extract | ~400–600 net lines | Medium (behavior-sensitive) |
| 3 | Split `options/+page` into tab components + shared reorder helper | ~0 net initially; −concepts, +files; later −duplicate move* ~80 | Low |
| 4 | Delete dead `Calendar.svelte` + optional `/calendar/split` route alias if redundant | ~214 + route CSS duplication | Low |
| 5 | Delete dead `ForcePhotoUpdateModal.svelte` | ~266 | Very low |
| 6 | MonthPicker: use `$lib/utils/dates`, drop dispatcher | ~40 | Low |
| 7 | Extract mobile gesture + FC CSS from SplitCalendar | −concepts in main file (~600–900 moved) | Medium |
| 8 | Split `db/index.ts` by domain (no behavior change) | −concepts; same lines redistributed; unlocks testing | Medium |
| 9 | Extract invoice email/blob client helpers | ~80–120 from editor | Low |
| 10 | Rename/remove `pb.logout` trap | ~5 + clarity | Low if grepped |

**Quick win pack (same afternoon):** #1 + #4 + #5 + #6 + #10 ≈ **~1.4k dead/dup lines** with minimal product risk.

---

## Decomposition plan (top 3 giant files)

### 1) `src/lib/db/index.ts` (~2701)

```
src/lib/db/
  dexie.ts          # db instance + versions
  types.ts          # Client, Job, User, Invoice, ...
  clone.ts          # safeClone, dataUrlToBlob, dates coerce
  jobs.ts           # CRUD + getJobsForRange/dedup
  clients.ts
  users.ts          # + re-export userSync
  invoices.ts       # CRUD + ensureInvoiceShell/snapshot APIs
  ids.ts            # resolve*PbId
  sync/
    processQueue.ts # single-flight
    jobs.ts
    clients.ts
    users.ts
    invoices.ts     # FormData builders once
  index.ts          # compatibility barrel
```

**Order:** (a) extract pure helpers already at top, (b) extract invoice sync builders (highest dup), (c) move CRUD modules, (d) leave barrel for import stability.

### 2) `src/lib/calendar/SplitCalendar.svelte` (~2.6k)

```
src/lib/calendar/
  SplitCalendar.svelte           # layout + bind FC host
  splitCalendarConfig.ts         # plugins, slot bounds, longPress
  splitCalendarJobs.svelte.ts    # jobs state, filters, reload, realtime
  mobileEventGestures.ts         # selection, resize preview, edge scroll
  monthPickerDrag.ts             # edge dwell, external drop
  split-calendar.css             # :global(.fc-*) + BEM
  MonthPicker.svelte             # already separate; fix dates import
```

**Order:** CSS extract → mobile gestures → jobs/effects → leave FC callbacks thin.

### 3) `src/routes/(app)/admin/options/+page.svelte` (~2800)

```
src/routes/(app)/admin/options/
  +page.svelte                   # tabs shell + save orchestration
  OptionsSchedulingTab.svelte    # areas, billables, cancel reasons, hours
  OptionsInvoiceTab.svelte
  OptionsSecurityTab.svelte
  OptionsBackupsTab.svelte       # Drive + restore + upload
  lib/reorderOptionList.ts       # moveUp/Down/isDefault generics
```

**Order:** Backups tab first (most independent, API-heavy); then scheduling list editors; shell keeps `saveOptions` + `editingOptions` or lift to `optionsEdit.svelte.ts`.

---

## Multi-model fingerprints

| Fingerprint | Where | Interpretation |
|-------------|-------|----------------|
| `// )=-` + Remedine/Phase N essay comments | Nearly all hotspots | Multi-agent / multi-session narrative style; often “removed X” residual |
| Dual calendar | `Calendar.svelte` vs `SplitCalendar.svelte` | Split won; classic FC left as orphan |
| Dual invoice panels | `JobInvoicePanel` vs `InvoiceEditor` | Snapshot editor superseded draft-panel model |
| Dual force-photo modals | `ForcePhotoUpdate` vs `ForcePhotoUpdateModal` | Same feature, two implementations; login uses former |
| Dual date helpers | `$lib/utils/dates` vs MonthPicker locals | Extraction incomplete |
| Dual `safeClone` | `db/index` vs options page | Same |
| Dual logout | `auth.logout` vs `pb.logout` | Incomplete vs full session teardown |
| Dual invoice generation APIs | `generateInvoiceDocx(job,…)` (legacy panel) vs `generateInvoiceDocxFromSnapshot` (editor) | Keep both only if import/legacy jobs need job-based docx |
| Dual ensure-invoice | `ensureInvoiceShell` vs `ensureInvoiceForJob` | Related but overlapping; document single entry for UI |
| PIN login “removed” vs device PIN + `forcePinUpdate` fields | profile comments vs schema/userSync | Auth model mid-migration |
| Svelte 4 leftovers | `onMount`, `createEventDispatcher` | Incomplete Svelte 5 migration |
| Hardcoded slate colors in dead Calendar / ForcePhotoUpdateModal | vs design tokens elsewhere | Older skin not updated |

---

## Top 10 structural cleanup actions

1. **Delete dead code:** `JobInvoicePanel.svelte`, `Calendar.svelte`, `ForcePhotoUpdateModal.svelte` (verify with repo-wide import search + build).
2. **Extract invoice sync FormData + create/update/fallback** from `runProcessSyncQueue` into one module with shared builders (largest live complexity win).
3. **Split `db/index.ts` barrel** into schema/types/CRUD/sync without changing public import paths initially.
4. **Decompose SplitCalendar:** mobile gestures + FC CSS out first; then jobs/realtime store.
5. **Split admin options page** into tab components; start with Backups.
6. **Finish dates extraction:** MonthPicker must import `$lib/utils/dates`; delete local clones.
7. **Unify clone helper:** single `safeClone` for options + db (prefer `$lib/utils/clone.ts` to avoid UI→db weirdness).
8. **Auth API hygiene:** rename `pb.logout` → `clearPbAuthStore`; one documented session restore pipeline.
9. **Extract invoice client actions** (blob fetch, base64 email) from InvoiceEditor.
10. **Policy:** no new logic in the three god-files; new features land in `src/lib/{domain}/` modules with pure functions + tests (follow `backups/`, `invoiceDocx/`, `auth/` patterns).

---

## Final

**Report path:** `docs/reviews/2026-07-16-multi-agent/agents/H-maintainability.md`

### Top 5 judo moves

1. **Delete ~1.4k lines of dead duals** (JobInvoicePanel + Calendar + ForcePhotoUpdateModal) — pure win.  
2. **Collapse invoice queue FormData/state machine** (~400–600 lines of live duplication) — biggest structural risk reduction in `db/index.ts`.  
3. **Split `db/index.ts` into domain + sync packages** — unlocks testability and stops the god-module gravity well.  
4. **Carve SplitCalendar mobile/CSS/jobs** — restores ability to change calendar UX without thrashing data sync.  
5. **Tab-split options page + shared list reorder** — isolates backups/Drive churn from scheduling options.

These five preserve behavior while deleting complexity and restoring module boundaries already partially established elsewhere in the tree.
