# Capital City Windows Scheduler — Master Plan

**Last updated:** June 30, 2026  
**Status:** Single execution plan. Supersedes `TODO.md` and prior session plans.

### Current status

| Area | Status | Notes |
|------|--------|-------|
| **Batch A** — Sync integrity | ✅ **Complete** | Mutex, no-drop-on-failure, relation resolution, paginated pull, realtime conflict — verified in code + tests |
| **Batch B** — Data correctness | ✅ **Complete** | cancelNotes, tax normalization, `jobDataToPbPayload`, logout sync flush — verified |
| **Batch C** — Scale (~900) | 🟡 **Partial** | Clients page uses bulk invoice map; **jobs page still O(n) `getInvoiceForJob` loop** (C1); `allocateInvoiceNumber` still local-only (C5) |
| **Batch D** — Security | ❌ **Not started** | No startup guard on `INTERNAL_SECRET`; `send-welcome` / `mark-verified` lack admin auth; invoice send-email is auth-only not admin; PB rules still over-permissive |
| **Batch E** — P2 polish | 🟡 **Partial** | E1 calendar jump uses `toDateString`; E4 overdue still datetime compare; E5 root `/` still stub; E2/E3 open |
| **Priority 1 — Import** | ❌ **Not started** | No `src/lib/import/`, no admin wizard, no API route |
| **Tests** | ✅ **Green** | 130 passing, 7 skipped (`pnpm test` Jun 30) |

**Read:** Deliverables 1 (production-stable) and 2 (invoicing) are in good shape. Deliverable 3 (~900 legacy import) has not started and needs a dedicated sprint after C + D. Security (Batch D) is the highest-risk gap for production.

> **Authority:** This document is the only execution plan. Technical specs remain in [`JOBS_AND_INVOICES_SPEC.md`](JOBS_AND_INVOICES_SPEC.md) and [`TESTING_PLAN.md`](TESTING_PLAN.md) as reference — do not delete them; they record *what* to build, not *when* or *in what order*.

---

## Why code review fixes come first (not import)

A June 2026 code review found the app is **functionally complete** but the **sync layer silently drops failed PocketBase writes** and has data-corruption edge cases. Importing ~900 legacy records *before* fixing sync will multiply every failure:

- Failed queue items are deleted while logging "Synced"
- Concurrent `processSyncQueue` runs can duplicate server records
- Invoice relations sent as Dexie UUIDs before `pbId` exists → 400 → dropped
- `cancelJob` overwrites `notes` instead of `cancelNotes`
- Tax rate percent/decimal mismatch corrupts invoice totals on legacy data

**Recommendation:** Fix sync integrity (Batch A) before any bulk import. Batch A is complete; import can proceed once Batch D is addressed.

---

## Target deliverables

| # | Deliverable | Done when |
|---|-------------|-----------|
| 1 | **Production-stable** | Admin + crew use calendar, jobs, clients daily without P0/P1 bugs |
| 2 | **Invoicing complete** | Generate → sync → download → upload → email → mark sent/paid on Railway |
| 3 | **Legacy import complete** | ~900 records from client CSV + Asana + OCR CSV + scans in PB, visible in app |

---

## Already shipped (do not rebuild)

Calendar, jobs hub, clients, job details modal, invoice panel, docx generation, email send, Dexie v22 + sync queue, auth (admin/crew), crew assignment email, dark mode, business hours, PWA, ~66 unit tests.

Phases 0–7 of [`JOBS_AND_INVOICES_SPEC.md`](JOBS_AND_INVOICES_SPEC.md) are complete.

---

## Priority 0 — Code review fixes

### Batch A — Sync integrity (highest leverage, 2–3 days) — **COMPLETE (Jun 18)**

Implemented: A1 queue no-drop-on-failure, A2 single-flight mutex, A3 invoice relation resolution, A4–A5 paginated job pull + empty-roster guard, A6–A7 realtime conflict check + pbId on pull. Tests: `processSyncQueue` success removes item + stamps pbId; failure retains queue item.

| ID | Issue | File(s) | Fix |
|----|-------|---------|-----|
| A1 | Queue deletes items after PB failure | `src/lib/db/index.ts` ~1270, 1969 | Only `delete` on confirmed success; `continue` on failure; retry/backoff |
| A2 | No mutex on `processSyncQueue` | `index.ts` 1240; callers in `pb.ts`, `+layout.svelte` | Single-flight guard; coalesce per `(collection, recordId)` |
| A3 | Invoice sync sends unresolved relation IDs | `index.ts` ~1599–1757 | Resolve `job`/`client` to `pbId` before create; skip if missing |
| A4 | `pullJobsFromServer` unbounded `getFullList` | `src/lib/db/pb.ts` 113–119 | Paginate (100/page) like clients/invoices |
| A5 | Jobs stale-delete lacks empty-roster guard | `pb.ts` 159–167 | Skip delete when `pbJobIds.size === 0` |
| A6 | Realtime clobbers local edits | `SplitCalendar.svelte` ~217–244 | Reuse pull's `updatedAt` conflict check |
| A7 | Pulled jobs omit `pbId` | `pb.ts` 126–156 | Always set `pbId: rec.id` on pull/realtime |

