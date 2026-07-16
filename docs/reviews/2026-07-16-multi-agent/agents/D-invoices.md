# Agent D: Invoices & Billing Review

**Commit:** `64e9233`  
**Scope:** InvoiceEditor, JobInvoicePanel, BillableItemRow, `src/lib/utils/invoice*`, `tax.ts`, `docs/JOBS_AND_INVOICES_SPEC.md` (spot-check), `src/routes/api/invoices/**`  
**Date:** 2026-07-16  
**Mode:** Read-only code review  

---

## Findings

### F1 — UI tax fallback (8%) disagrees with save/total engine fallback (5%)

| Field | Value |
| --- | --- |
| **Severity** | **High** |
| **File:line** | `src/lib/components/InvoiceEditor.svelte:88`; `src/lib/utils/tax.ts:5`; `src/lib/db/index.ts:1384`; also `JobFormModal.svelte:192`, `src/lib/db/pb.ts:461` |
| **Theme** | Money / tax |
| **Description** | Preview totals in `InvoiceEditor` use `normalizeTaxRateToPercent(optionsStore.data?.taxRate, **8**)`, while `saveInvoiceSnapshot` / `ensureInvoiceShell` / `calculateInvoiceTotals` persistence path use the default fallback of **5**. When options are unloaded or `taxRate` is null/undefined, the accordion can show one total and the persisted `amount` / `.docx` tax another. |
| **Why** | Client sees wrong tax on screen; emailed amount (from live `$derived` totals) can disagree with generated file totals after save; Juneau/CBJ default in options store is 5%, not 8%. |
| **Fix** | Single shared constant (e.g. `DEFAULT_TAX_RATE_PERCENT = 5`) used everywhere; never pass ad-hoc fallbacks. Prefer failing closed if options missing rather than inventing 8%. |
| **Effort** | S |

---

### F2 — Auto write-back after generate vs optional “Save to client/job”

| Field | Value |
| --- | --- |
| **Severity** | **High** |
| **File:line** | `src/lib/components/InvoiceEditor.svelte:292–297`; `src/lib/db/index.ts:1432–1477`; spec §6 |
| **Theme** | Snapshot vs live data |
| **Description** | Spec: optional hybrid write-back via admin **Save to client/job**. Code: every successful Generate/Regenerate **always** calls `writeInvoiceSnapshotToClientJob`, which mutates Client address/contact and Job billables/totals. No admin gate, no opt-in control, no confirmation. |
| **Why** | Invoice snapshots are meant to freeze billing history. Silent write-back can overwrite live client/job with invoice-only edits (or wipe intentional job differences after “Refresh from job” then regenerate). Also maps invoice-level discounted subtotal onto the job without writing line discounts. |
| **Fix** | Remove auto call; add explicit “Push snapshot to client/job” (admin-only) matching the spec. If auto sync is desired product-wise, update the spec and add a confirm + per-field control. |
| **Effort** | M |

---

### F3 — Stale `.docx` can still be emailed with live totals

| Field | Value |
| --- | --- |
| **Severity** | **High** |
| **File:line** | `src/lib/components/InvoiceEditor.svelte:375–416`, `687–690`, `857–866`; `isDocxStale` in `invoiceSnapshot.ts:106–118` |
| **Theme** | Snapshot vs live / money |
| **Description** | Editor correctly banners when `docxStale`, but **Send** remains enabled whenever `hasPrimaryDocx && canEmailInvoice`. Email body uses **live** `totals.total`; attachment is the **old** primary file from PB. |
| **Why** | Customer receives mismatched amount-in-email vs amount-in-document; accounting risk. |
| **Fix** | Disable Send when `docxStale` (or force regenerate first). Prefer `invoice.amount` for email body to match stored snapshot. |
| **Effort** | S |

---

### F4 — Docx generator trusts stored `subtotal`/`taxAmount`/`amount` without recompute

| Field | Value |
| --- | --- |
| **Severity** | **Medium** |
| **File:line** | `src/lib/utils/invoiceDocx/index.ts:117–131`; `panels.ts:156–285` |
| **Theme** | Totals consistency |
| **Description** | `generateInvoiceDocxFromSnapshot` prints `invoice.subtotal`, `invoice.taxAmount`, `invoice.amount` as-is. It does not re-run `calculateInvoiceTotals` from `billableItems` + `invoiceDiscount` + tax. Line cells use each item’s `total` field, also not re-normalized. |
| **Why** | Any stale or partially hydrated invoice (legacy import, pull race, `ensureInvoiceShell` hydration without recompute of nets) produces a document whose lines don’t add to the printed total. |
| **Fix** | Always `normalizeBillableItems` + `calculateInvoiceTotals` inside the generator; treat stored money fields as cache only. Optionally assert equality and log. |
| **Effort** | S |

