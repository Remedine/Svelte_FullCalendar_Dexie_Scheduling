# Agent B: Data layer & sync

**Commit reviewed:** `64e9233` (`origin/main`)  
**Workspace:** Capital City Windows CRM (offline-first SvelteKit + Dexie + PocketBase)  
**Mode:** Read-only review (no source edits)

## Scope

| Path | Role |
|------|------|
| `src/lib/db/index.ts` (~2700 lines) | Dexie schema/migrations, entity types, CRUD, id resolvers, sync queue processor, re-exports |
| `src/lib/db/pb.ts` | PocketBase client, login/auth helpers, pull/merge, app-data sync orchestration |
| `src/lib/db/userSync.ts` | User identity merge, roster stale-delete guard, dedup |
| `src/lib/db/realtime.ts` | Single shared jobs SSE subscription |
| `src/lib/db/*.test.ts` | Helpers, CRUD offline, thin processSyncQueue / pull smoke tests |

Out of scope but referenced where it touches sync: `auth.svelte.ts`, `sessionPersist.ts`, calendar realtime consumers.

## Summary

The data layer is a mature offline-first stack: optimistic Dexie writes, durable `syncQueue`, last-write-wins pulls, and a shared app-data sync path for login/resume. Strengths: single-flight queue (`processSyncQueue`), user stale-delete guard (`canRunStaleUserDelete`), job date normalization after `safeClone` damage, invoice create-promote-on-update / 404→create fallbacks, and extracted `userSync` + `realtime` modules.

Primary risks: **god-file queue with inconsistent error policy**, **invoice pull stale-delete without empty-roster guard**, **soft client id resolution still feeding PB relation payloads**, **broken LWW comparisons on clients/invoices when `updatedAt` is string vs Date**, and a **hard circular import** (`index` ↔ `pb`) kept alive by a dead `pullJobsFromServer` import. Conflict policy and CRUD→queue patterns are duplicated per collection with multi-author fingerprints (Batch A/B comments, Phase N invoice blocks, Remedine references).

## Findings

### F1 — Severity: high
- File: `src/lib/db/pb.ts:700-706`
- Theme: data-loss
- Description: `pullInvoicesFromServer` always runs stale-delete: any local invoice with `pbId` not in the pulled id set is deleted. Unlike jobs (`pb.ts:522-533`) and clients (`pb.ts:613-624`), there is **no** `pbInvoiceIds.size > 0` (or full-roster) guard. An empty successful list (new empty collection, list rule returning zero rows, partial failure recovered as empty) wipes every previously synced local invoice.
- Why: Jobs/clients explicitly skip stale delete on empty roster; invoices do not. Offline-only invoices without `pbId` survive; synced ones do not.
- Suggested fix: Mirror jobs/clients (`if (pbInvoiceIds.size > 0)`) and/or adopt `canRunStaleUserDelete`-style completeness checks; never delete rows with pending `syncQueue` items for that record.
- Effort: S

### F2 — Severity: high
- File: `src/lib/db/index.ts:1902-1917`, `src/lib/db/index.ts:1786-1794`
- Theme: data-loss / bug
- Description: Job **update** uses `realId = job?.pbId || job?.id || item.recordId` and PATCHes PocketBase. If create never stamped `pbId`, this PATCHes a Dexie UUID → 404 → **queue item deleted** with no promote-to-create (invoices have that fallback at `index.ts:2341-2447`). Separately, `jobDataToPbPayload` still uses soft `resolveClientPbId` (returns local UUID when unsynced) for the `client` relation, so creates/updates can 400 or attach wrong relations.
- Why: Strict resolvers exist (`resolveJobPbId`, `resolveClientPbIdForSync`) and are used for invoices, but jobs still use the soft path; update 404 drops work permanently while local Dexie remains silently un-pushed.
- Suggested fix: Skip job update until `pbId` exists (or promote to create); use `resolveClientPbIdForSync` in `jobDataToPbPayload` and keep item when relations unresolved (invoice pattern at `index.ts:2187-2191`).
- Effort: M