### Batch B — Data correctness (1 day) — **COMPLETE (Jun 18)**

Implemented: B1 cancelNotes fix, B2 tax normalization (`$lib/utils/tax.ts`), B3 `jobDataToPbPayload` for create/update, B4 cancelledBy pbId, B5 invoice JSON field mapping, B6 logout sync flush + warn.

### Batch B — Data correctness (reference)

| ID | Issue | File(s) | Fix |
|----|-------|---------|-----|
| B1 | `cancelJob` writes `notes` not `cancelNotes` | `index.ts` 491–500 | `cancelNotes: notes`; do not touch `notes` |
| B2 | Tax rate percent vs decimal mismatch | `JobFormModal`, `index.ts`, `pb.ts`, `invoiceDocx/` | Single `normalizeTaxRateToPercent()` on read/write |
| B3 | Job update sends Dexie field names to PB | `index.ts` 1277–1278 | Shared `jobToPbPayload()` for create + update |
| B4 | `cancelledBy` uses local id not PB id | `index.ts` 498 | Use `currentUser.pbId` or `resolveUserPbId()` |
| B5 | Invoice update JSON wrong field names | `index.ts` ~1830 | Map `jobId`/`clientId` → `job`/`client` |
| B6 | Logout wipes unsynced queue | `auth.svelte.ts` 24–27 | Flush queue before delete or warn if non-empty |

### Batch C — Scale for ~900 records (1 day) — **PARTIAL (Jun 30)**

C2/C3 largely addressed on clients page (`invoices.toArray()` + `Map`). C1 and C5 remain open.

| ID | Issue | File(s) | Fix | Status |
|----|-------|---------|-----|
| C1 | Jobs page O(n) sequential invoice lookups | `jobs/+page.svelte` 81–92 | One `invoices.toArray()` → `Map<jobId, Invoice>` | ❌ Open |
| C2 | Clients page N+1 on expand | `clients/+page.svelte` | Reuse invoice map per expand | ✅ Done |
| C3 | Clients mount loads all jobs | `clients/+page.svelte` | Index jobs by `clientId` in one pass | ✅ Done |
| C4 | Dual Dexie job rows (local UUID + PB id) | `pb.ts`, `index.ts` | Canonical: `id = localUuid`, `pbId = serverId` | 🟡 `dedupJobs` helpers in place |
| C5 | `allocateInvoiceNumber` local-only | `index.ts` 884–911 | Server-side allocation or block offline generate | ❌ Open |

### Batch D — Security hardening (1–2 days) — **NOT STARTED**

| ID | Issue | File(s) | Fix | Status |
|----|-------|---------|-----|
| D1 | Empty `INTERNAL_SECRET` bypass | `pocketbase-main.go` 190–194 | Fail startup if unset or < 32 chars | ❌ Open |
| D2 | `send-welcome` no auth | `api/auth/send-welcome/+server.ts` | `assertAdmin(token)` | ❌ Open |
| D3 | `mark-verified` no auth | `api/auth/mark-verified/+server.ts` | Admin auth + real internal PB route | ❌ Open |
| D4 | Invoice send: no admin check | `api/invoices/send-email/+server.ts` | `assertAdmin()` | ❌ Open (auth-only today) |
| D5 | Users `listRule` over-permissive | `pb_migrations/1781120207_updated_users.js` | Admin-only list or `id = @request.auth.id` | ❌ Open (`id != ""`) |
| D6 | Invoice PB rules wrong | `pb_migrations/1781125204_*.js` | New migration: `@request.auth.role = "admin"` | ❌ Open (`id = @request.auth.id` on invoices) |
| D7 | Cron `X-Internal-Secret` ignored on collections | `api/cron/process-crew-notifications/` | Internal PB routes with app-level privileges | 🟡 Cron checks secret; PB collection access unclear |
| D8 | `crewNotificationLog` field missing | PB migration needed | Add field; fix dedup | ❌ Unknown |
| D9 | Internal routes return auth links in JSON | `pocketbase-main.go` | Return `{ success: true }` only; email links via Brevo | 🟡 Partial (Brevo used; links still in some responses) |

### Batch E — P2 fixes (if time before import) — **PARTIAL**