---

### F5 — Percent invoice discount row prints blank amount

| Field | Value |
| --- | --- |
| **Severity** | **Medium** |
| **File:line** | `src/lib/utils/invoiceDocx/panels.ts:193–217` |
| **Theme** | Docx structure / money |
| **Description** | For `invoiceDiscount.type === 'percent'`, the discount table cell amount is hardcoded to `''`. Dollar discounts show `-$N`. Subtotal row already reflects post-discount amount. |
| **Why** | Printed invoice does not show the dollar impact of a percent discount on the discount line; harder for client to reconcile. |
| **Fix** | Compute and print `-$X.XX` (and optionally keep “10%” in description). |
| **Effort** | S |

---

### F6 — Line discount only appears on docx when description is set

| Field | Value |
| --- | --- |
| **Severity** | **Medium** |
| **File:line** | `src/lib/utils/invoiceDocx/panels.ts:169–173` |
| **Theme** | Docx structure |
| **Description** | `hasDiscount = !!(item.lineDiscount?.value > 0 && discountNote)`. A line with a pure $/% discount and empty note prints only the net `item.total` with no indication a discount was applied. |
| **Why** | Opaque pricing on the customer document. |
| **Fix** | Append a synthetic note (`10% off` / `-$25`) when value &gt; 0 and description empty; still show description when present. |
| **Effort** | S |

---

### F7 — Dual invoice-number systems (dead panel vs live editor)

| Field | Value |
| --- | --- |
| **Severity** | **Medium** |
| **File:line** | `src/lib/utils/invoiceSnapshot.ts:10–17` (`CCW-YYYY-MM-DD-###`); `src/lib/db/index.ts:1168–1195` (`CCW-YYYY-####`); `JobInvoicePanel.svelte:155–156` |
| **Theme** | Schema drift / dead code |
| **Description** | Spec and `bumpInvoiceVersionForGenerate` use `{prefix}-{YYYY-MM-DD}-{version}`. `allocateInvoiceNumber` still increments yearly sequence `CCW-2026-0001` and is only used by `JobInvoicePanel` (not mounted). Interface comment still documents the old format (`Invoice` in `db/index.ts:332`). |
| **Why** | Confusing dual API; tests still cover `allocateInvoiceNumber`; risk of future callers minting non-spec numbers. |
| **Fix** | Delete or deprecate `allocateInvoiceNumber` after removing `JobInvoicePanel`; update comments/tests to versioned format only. |
| **Effort** | S |

---

### F8 — `JobInvoicePanel.svelte` is dead / parallel billing UI

| Field | Value |
| --- | --- |
| **Severity** | **Medium** |
| **File:line** | `src/lib/components/JobInvoicePanel.svelte` (entire); `JobDetailsModal.svelte:451` uses `InvoiceEditor` only |
| **Theme** | Dead code |
| **Description** | Spec §6: `InvoiceEditor` replaces two-mode `JobInvoicePanel`. Panel still implements live-job `generateInvoiceDocx`, old numbering, “Delete entire invoice” (forbidden in v2 UI), `alert()` error UX, no snapshot editor, no stale detection, amount email from `invoice.amount ?? job.totalAmount`. No remaining production import. |
| **Why** | Maintenance trap; agents/docs still reference it; diverges from snapshot model. |
| **Fix** | Delete the component (and unused CSS/tests references). Keep only snapshot path. |
| **Effort** | S |

---

### F9 — Tax rate not snapshotted on invoice (historical regenerate drift)

| Field | Value |
| --- | --- |
| **Severity** | **Medium** |
| **File:line** | `invoiceTypes.ts` / `Invoice` interface; `saveInvoiceSnapshot` tax from options; `InvoiceEditor.svelte:88–96`; spec §6 “Read-only / auto: … tax rate” |
| **Theme** | Snapshot vs live data |
| **Description** | Billables, discounts, and money totals are stored; **tax rate % is not**. Save/generate always re-derive tax from current `options.taxRate`. Changing company tax later rewrites tax on next save/regenerate of old invoices. |
| **Why** | Paid/historical invoices should freeze tax treatment; CBJ rate changes or option edits alter history. |
| **Fix** | Persist `taxRatePercent` on invoice at first save/generate; use stored rate for totals/docx; options only seed new shells. |
| **Effort** | M |

---

### F10 — Write-back drops line discounts and may desync job lines vs job totals

