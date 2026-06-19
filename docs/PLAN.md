# Capital City Windows Scheduler — Master Plan

**Deadline: July 1, 2026 (required)**  
**Today: June 18, 2026 — 13 days remaining**  
**Status:** Single execution plan. Supersedes `TODO.md` and prior session plans.

> **Authority:** This document is the only execution plan. Technical specs remain in [`JOBS_AND_INVOICES_SPEC.md`](JOBS_AND_INVOICES_SPEC.md) and [`TESTING_PLAN.md`](TESTING_PLAN.md) as reference — do not delete them; they record *what* to build, not *when* or *in what order*.

---

## Why code review fixes come first (not import)

A June 2026 code review found the app is **functionally complete** but the **sync layer silently drops failed PocketBase writes** and has data-corruption edge cases. Importing ~900 legacy records *before* fixing sync will multiply every failure:

- Failed queue items are deleted while logging "Synced"
- Concurrent `processSyncQueue` runs can duplicate server records
- Invoice relations sent as Dexie UUIDs before `pbId` exists → 400 → dropped
- `cancelJob` overwrites `notes` instead of `cancelNotes`
- Tax rate percent/decimal mismatch corrupts invoice totals on legacy data

**Recommendation:** Fix sync integrity (Batch A) before any bulk import. This is not optional for a safe July 1 launch.

---

## July 1 deliverables

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

## Priority 0 — Code review fixes (Jun 18–22)

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

### Batch B — Data correctness (1 day)

| ID | Issue | File(s) | Fix |
|----|-------|---------|-----|
| B1 | `cancelJob` writes `notes` not `cancelNotes` | `index.ts` 491–500 | `cancelNotes: notes`; do not touch `notes` |
| B2 | Tax rate percent vs decimal mismatch | `JobFormModal`, `index.ts`, `pb.ts`, `invoiceDocx/` | Single `normalizeTaxRateToPercent()` on read/write |
| B3 | Job update sends Dexie field names to PB | `index.ts` 1277–1278 | Shared `jobToPbPayload()` for create + update |
| B4 | `cancelledBy` uses local id not PB id | `index.ts` 498 | Use `currentUser.pbId` or `resolveUserPbId()` |
| B5 | Invoice update JSON wrong field names | `index.ts` ~1830 | Map `jobId`/`clientId` → `job`/`client` |
| B6 | Logout wipes unsynced queue | `auth.svelte.ts` 24–27 | Flush queue before delete or warn if non-empty |

### Batch C — Scale for ~900 records (1 day)

| ID | Issue | File(s) | Fix |
|----|-------|---------|-----|
| C1 | Jobs page O(n) sequential invoice lookups | `jobs/+page.svelte` 81–92 | One `invoices.toArray()` → `Map<jobId, Invoice>` |
| C2 | Clients page N+1 on expand | `clients/+page.svelte` | Reuse invoice map per expand |
| C3 | Clients mount loads all jobs | `clients/+page.svelte` | Index jobs by `clientId` in one pass |
| C4 | Dual Dexie job rows (local UUID + PB id) | `pb.ts`, `index.ts` | Canonical: `id = localUuid`, `pbId = serverId` |
| C5 | `allocateInvoiceNumber` local-only | `index.ts` 884–911 | Server-side allocation or block offline generate |

### Batch D — Security hardening (1–2 days)

| ID | Issue | File(s) | Fix |
|----|-------|---------|-----|
| D1 | Empty `INTERNAL_SECRET` bypass | `pocketbase-main.go` 190–194 | Fail startup if unset or < 32 chars |
| D2 | `send-welcome` no auth | `api/auth/send-welcome/+server.ts` | `assertAdmin(token)` |
| D3 | `mark-verified` no auth | `api/auth/mark-verified/+server.ts` | Admin auth + real internal PB route |
| D4 | Invoice send: no admin check | `api/invoices/send-email/+server.ts` | `assertAdmin()` |
| D5 | Users `listRule` over-permissive | `pb_migrations/1781120207_updated_users.js` | Admin-only list or `id = @request.auth.id` |
| D6 | Invoice PB rules wrong | `pb_migrations/1781125204_*.js` | New migration: `@request.auth.role = "admin"` |
| D7 | Cron `X-Internal-Secret` ignored on collections | `api/cron/process-crew-notifications/` | Internal PB routes with app-level privileges |
| D8 | `crewNotificationLog` field missing | PB migration needed | Add field; fix dedup |
| D9 | Internal routes return auth links in JSON | `pocketbase-main.go` | Return `{ success: true }` only; email links via Brevo |