### F3 — Severity: high
- File: `src/lib/db/pb.ts:600-604`, `src/lib/db/pb.ts:688-691` vs `src/lib/db/pb.ts:439-479`
- Theme: bug / inconsistency
- Description: Job merge uses `timestampMs()` so ISO strings and `Date`s compare correctly. Client and invoice pulls use raw `localX.updatedAt > serverX.updatedAt`. Optimistic CRUD often stores dates via `safeClone` (ISO strings — `index.ts:61-76`, `createClient` at `index.ts:1532-1538`), while pull builds `new Date(...)`. Mixed `string > Date` coerces the Date to a locale string, so LWW is unreliable and can overwrite newer local edits or skip needed server updates.
- Why: Only jobs got Batch A timestamp normalization; clients/invoices still use naive operators.
- Suggested fix: Reuse `timestampMs` (export or share) for all entity pulls; prefer `prepareJobForDexie`-style Date rehydration on write for all entities.
- Effort: S

### F4 — Severity: medium
- File: `src/lib/db/index.ts:4`, `src/lib/db/pb.ts:3`, `src/lib/db/userSync.ts:3`
- Theme: bug / abstraction
- Description: Circular import graph: `index.ts` → `pb` (`pb`, **unused** `pullJobsFromServer`) → `index` (`db`, `processSyncQueue`); `userSync` → `index`. Dynamic import of `auth.svelte` (`index.ts:48-53`) papers over another cycle. Module init order is fragile (partial `db` / `pb` bindings under bundler edges).
- Why: Dead import of `pullJobsFromServer` (only appearance is the import line) deepens the cycle for no benefit; `pb` is only needed in queue + photo URL helpers.
- Suggested fix: Split `db` schema/instance, CRUD, and `processSyncQueue` into separate modules; remove unused `pullJobsFromServer` import; inject `pb` into queue processor via dynamic import if needed.
- Effort: L

### F5 — Severity: medium
- File: `src/lib/db/index.ts:1624-1635`, `src/lib/db/index.ts:2021-2088`
- Theme: security / data-loss
- Description: New-user **plaintext passwords** live in IndexedDB `syncQueue.data` until create succeeds. On user create 400, the queue item is **deleted** and an intentional drop is thrown (`index.ts:2085-2088`) — permanent loss of the create (and password) with only a console error; local Dexie user may remain orphaned without `pbId`.
- Why: Password-in-queue is intentional offline design; drop-on-400 was added to stop spam, but collapses transient and permanent failures.
- Suggested fix: Encrypt or hold password only in memory with a non-durable create path when online; on 400, classify validation vs network; maxAttempts + surface admin UI for failed user creates; never delete without marking local user as `syncFailed`.
- Effort: M

### F6 — Severity: medium
- File: `src/lib/db/index.ts:1866-2673`
- Theme: god-file / inconsistency
- Description: `runProcessSyncQueue` is a ~800-line collection-switched processor with divergent policies: job create failures **keep** item; client create **throws**; user create **deletes** item; invoice create **logs and keeps**; job update 404 **deletes**; invoice update 404 may **recreate**. No `attempts`, backoff, or dead-letter. Single-flight (`index.ts:1870-1880`) correctly prevents double-create, but items enqueued during a run only flush on the next trigger.
- Why: Multi-pass feature growth (Batch A, invoice Phase 2) without extracting a shared `QueueHandler` contract.
- Suggested fix: Per-collection handler map with shared `{ keep | drop | retry }` outcomes, attempt counters, and post-flight re-drain if queue non-empty.
- Effort: L

### F7 — Severity: medium
- File: `src/lib/db/index.ts:1720-1783`, `src/lib/db/index.ts:587-601`
- Theme: inconsistency / schema-drift
- Description: Dual id model: local UUID `id` + optional `pbId`. Soft resolvers (`resolveClientPbId`) return UUID when unsynced; strict ones return `null`. `createJob` stores `clientId: realClientId` from the soft resolver, so job rows often hold **PB client ids** while other code still matches local UUIDs (`getPaginatedJobsForClient` dual-id set at `index.ts:931-939`). Invoice path uses strict relation resolve; job path does not.
- Why: Prefer-PB-on-write without always rewriting relation fields after client sync.
- Suggested fix: Store only local Dexie ids in Dexie FKs; map to PB ids only at push time (strict); one `resolvePbRelation(collection, localId)` API.
- Effort: L