| Field | Value |
| --- | --- |
| **Severity** | **Medium** |
| **File:line** | `src/lib/db/index.ts:1457–1476` |
| **Theme** | Totals consistency / schema |
| **Description** | Job update maps only `title, price, quantity, total, unit` — **not** `lineDiscount`. Totals use invoice-level discount + tax. Job interface also lacks `lineDiscount` / proper `unit` on `billableItems` (`db/index.ts:201–206`). |
| **Why** | Job card totals can include invoice discounts while lines look full-price; refresh-from-job then loses discount structure. |
| **Fix** | Extend Job billable type or write pre-discount line nets only and keep invoice discount invoice-only; document the chosen model. |
| **Effort** | M |

---

### F11 — `ensureInvoiceShell` local-only hydration (no sync queue)

| Field | Value |
| --- | --- |
| **Severity** | **Medium** |
| **File:line** | `src/lib/db/index.ts:1338–1350` |
| **Theme** | Snapshot vs live / sync |
| **Description** | When an existing invoice lacks snapshot fields, shell hydrates via `db.invoices.update` without `updateInvoice` / queue. `JSON.stringify` equality also fragile for `Date` vs string. |
| **Why** | Dexie and PocketBase diverge until some later save; multi-device can rehydrate differently. |
| **Fix** | Hydrate through `saveInvoiceSnapshot` or `updateInvoice`; compare field-wise; avoid stringify of Dates. |
| **Effort** | M |

---

### F12 — BillableItemRow total math splits on `showDiscount`

| Field | Value |
| --- | --- |
| **Severity** | **Low** |
| **File:line** | `src/lib/components/BillableItemRow.svelte:82–88` |
| **Theme** | Money / tax |
| **Description** | With `showDiscount={true}` (invoice editor), total uses `computeLineNet` (rounded). Without (job form path), total is raw `price * quantity` (no `roundMoney`, no line discount). |
| **Why** | Two money engines for the same row component → job vs invoice penny drift. |
| **Fix** | Always use `computeLineNet` / `normalizeBillableItems`. |
| **Effort** | S |

---

### F13 — Template `$effect` can clobber quantity/unit

| Field | Value |
| --- | --- |
| **Severity** | **Low** |
| **File:line** | `src/lib/components/BillableItemRow.svelte:43–62` |
| **Theme** | Multi-model fingerprint |
| **Description** | Reactive effect: if title matches a default billable template, unit/quantity are forced when quantity is `undefined` or `1`. Typing a title that collides with a template after user set qty=1 still overwrites. |
| **Why** | Surprising data mutation during edit. |
| **Fix** | Apply template only in `selectTemplate()` (explicit pick), not on every title change. |
| **Effort** | S |

---

### F14 — Zod schema does not enforce money invariants

| Field | Value |
| --- | --- |
| **Severity** | **Low** |
| **File:line** | `src/lib/utils/invoiceSchema.ts:9–16`, `52–59` |
| **Theme** | Schema drift |
| **Description** | `total` is any number; no check that it equals qty×rate−discount; percent discounts unbounded (&gt;100 allowed, floored to 0 in math); email not validated; no tax field. |
| **Why** | Garbage-in still generates “valid” invoices. |
| **Fix** | Recompute totals in validator or strip `total` and derive server-side; cap percent ≤ 100. |
| **Effort** | S |

---

### F15 — Signatory only via hardcoded default (options fields unused)

| Field | Value |
| --- | --- |
| **Severity** | **Low** |
| **File:line** | `invoiceDocx/panels.ts:54–57`, `304–306`; `invoiceDocx/index.ts:225–226`; `AppOptions` in `db/index.ts:266–320` (no signatory fields); options UI |
| **Theme** | Schema drift / multi-model fingerprint |
| **Description** | Docx context maps `invoiceSignatoryName/Phone` from options, but `AppOptions` and admin options UI never define/edit them. Always falls back to `DEFAULT_SIGNATORY` (“Brick A. Engstrom” / phone). |
| **Why** | Spec lists signatory as options-driven; product can’t change closing without code edit. |
| **Fix** | Add options fields + UI, or drop mapping and document hardcode as intentional. |
| **Effort** | M |

---

### F16 — Double-window layout: solid constants, fragile exact-height panel

