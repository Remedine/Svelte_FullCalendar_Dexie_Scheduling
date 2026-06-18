# Jobs Page, Job Details Modal & Invoices — Technical Spec

**Project:** Remedine/Svelte_FullCalendar_Dexie_Scheduling  
**Date:** 2026  
**Status:** Approved for implementation (spec first, then build)

## 1. Goals & Scope

The `/jobs` page becomes the primary admin hub for:
- Browsing and filtering all jobs (past, future, cancelled, by amount, area, crew, invoice presence).
- Searching broadly across job, client, crew, and billable data.
- Viewing rich job cards.
- Opening a detailed, reusable **Job Details Modal** for any job.

A new first-class `Invoice` entity is introduced to:
- Support proper financial tracking and future integrations (QuickBooks, CSV export).
- Allow storage of the primary editable `.docx` invoice + supporting documents (scans, photos, Asana exports).
- Handle ~900 legacy imported invoices (handwritten + Asana) with tolerance for imperfect data.
- Track explicit status: `draft` | `generated` | `sent` | `paid` (overdue is derived).

The same **Job Details Modal** must be reusable from:
- The main `/jobs` page (card click).
- The Clients page (inside an expandable "Related Jobs" list per client card).

Key constraints (from AGENTS.md):
- Svelte 5 runes only (`$state`, `$derived`, `$effect`, `$props`, `$bindable`, snippets).
- Full TypeScript.
- Strict BEM naming for all CSS.
- `)= -` comments for every meaningful change.
- Reference the repo in relevant comments.
- No legacy Svelte 4 patterns.

Current reality (pre-work):
- Jobs live in Dexie + PocketBase with full sync queue.
- `JobFormModal` handles create/edit + billables (opened from calendar surfaces).
- Clients page shows aggregates only (no job list).
- `/jobs` page is a minimal searchable list with placeholder click behavior.
- No `Invoice` collection or model yet (only `invoiceDueDays` in options and `preferredBillingMethod` on clients).
- Attachments beyond user photos are not implemented.
- `docx` + `file-saver` are already dependencies.

## 2. Data Model

### 2.1 New `Invoice` Interface

```ts
export interface Invoice {
  id?: string;
  pbId?: string;
  jobId: string;                    // local Dexie id or PB id (resolved at sync time)
  clientId: string;                 // denormalized for fast queries and legacy imports
  status: 'draft' | 'generated' | 'sent' | 'paid';
  dueDate: Date;
  paidAt?: Date;
  amount: number;                   // snapshot at generation time
  billableItems?: Array<{           // optional snapshot for historical fidelity
    title: string;
    price: number;
    quantity: number;
    total: number;
  }>;
  notes?: string;
  importSource?: string;            // e.g. 'asana-export', 'handwritten-ocr', 'manual'
  primaryInvoiceFile?: {            // the editable .docx the user reviews/edits
    filename: string;
    // PB file access is via pb.collection('invoices').getOne(...) + getUrl
  };
  supportingDocuments?: Array<{     // scans, photos, original exports, etc.
    filename: string;
    type?: string;                  // 'image/jpeg', 'application/pdf', etc.
  }>;
  createdAt: Date;
  updatedAt: Date;
}
```

**Decisions locked:**
- Keep invoice data completely separate from Job (no `invoiceId` or `invoiceStatus` denormalized onto Job records).
- One primary file (`primaryInvoiceFile`) + separate array of supporting documents.
- On re-upload of an edited .docx → overwrite the primary file (no automatic version history for v1).
- Legacy imports will set `importSource` on both the created Job and the linked Invoice.

### 2.2 Changes to Existing Models

- `Job` interface gains one optional field for legacy support:
  ```ts
  importSource?: string;
  ```
- No other changes to Job shape for invoice purposes.

### 2.3 Dexie Schema

- New store: `invoices`
- Indexes (minimum): `id, jobId, clientId, status, dueDate, importSource`
- Bump Dexie version (currently v16).

### 2.4 PocketBase Collection (to be created via migration or admin UI)

- Collection name: `invoices`
- Fields: job (relation), client (relation or text for legacy), status (select), dueDate (date), paidAt (date), amount (number), billableItems (json), notes (text), importSource (text), primaryInvoiceFile (file), supportingDocuments (file, multiple).
- Rules: admin-only for create/update/delete (list/view can be relaxed later if needed for reporting).

## 3. File Handling & Offline Strategy

- All invoice files (primary .docx + supporting docs) live in PocketBase file fields.
- Dexie stores only metadata (`filename`, presence flags). **No binary image/document data is cached locally in Dexie for invoices** (user photos/avatars remain the exception stored as data URLs).
- When the JobDetailsModal needs to show or let the user download a file, the app constructs a URL via `pb.files.getUrl(record, filename)` (or equivalent) and opens it.
- Offline behavior (accepted):
  - Job details, billables, status, notes, totals → available.
  - Actual .docx or supporting scans → "File not available offline".