### F8 — Severity: medium
- File: `src/lib/db/pb.ts:522-530`, `src/lib/db/pb.ts:613-620`, `src/lib/db/userSync.ts:229-236`
- Theme: data-loss / race
- Description: Jobs/clients stale-delete when `pbId ∉ pulledSet` with only `size > 0` guard — weaker than users’ `canRunStaleUserDelete` (partial roster protection). A partial list that still has `size > 0` but incomplete pages (or list rules filtering rows) can delete valid local rows. Stale delete does not check pending outbound queue items for that `pbId`/`recordId`.
- Why: Users got hardened roster semantics; jobs/clients/invoices did not.
- Suggested fix: Require `pbIds.size === totalItems` (or last page complete) before delete; skip delete if open queue ops exist for that entity.
- Effort: M

### F9 — Severity: medium
- File: `src/lib/db/index.ts:2176-2629`
- Theme: duplication
- Description: Invoice FormData assembly (scalars + primary + supporting + deletes) is copy-pasted across create, create-with-existing-pbId, update fallback, and 404-fallback blocks (~4 near-identical blocks). Easy for snapshot fields (`clientSnapshot`, `invoiceDiscount`, `version`, etc.) to sync on one path and not another (`invoiceScalarToPbPayload` vs hard-coded append lists at `index.ts:2253-2271`).
- Why: Phase 2 defensive fallbacks layered without extraction.
- Suggested fix: `buildInvoiceFormData(local, data, relationIds)` + `buildInvoiceJsonPayload(...)` used by all branches.
- Effort: M

### F10 — Severity: low
- File: `src/lib/db/index.ts:407-464`
- Theme: schema-drift
- Description: Dexie versions 21–25 only redeclare `.stores(...)`; no `.upgrade()` data migrations. New invoice snapshot fields and options flags rely on optional properties. Historical date-as-string jobs need runtime `repairJobDateFields` (`index.ts:126-138`) rather than a one-shot upgrade.
- Why: Additive optional fields work without upgrade hooks, but date/index bugs need manual repair on sync (`pb.ts:171-172`).
- Suggested fix: One version with upgrade that rehydrates job dates; stop shipping only store-shape bumps for behavioral fixes.
- Effort: S

### F11 — Severity: low
- File: `src/lib/db/index.ts:50`, `581`, `373`, `2691`; `src/lib/db/pb.ts:447`
- Theme: abstraction
- Description: Type debt: `auth: any`, `createJob(jobData: any)`, `SyncQueueItem.data?: any`, `applyServerJobRecord(rec: any)`, `getUserPhotoSrc(..., user: any)`. Undermines pbId/null safety the strict resolvers try to encode.
- Suggested fix: Typed create inputs + `SyncQueueItem` discriminated unions per collection.
- Effort: M

### F12 — Severity: low
- File: `src/lib/db/realtime.ts:1-105` vs pulls in `pb.ts`
- Theme: inconsistency
- Description: Realtime is jobs-only; clients/invoices/users converge via pull on login/resume (`syncAppDataFromServer`). Acceptable product choice, but multi-device client edits lag until resume throttle (`APP_DATA_SYNC_MIN_INTERVAL_MS = 15s`, `pb.ts:44`).
- Suggested fix: Document as policy or extend shared realtime registry pattern for clients/invoices if multi-admin concurrency matters.
- Effort: M (if extending)

### F13 — Severity: low
- File: `src/lib/db/index.test.ts:1258-1270`, `1302+`; `userSync.test.ts`
- Theme: dead-code (test gaps)
- Description: Strong unit coverage for pure helpers, offline CRUD, and a few mocked queue paths. Pull merge/stale-delete, LWW string/Date, job update-without-pbId, and user create-400 drop are mostly untested (pull test only checks auth early-return).
- Suggested fix: Table-driven tests for stale-delete guards and `timestampMs` LWW across entities.
- Effort: M

## Structural map of db/index.ts (major exports/sections)