| Field | Value |
| --- | --- |
| **Severity** | **Low** |
| **File:line** | `invoiceDocx/layout.ts:16–52`; `panels.ts:95–153`, `348–369` |
| **Theme** | Double-window pattern |
| **Description** | Layout matches `docs/invoice-double-window-pattern.md` (left 0.875", return ~0.6", recipient zone after 2.5" row, body after ~4.25"). Tests assert twip constants. Risks: outer `TOP_ADDRESS_PANEL_HEIGHT` is EXACT — long addresses/preview labels can clip; invoice meta sits in the right column of the upper 2.5" (OK for windows, dense for print); `PANEL_HEIGHT` tri-fold third is unused legacy. |
| **Why** | Physical #10 alignment is sensitive; overflow is silent in Word. |
| **Fix** | Cap recipient lines; keep envelope preview dev-only (already); consider min height instead of exact for body separation if clipping appears in production. |
| **Effort** | M |

---

### F17 — Send-email API trusts client payload

| Field | Value |
| --- | --- |
| **Severity** | **Medium** |
| **File:line** | `src/routes/api/invoices/send-email/+server.ts:17–44` |
| **Theme** | API / security-light |
| **Description** | Auth via PB `auth-refresh` only. No ownership check that the invoice belongs to the firm; `docxBase64`/`amount`/`clientEmail` fully client-supplied; no size limit; errors return `details` to client. |
| **Why** | Authenticated user can email arbitrary attachments/amounts to arbitrary addresses (spam/abuse); large base64 body risk. |
| **Fix** | Accept `invoiceId`, load file from PB server-side, cap payload size, sanitize error messages. |
| **Effort** | M |

---

### F18 — Preferred billing method default mismatch (`invoice` vs `email`)

| Field | Value |
| --- | --- |
| **Severity** | **Low** |
| **File:line** | `invoiceSnapshot.ts:80`; `invoiceDocx/index.ts:73`; `pb.ts:592` defaults clients to `email` |
| **Theme** | Schema drift |
| **Description** | `clientFromSnapshot` defaults `preferredBillingMethod` to `'invoice'` when building synthetic Client for payment instructions, while real clients often default to `'email'`. Payment copy differs (generic remit vs email confirmation). |
| **Why** | Snapshot path without linked client can print wrong payment language. |
| **Fix** | Pass through real method always; default consistently to `'email'` or require linked client. |
| **Effort** | S |

---

### F19 — Dead / duplicate helpers in docx package

| Field | Value |
| --- | --- |
| **Severity** | **Low** |
| **File:line** | `panels.ts:288–297` `buildLineItemsTable`; unused `getDisplayAreaColor` import in `BillableItemRow.svelte:4`; duplicate `.billable-item-row__suggestion` CSS blocks (`:469–478` and `:552–571`) |
| **Theme** | Dead code |
| **Description** | Job-based line table is only defined, never called (legacy path fully wraps snapshot). Minor dead import/CSS duplication. |
| **Why** | Noise and false confidence in job-live docx path. |
| **Fix** | Delete unused exports/CSS/import. |
| **Effort** | S |

---

### F20 — Accordion defaults closed; validation/save friction

| Field | Value |
| --- | --- |
| **Severity** | **Low** |
| **File:line** | `InvoiceEditor.svelte:64–66`, `177–205` |
| **Theme** | UX / multi-model fingerprint |
| **Description** | Who/What/Document accordions start closed; total only in summary. `persistDraft` blocks save on any Zod failure (including incomplete address mid-edit) with errors only when validation runs — good for generate, harsh for blur-save. |
| **Why** | Users may not discover line-item editor; partial drafts hard to stage. |
| **Fix** | Open “What & how much” by default when draft incomplete; soft-save draft vs hard-validate on generate only. |
| **Effort** | S |

---

### F21 — Component tests for billable row are skipped

| Field | Value |
| --- | --- |
| **Severity** | **Low** |
| **File:line** | `BillableItemRow.test.ts:12` (`describe.skip`) |
| **Theme** | Multi-model fingerprint / quality |
| **Description** | Entire BillableItemRow suite skipped due to Svelte 5 + happy-dom mount issues. Totals unit tests exist but are thin (2 cases). No snapshot-discount→docx integration test. |
| **Why** | Regression surface for F5/F6/F12 is unguarded. |
| **Fix** | Unskip or replace with pure-function tests; add docx tests for discounts. |
| **Effort** | M |

---

## Spec vs code gaps