- For the 900 imports: PocketBase is expected to handle the storage volume.

## 4. Sync & Persistence

- Extend `SyncQueueItem`:
  ```ts
  collection: 'jobs' | 'clients' | 'users' | 'invoices';
  ```
- `processSyncQueue` must gain a branch for `'invoices'`.
- File-bearing creates/updates are special:
  - Record is created first (plain fields).
  - Then the file(s) are uploaded to the PB record (using FormData or `pb.collection('invoices').update(id, formData)`).
  - Queue items carrying file data must preserve Blobs / data URLs until processed.
- Pull logic (`pullInvoicesFromServer` or extension of existing pulls) will be needed.
- Legacy import path (future) will bypass normal queue for bulk creation with files.

## 5. Invoice Status & Derived State

- Stored statuses: `draft` | `generated` | `sent` | `paid`
- Overdue (UI only, computed):
  ```ts
  const isOverdue = invoice.status !== 'paid' &&
                    invoice.dueDate < new Date() &&
                    optionsStore.data?.invoiceDueDays != null;
  ```
- `dueDate` is set at generation time using `job.end + invoiceDueDays` (or current options value).

## 6. Generation Flow

- **Generate Draft** (available on scheduled/confirmed jobs):
  - Creates an Invoice with `status: 'draft'`.
  - Generates .docx from current job billables + client + current tax/due settings.
  - Stores the .docx as the primary file on the new Invoice record.
  - Located in JobDetailsModal under the Billing Items section.

- **Mark Complete** (on any non-cancelled job):
  - Sets `job.status = 'completed'`.
  - Creates (or updates) an Invoice with `status: 'generated'`.
  - (Re)generates the .docx from current billables.
  - Stores/overwrites the primary file.

- **Regenerate** (always available once an invoice exists):
  - Uses the latest job billables to produce a fresh .docx and overwrites the primary file.
  - Does **not** change status (a generated invoice stays generated even after regen).

- **Manual re-upload of edited .docx**:
  - User downloads → edits in Word → uploads the saved file via the modal.
  - The uploaded file replaces `primaryInvoiceFile` on the Invoice record.
  - Status is not automatically changed on re-upload.

- The actual .docx generation will live in a reusable helper (e.g. `generateInvoiceDocx(job, client, options)` → Blob).

## 7. /jobs Page (Admin Only)

### Filters & Search (rich surface)
- Quick presets / segmented control: All / Upcoming / Past / This Month / (future: Overdue)
- Date range picker (start + end) — applied to job `start`/`end`.
- Include cancelled: checkbox or facet chip.
- Search input (broad, client-side after enrichment):
  - Job title, notes, cancelReason/cancelNotes
  - Billable item titles
  - Client name, address parts, email, phone
  - Crew names (assignedCrew)
  - Area
  - Possibly invoice notes (after loading invoices)
- Facets (multi-select where appropriate):
  - Area chips (from options.areasOfTown, with color)
  - Crew multi-select (distinct names from current jobs + active users)
  - Amount range (min / max totalAmount)
  - Has Invoice / No Invoice toggle chips

### Pagination
- The main jobs list on /jobs is paginated from the start (initial page size ~50 recommended).
- "Load more" button or infinite scroll trigger.
- Filters and search are applied to the full local dataset (or the current loaded window + a note that more may exist). Future server-side filtering can be added later.

### Cards (BEM, richer than current)
- Area color left border/stripe.
- Status badge(s): job status + invoice status (or "No Invoice").
- Title, client name + short address.
- Date + time range.
- Crew: small stacked avatars (resolved from users by name) + names.
- Total amount.
- Due date / overdue indicator when relevant.
- Click anywhere on card → opens JobDetailsModal.

Enrichment strategy: On page load / filter change, load a window of jobs, then resolve clients and relevant users in batch for display + search.

## 8. JobDetailsModal (New Reusable Component)

**API pattern (modeled on existing JobFormModal):**
```ts
// In JobDetailsModal.svelte (script module)
export function openJobDetailsModal(
  jobOrId: Job | string,
  context?: { fromClientId?: string; fromClientName?: string }
): void;
```

- Single well-organized view (sections with clear visual grouping, no tabs for v1).
- Sections (suggested order):
  1. Header: Job title, job status, invoice status badge, total, due/overdue.
  2. Client & Location (with area color).
  3. Schedule (start/end, duration).
  4. Assigned Crew (photos + names).
  5. Billing Items & Totals (this is where the Generate Draft / invoice controls live).
  6. Invoice Panel (primary file controls: Download, Upload revised .docx, status transitions: Mark Sent, Mark Paid; regenerate action).
  7. Notes (job notes + cancel info if present).
  8. Supporting Documents (list + ability to add more for legacy imports).
  9. Actions footer: Edit job (opens JobFormModal then re-opens this modal via callback), Jump to calendar, Close.