| Lines (approx) | Section |
|----------------|---------|
| 1–46 | Imports; barrel re-exports of invoice/tax/docx utils |
| 48–53 | Dynamic `auth` import (cycle break) |
| 61–165 | `safeClone`, job date coerce/normalize/repair, `dataUrlToBlob`, `getValidAreaOfTown` |
| 167–375 | Interfaces: `Client`, `Job`, `User`, `AppSession`, `DeviceAuthSettings`, `AppOptions`, `Invoice`, `SyncQueueItem` |
| 377–464 | Dexie instance + versions 21–25 store definitions |
| 466–484 | Session user id helpers |
| 486–577 | Crew job queries; rename/remove crew on jobs |
| 579–952 | Job CRUD + range/dedup/cleanup + paginated client jobs |
| 954–1523 | Invoice CRUD, numbering, snapshot/shell/docx orchestration hooks |
| 1525–1589 | Client CRUD |
| 1591–1699 | User CRUD |
| 1701–1862 | Id resolvers + `jobDataToPbPayload` + invoice PB scalar helpers |
| 1864–2674 | `addToSyncQueue` / `processSyncQueue` / `runProcessSyncQueue` (all collections) |
| 2676–2701 | Re-export `cleanupDuplicateUsers`, `db`, `getUserPhotoSrc` |

**Note:** `pullJobsFromServer` is imported at line 4 but never used in this file.

## Multi-model fingerprints

1. **“Batch A / Batch B” comments** — queue single-flight, relation id safety, job payload mapping (`index.ts` ~1731, 1870, 2182; `pb.ts` ~438). Feels like a deliberate sync hardening pass.
2. **“Phase 0/1/2 + JOBS_AND_INVOICES_SPEC”** — large invoice surface, FormData file queue, regenerate fallbacks, verbose rationale comments (`index.ts` ~962–1118, 2168–2524). Second model/pass layered on jobs/clients pattern.
3. **Remedine/Svelte_FullCalendar_Dexie_Scheduling references** — repeated in comments across index/pb; template/port lineage.
4. **Extracted modules** — `userSync.ts` (merge policy + tests) and `realtime.ts` (SSE fan-in) are cleaner, smaller, and more consistent than the god-file queue.
5. **Auth bundled into `pb.ts`** — login, passkey, password reset, roster pull, and data pull share one file; different concern mix than pure data layer.
6. **Emoji console logging** (`✅`/`❌`/`🗑️`) throughout CRUD and pulls — shared house style across authors.

## Reuse opportunities

| Opportunity | From | Apply to |
|-------------|------|----------|
| `timestampMs` LWW | Jobs pull (`pb.ts:439-479`) | Clients, invoices; optionally users |
| `canRunStaleUserDelete` | `userSync.ts:229-236` | Jobs/clients/invoices stale cleanup |
| Strict relation resolve + keep-on-unresolved | Invoice queue (`index.ts:2183-2191`) | Jobs/clients push |
| 404 → create fallback | Invoices (`index.ts:2511+`) | Jobs/clients updates without `pbId` (or skip until create) |
| Single shared FormData builder | — | Four invoice push branches |
| `prepare*ForDexie` date rehydration | Jobs (`index.ts:105-123`) | Clients, invoices, options |
| Realtime handler registry | `realtime.ts` | Optional clients/invoices |
| Typed queue handlers | — | Replace giant `if (collection === …)` ladder |
| Dedup-by-pbId | `dedupJobs` / `cleanupDuplicateUsers` | Clients/invoices if dual rows appear |

## Top 5 cleanup actions

1. **Guard invoice (and strengthen job/client) stale-delete** — empty/partial roster must not wipe local rows; skip if pending queue (F1, F8).
2. **Unify LWW on `timestampMs`** for all pulls; rehydrate dates on Dexie write (F3).
3. **Align job push with invoice relation policy** — strict client/job ids; no UUID PATCH; no silent drop of updates that should become creates (F2).
4. **Split `index.ts`** — schema/`db`, entity CRUD, queue processor, PB adapters; kill circular import and dead `pullJobsFromServer` import (F4, F6).
5. **Extract invoice payload builders + shared queue outcome model** (attempts, keep/drop/retry) to remove FormData duplication and password/create drop hazards (F5, F6, F9).

---

*Agent B complete. High-signal only; line numbers relative to commit `64e9233`.*