| Spec (JOBS_AND_INVOICES_SPEC.md) | Code reality |
| --- | --- |
| §6 `InvoiceEditor` replaces `JobInvoicePanel` | Editor is mounted; **panel still in tree as dead code** |
| Optional admin **Save to client/job** | **Automatic** write-back after every generate |
| Numbering `{prefix}-{YYYY-MM-DD}-{version}` | Editor path OK; **legacy allocator** still present |
| No “Delete entire invoice” UI | Editor OK; **JobInvoicePanel** still has it |
| Snapshot authoritative for docx | Mostly true; **tax rate live from options**; money fields not re-derived in generator |
| Upload revised does not change status | Editor sets `lastGeneratedAt` (clears stale) — OK; panel does not set `lastGeneratedAt` (if revived, stale logic wrong) |
| §2 original Invoice shape (amount + optional billables only) | Evolved with snapshot fields + PB migration `1781900000_*` — **good**, but §2 text not fully updated |
| Overdue derived UI | Implemented via `isInvoiceOverdue` outside this agent’s components — OK |
| Supporting docs without full invoice | `addSupportingDocumentsToJob` → `ensureInvoiceForJob` — OK |
| Send when billing preference is email | `clientPrefersEmailBilling` — OK |
| Signatory from options | **Hardcoded default**; options fields not wired |

---

## Multi-model fingerprints

Evidence of layered / multi-agent authorship without a single cleanup pass:

1. **Two UIs for one feature** — full snapshot `InvoiceEditor` + leftover live-job `JobInvoicePanel` with different numbering, status, and delete semantics.
2. **Two invoice number formats** — `formatInvoiceNumber` vs `allocateInvoiceNumber`.
3. **Scattered tax fallbacks** — `5` (tax.ts, options) vs `8` (InvoiceEditor, JobFormModal, job pull).
4. **Comment drift** — Phase 2 “file upload stubbed” still on invoice CRUD (`db/index.ts:957–958`) while file queue is implemented; invoice number comment still `CCW-2026-0001`.
5. **Hardcoded personal signatory** + optional options keys that never appear on `AppOptions`.
6. **`)= -` comment style** mixed with plain comments; some modules heavily annotated, utils lighter.
7. **Payment method defaults** `'invoice'` in snapshot helpers vs `'email'` in client pull/create paths.
8. **`buildLineItemsTable(job)`** left after snapshot refactor.
9. **BillableItemRow** dual total formula and aggressive template `$effect` — iterative UI glue rather than pure totals module.
10. **Skipped component tests** with long environmental excuse comments — classic “landed and left red.”

---

## Top 5 cleanup actions

1. **Unify tax handling** — one default (5%), one normalize path; recompute docx totals from lines; optionally snapshot tax % on the invoice (closes F1, F4, F9).
2. **Delete `JobInvoicePanel` + `allocateInvoiceNumber`** (or hard-deprecate) so only the snapshot editor path remains (F7, F8, F19).
3. **Stop auto write-back; block Send when docx stale** — align with spec hybrid model and prevent wrong customer emails (F2, F3).
4. **Fix discount rendering on docx** — percent amount cell + line-discount labels without requiring free-text notes (F5, F6).
5. **Harden generate/send pipeline** — server-side invoice email by id; hydrate shells via queued updates; thin integration tests for totals + discounts + envelope constants (F11, F17, F21).

---

## Top 3 (executive)

1. **Tax fallback 8 vs 5 + non-snapshotted rate** → wrong money on screen vs save/docx/history.  
2. **Auto write-back + stale-docx email** → silent mutation of client/job and customer-facing amount mismatch.  
3. **Dead `JobInvoicePanel` / dual numbering** → parallel legacy billing stack still in the repo next to the intended snapshot editor.

---

## File map (reviewed)

| Path | Role |
| --- | --- |
| `src/lib/components/InvoiceEditor.svelte` | Snapshot UI, generate, email, workflow |
| `src/lib/components/JobInvoicePanel.svelte` | **Dead** legacy panel |
| `src/lib/components/BillableItemRow.svelte` | Line item editor |
| `src/lib/utils/invoiceTypes.ts` | Shared types |
| `src/lib/utils/invoiceTotals.ts` (+ test) | Money engine |
| `src/lib/utils/invoiceSnapshot.ts` | Snapshot builders, number format, stale check |
| `src/lib/utils/invoiceSchema.ts` | Zod validation |
| `src/lib/utils/invoiceDocx/**` | Docx double-window builder |
| `src/lib/utils/tax.ts` (+ test) | Rate percent/decimal normalize |
| `src/lib/db/index.ts` | Invoice CRUD, shell, write-back, bump version |
| `src/lib/db/pb.ts` | Invoice pull mapping |
| `src/routes/api/invoices/send-email/+server.ts` | Email API |
| `docs/JOBS_AND_INVOICES_SPEC.md` | Spec spot-check §2–6 |
| `docs/invoice-double-window-pattern.md` | Envelope reference |

---

**Output path:** `docs/reviews/2026-07-16-multi-agent/agents/D-invoices.md`