**Client context behavior (chosen for v1):**
- When `fromClientName` is provided, show a clear header indicator / pill: "Related to [Client Name]".
- The client information block inside the modal can be visually emphasized.
- No automatic navigation; user can close the modal to return to the clients list.

**Inline quick edits (light):**
- Change job status (scheduled/confirmed/completed/cancelled — with cancel reason flow if needed).
- Mark invoice sent / paid (with date capture for paid).
- Edit job notes (small textarea save).

**"Generate Draft" location:**
- Under the Billing Items section in the JobDetailsModal.
- When no invoice exists (or for explicit draft creation): prominent "Generate Draft Invoice" button.
- Once an invoice exists, the controls move into a dedicated invoice sub-section (still under/near billing).
- Suggestion: Extract the invoice generation + file controls into a small reusable component (e.g. `JobInvoicePanel.svelte`) so it can be dropped into the modal and potentially other surfaces later.

**Edit round-trip (locked requirement):**
- "Edit full details" button → closes JobDetailsModal → calls `openJobModal(job, onAfterSave)` → on successful save the `onAfterSave` callback re-opens `openJobDetailsModal` with the fresh job data.

**Jump to calendar:**
- Button that navigates to the calendar (split or main) and attempts to focus the relevant date (current calendar components may need minor enhancement for date pre-selection).

## 9. Clients Page Integration

- Inside each client card (below the existing meta line):
  - "Related Jobs (N)" toggle / chevron.
  - On expand: loads up to 10 jobs for that client (most recent first or upcoming-first — TBD in impl).
  - Compact rows: date, title/status, total, invoice status badge.
  - "Load more" if > 10.
  - Each row is clickable → `openJobDetailsModal(job, { fromClientId, fromClientName })`.
- The expansion uses local component state per client (or a small map).
- No global "related jobs" state pollution.

## 10. Import Considerations (for the 900 invoices)

- Future CSV import tooling will:
  - Create Job records with as much data as OCR provides (title, dates, client details, billables, area, crew).
  - Set `job.importSource = 'handwritten-ocr'` or `'asana-export'`.
  - Create linked Invoice records with `importSource`, `status: 'sent'` or `'paid'` where known, `primaryInvoiceFile` + `supportingDocuments` populated from uploaded scans/PDFs.
- Search and cards must gracefully handle missing fields (nulls, partial addresses, etc.).
- "imperfection allowed" is a core requirement.

## 11. Phased Implementation Plan (Recommended Order)

**Phase 0 — Spec & Alignment** (this document)
- Write + review this spec.
- Create todo list.

**Phase 1 — Data Layer Foundations**
- Add `Invoice` interface and `importSource` to Job in `src/lib/db/index.ts`.
- Add `invoices` store + indexes, bump version.
- Implement basic CRUD helpers: `createInvoice`, `updateInvoice`, `getInvoiceForJob`, `getInvoicesForClient`, etc.
- Add `getPaginatedJobsForClient`, `getEnrichedJobs(...)` helpers.
- Extend `SyncQueueItem` type.
- Update `processSyncQueue` skeleton for invoices (file handling can be stubbed first).

**Phase 2 — Sync & PB File Handling**
- Implement invoice pull + push branches in sync logic.
- Handle file uploads for primary + supporting documents (reuse/extend `dataUrlToBlob` pattern).
- Test round-trip create → generate docx → store file → pull back.

**Phase 3 — JobDetailsModal Component**
- Create `src/lib/components/JobDetailsModal.svelte`.
- Implement `openJobDetailsModal` module export.
- Core view, sections, client context indicator.
- Basic actions (status changes, close, jump).
- Stub the invoice generation panel.

**Phase 4 — Invoice Generation & File UI**
- Build `generateInvoiceDocx` helper (or enhance existing logic).
- Full invoice section inside the modal (under billing items).
- Extract `JobInvoicePanel.svelte` (or similar) as suggested.
- Download, upload-replace, regenerate, Mark Sent / Mark Paid flows.
- Wire "Generate Draft" button exactly where specified.

**Phase 5 — /jobs Page Enhancements**
- Replace current simple list with filtered + paginated version.
- Rich filter bar (all facets).
- Broad search implementation (enrichment step).
- Rich BEM cards with client + crew resolution.
- Wire card click → `openJobDetailsModal`.
- Pagination controls.

**Phase 6 — Clients Page Integration**
- Add expandable related jobs section inside client cards.
- 10-item pagination + load more.
- Click handlers that pass client context to the shared modal.
- Refresh logic after modal actions.