### Batch E — P2 fixes (if time before import)

| ID | Issue | Fix |
|----|-------|-----|
| E1 | Calendar jump UTC date | Use `toDateString()` in `JobDetailsModal` |
| E2 | Docx ignores legacy `hours` key | `quantity ?? hours ?? 1` in docx builder |
| E3 | Modal actions lack try/catch | Toast errors on status/cancel/save failures |
| E4 | `isInvoiceOverdue` datetime compare | Compare calendar dates only |
| E5 | Root `/` stub | Redirect to `/calendar` or `/login` |
| E6 | Railway cron schedule | Configure in Railway dashboard |

---

## Priority 1 — Legacy import (Jun 23–29, after Batch A)

**Blocked until Batch A complete.** Importing into a broken sync layer will strand data.

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

**Sample files needed by Jun 20:** one client CSV, one Asana export, one OCR CSV, 2–3 scans.

---

## Priority 2 — Ship (Jun 30 – Jul 1)

- Full import verification in `/jobs` + `JobDetailsModal` (spot-check 50 records)
- Invoice E2E smoke on Railway
- Bug-fix buffer for import fallout
- Final deploy; monitor only on Jul 1

---

## Descoped (post–July 1)

Automated backups (spec §14), web push, mobile job list under calendar, client archive UI, admin photo at user create, QuickBooks/CSV export, Dexie encryption, full E2E in CI, `SyncStatus` mount, `/calendar/split` dedup.

---

## Day-by-day schedule

| Date | Focus |
|------|-------|
| **Jun 18** | A1–A2: queue integrity + mutex |
| **Jun 19** | A3–A7: relation resolution, paginated pull, realtime conflict |
| **Jun 20** | B1–B6: cancelJob, tax rate, PB field mapping |
| **Jun 21** | C1–C5: bulk invoice map, ID canonicalization |
| **Jun 22** | D1–D9: security + PB migrations + cron |
| **Jun 23** | Import parsers (client, Asana, OCR); receive sample files |
| **Jun 24** | Import wizard + 50-row dry-run test |
| **Jun 25–26** | Full ~900 record import in batches |
| **Jun 27–29** | Verify in UI; fix fallout; E1–E6 if time |
| **Jun 30** | Final smoke; deploy |
| **Jul 1** | **Ship** |

---

## July 1 acceptance checklist

- [ ] Batch A complete — queue never drops failed items; sync mutex in place
- [ ] B1 + B2 fixed — cancel notes and tax rate verified
- [ ] C1 complete — jobs page loads in < 2s with ~900 jobs
- [ ] D1–D6 complete — API routes locked down; PB rules fixed
- [ ] ~900 imported records searchable; files downloadable in modal
- [ ] Full invoice lifecycle works on Railway
- [ ] Crew assignment emails fire (cron configured)
- [ ] Zero open P0/P1 bugs
- [ ] `pnpm test` green

---

## Documents consolidated into this plan

| Document | Action |
|----------|--------|
| `TODO.md` | **Superseded** — replaced with pointer to this file |
| Session `plan.json` files | Empty; no action |
| Prior "July 1 Finish Plan" (Cursor) | **Superseded** by this file |
| `JOBS_AND_INVOICES_SPEC.md` | **Kept** — technical spec (data model, UI requirements) |
| `TESTING_PLAN.md` | **Kept** — testing strategy; run tests per Batch A–D |
| `invoice-double-window-pattern.md` | **Kept** — docx layout reference |

---

## References

- Code review: conversation June 18, 2026 (sync layer, security, UI/scale)
- Repo: Remedine/Svelte_FullCalendar_Dexie_Scheduling
- AGENTS.md: Svelte 5 runes, commit-after-change workflow