| ID | Issue | Fix | Status |
|----|-------|-----|
| E1 | Calendar jump UTC date | Use `toDateString()` in `JobDetailsModal` | ✅ Done |
| E2 | Docx ignores legacy `hours` key | `quantity ?? hours ?? 1` in docx builder | ❌ Open |
| E3 | Modal actions lack try/catch | Toast errors on status/cancel/save failures | ❌ Open |
| E4 | `isInvoiceOverdue` datetime compare | Compare calendar dates only | ❌ Open |
| E5 | Root `/` stub | Redirect to `/calendar` or `/login` | ❌ Open |
| E6 | Railway cron schedule | Configure in Railway dashboard | ❓ Unverified |

---

## Priority 1 — Legacy import (after Batch A + D) — **NOT STARTED**

Batch A unblocked import, but no import code exists yet. Do not bulk-import until Batch D is addressed.

**Data sources:**
1. Client CSV (current clients)
2. Asana CSV or API
3. OCR product CSV (from invoice photo folder)
4. Scan files attached to correct client/invoice

**Build:**
- `src/lib/import/` — parsers, fuzzy client matcher, validators, idempotency keys
- `src/routes/(app)/admin/import/+page.svelte` — 3-step wizard with dry-run
- `src/routes/api/admin/import/+server.ts` — admin-only direct PB bulk writes

**Stages:** A Clients → B Jobs (`importSource: 'asana-export'`) → C Invoices + files (`importSource: 'handwritten-ocr'`)

**Rules:** Dry-run first; idempotent re-runs; preserve legacy `invoiceNumber`; manual review queue for unmatched clients.

**Sample files needed before dry-run:** one client CSV, one Asana export, one OCR CSV, 2–3 scans.

---

## Priority 2 — Production readiness — **IN PROGRESS**

**Next up (in order):**
1. **C1** — bulk invoice map on `/jobs` (blocks usability at scale even without import)
2. **D1–D4** — lock down API routes (highest production risk)
3. Invoice E2E smoke on Railway
4. Deploy when C + D1–D4 are done

**Can follow after initial deploy:**
- Full ~900 import sprint (needs wizard + parsers + sample files)
- D5–D9 PB migrations
- E2–E6 polish

---

## Backlog (descoped for now)

Automated backups (spec §14), web push, mobile job list under calendar, client archive UI, admin photo at user create, QuickBooks/CSV export, Dexie encryption, full E2E in CI, `SyncStatus` mount, `/calendar/split` dedup.

---

## Work order (recommended sequence)

| Step | Focus | Status |
|------|-------|--------|
| 1 | A1–A7: sync integrity | ✅ Done |
| 2 | B1–B6: data correctness | ✅ Done |
| 3 | C1–C5: scale for ~900 records | 🟡 Partial — clients done, jobs C1 open |
| 4 | D1–D9: security + PB migrations + cron | ❌ Not started |
| 5 | Import parsers + sample files | ❌ Not started |
| 6 | Import wizard + dry-run | ❌ Not started |
| 7 | Full ~900 record import in batches | ❌ Not started |
| 8 | Verify in UI; E1–E6 polish | 🟡 Partial |
| 9 | Production smoke + deploy | 🔄 Blocked on C1 + D1–D4 |

---

## Acceptance checklist

- [x] Batch A complete — queue never drops failed items; sync mutex in place
- [x] B1 + B2 fixed — cancel notes and tax rate verified
- [ ] C1 complete — jobs page loads in < 2s with ~900 jobs
- [ ] D1–D6 complete — API routes locked down; PB rules fixed
- [ ] ~900 imported records searchable; files downloadable in modal
- [ ] Full invoice lifecycle works on Railway (needs smoke test)
- [ ] Crew assignment emails fire (cron configured)
- [ ] Zero open P0/P1 bugs
- [x] `pnpm test` green (130 pass, 7 skip — Jun 30)

---

## Documents consolidated into this plan

| Document | Action |
|----------|--------|
| `TODO.md` | **Superseded** — replaced with pointer to this file |
| Session `plan.json` files | Empty; no action |
| Prior session finish plans (Cursor) | **Superseded** by this file |
| `JOBS_AND_INVOICES_SPEC.md` | **Kept** — technical spec (data model, UI requirements) |
| `TESTING_PLAN.md` | **Kept** — testing strategy; run tests per Batch A–D |
| `invoice-double-window-pattern.md` | **Kept** — docx layout reference |

---

## References

- Code review: conversation June 18, 2026 (sync layer, security, UI/scale)
- Repo: Remedine/Svelte_FullCalendar_Dexie_Scheduling
- AGENTS.md: Svelte 5 runes, commit-after-change workflow