**Phase 7 — Polish, Edge Cases, Calendar Jump**
- Re-open callback after JobFormModal edit.
- Cancel flow from details if needed.
- Overdue visual treatment everywhere.
- Offline file messaging.
- Minor calendar date-focus support if missing.
- Loading / empty / error states with BEM.
- Test with imperfect legacy-shaped data.

**Phase 8 — Future / Nice-to-Haves (out of scope for first pass)**
- Bulk actions, CSV export, QuickBooks connector, full server-side filtering, version history for .docx, etc.
- **Automated data backup** — see §14.

## 12. Risks & Open Items (to watch during build)

- File sync in the queue is the most complex new piece (order of record create vs file upload, retry behavior).
- Name-based crew photo lookup is fragile (current `assignedCrew: string[]` design); acceptable for v1.
- Large number of supporting documents per legacy invoice could affect list performance if not careful with expansion.
- Modal stacking / re-open callback must feel smooth (no flash, correct data).
- Date handling (Dexie stores Dates, PB uses ISO strings) must stay consistent.
- When an invoice is generated from a draft on Mark Complete, do we update the existing draft record or create a new one? (Recommend: update-in-place and bump status.)

## 13. References

- AGENTS.md (Svelte 5 runes, BEM, `)= -` comments, full file output, explanations after code blocks).
- Existing patterns: `JobFormModal.svelte` (module export + `openJobModal`), `UserJobsModal.svelte`, client enrichment in `clients/+page.svelte`, sync queue in `src/lib/db/index.ts`.
- Current Job & Client shapes, `BillableItemRow.svelte`, options store (`invoiceDueDays`).
- Repo: Remedine/Svelte_FullCalendar_Dexie_Scheduling.

## 14. Planned Feature — Automated Data Backup

**Status:** Planned (not in scope for Phases 0–7).  
**Goal:** Protect all business-critical app data with scheduled exports, configurable delivery, and tiered retention so storage stays manageable without losing long-term recovery points.

### 14.1 Schedule & delivery

| Requirement | Detail |
|-------------|--------|
| Frequency | **Daily** automated backup (time/timezone TBD — see open items). |
| Delivery options | Admin-configurable **one or more** of: **Google Drive**, **email**, **direct download** (on-demand manual export may also use the same archive builder). |
| Filename format | `YYYY-MM-DD_{Business Name from Options}_Backup` + extension (e.g. `.zip` — format TBD). Business name read from Options `businessName`; sanitize for filesystem (spaces/special characters). |

### 14.2 Retention policy (tiered thinning)

Backups age out through four tiers. A scheduled **retention job** deletes or skips uploads that no longer qualify.

| Backup age | What to keep |
|------------|----------------|
| **0–30 days** | **All daily backups** (up to ~30 files). |
| **31–90 days** (older than 30 days, through 30 days + 2 months) | **One backup per calendar week** only (thin excess dailies). |
| **91–365 days** (after 3 months, before 1 year) | **One backup per calendar month** only. |
| **> 1 year** | **One backup per calendar quarter** only (4 per year). |

**Example timeline**

```
Day 1–30:     2026-06-17_Capital City Windows_Backup, … every day
Day 31–90:    keep e.g. one Sunday (or last-day-of-week) per week; delete other dailies in that window
Day 91–365:   keep e.g. last backup of each month
After year 1: keep e.g. Mar 31 / Jun 30 / Sep 30 / Dec 31 quarter snapshots (rule TBD)
```

### 14.3 Scope & implementation notes (TBD)

- **Data included:** Likely full PocketBase export (collections + files) ± Dexie/local state — exact scope to confirm.
- **Where it runs:** Server-side cron (recommended for reliability) vs. admin PWA trigger — TBD.
- **Google Drive / email:** OAuth or service-account setup, recipient list, and size limits for email attachments — TBD.
- **Retention enforcement:** Applies to copies on Google Drive and any server-side backup store; email/daily download may be fire-and-forget unless a mailbox retention policy is added.
- **Admin UI:** Options page section for enable/disable, destination(s), retention preview, manual “Backup now”, and last-success timestamp.

### 14.4 Open items (need product decisions)

1. **Canonical backup per period** — For weekly / monthly / quarterly tiers, keep the **last** backup in the period, the **first**, or the backup **closest to period end**?
2. **Archive format** — Single `.zip` (JSON + file blobs)? PocketBase native backup? SQLite dump?
3. **Timezone** — Which TZ defines “daily” and the `YYYY-MM-DD` in the filename (business local vs. UTC)?
4. **Maximum retention** — Keep quarterly backups forever, or cap at N years?
5. **Direct download** — Scheduled delivery only, or also an on-demand “Export now” button for admins?
6. **Failure alerting** — Email admin if a scheduled backup fails?

---

**Approval note:** This spec captures all decisions from the planning conversation. Implementation should follow the phased order above. Any deviation should be discussed and the spec updated.
