# Multi-agent review synthesis

**Commit:** `64e9233`  
**Date:** 2026-07-16  
**Agents:** A–F domain + G (security) + H (maintainability)

## Executive summary

Eight independent reviews of the **real** GitHub app (not the wiped working tree) converge on a clear story:

1. **Security holes are real and cross-cutting.** Unauthenticated SvelteKit routes proxy `INTERNAL_SECRET` for mark-verified, welcome email, and email-change. PocketBase rules over-expose clients/users and let crew escalate `role` or fully edit assigned jobs (including prices).
2. **Data integrity risks sit in sync + logout + restore.** Invoice stale-delete has no empty-roster guard; job updates can PATCH a Dexie UUID then drop the queue item; logout clears the PB token *before* flushing the queue then wipes IndexedDB; authEpoch can no-op on cold restore.
3. **Money paths need tightening.** Tax fallback 8% vs 5%, emailing stale `.docx` with live totals, auto write-back of invoice snapshot to client/job.
4. **Maintainability is dominated by three god-files (~8k lines)** and dead dual components (~1.4k lines safe to delete). Multi-model fingerprints (`)= -` markers, Batch A/B, Phase N invoice blocks, dual PIN/session/invoice/calendar) are everywhere.

**Good news:** Admin backup APIs are largely correctly gated; pure utils (`invoiceTotals`, `dates`, `crew`, `backups/*`) are a solid foundation; bulk import is correctly dry-run-only (501 on commit).

---

## Consensus matrix (high-signal only)

| Finding | Domain agents | G | H | Consensus | Confidence | Priority |
|---------|---------------|---|---|-----------|------------|----------|
| Unauthenticated privileged `/api/auth/*` (mark-verified, send-welcome, email-change, open mailers) | A, F | Y | — | **Full** | high | **P0** |
| Crew → admin via PB `role` self-update | — | Y | — | Strong (G) | high | **P0** |
| Full client PII list/pull for any authed user | — | Y | — | Strong (G) | high | **P0** |
| Crew full job update (prices/schedule) + calendar always editable | C, F | Y | — | **Full** | high | **P0** |
| Logout clears token before queue flush, then wipes Dexie | A (related), B | Y | Y (dual logout) | **Full** | high | **P0** |
| Auth epoch restore race (cold start advances epoch, no wipe) | A | Y | — | **Full** | high | **P0** |
| Invoice pull stale-delete without empty-roster guard | B | (LWW/sync) | — | Partial | high | **P0** |
| Job update UUID PATCH → 404 drops queue | B | — | Y (queue tree) | Partial | high | **P0** |
| LWW string vs Date for clients/invoices | B | Y | — | **Full** | high | **P1** |
| Drive refresh token on world-readable options | E | — | — | Single (E) | high | **P0** |
| Client Options save overwrites server backup metadata | E | — | — | Single (E) | high | **P0** |
| Tax fallback 8% vs 5%; stale docx email | D | — | — | Single (D) | high | **P0** |
| Auto invoice write-back vs optional spec | D | — | — | Single (D) | med | **P1** |
| NewUser marks PB verified immediately | A | Y (mark-verified) | — | **Full** | high | **P0** |
| Crew fail-open when display name empty | C | Y (crew authz) | — | **Full** | high | **P0** |
| Complete job policy split (form end vs details start) | C | — | Y (dual surfaces) | **Full** | high | **P1** |
| Dual notify paths (poller + cron) / mark-sent 403 for crew | F | — | — | Single (F) | high | **P1** |
| Job/invoice email APIs: any authed → any recipient | D, F | Y | — | **Full** | high | **P0** |
| Dead duals: JobInvoicePanel, Calendar.svelte, ForcePhotoUpdateModal | C, D, A | — | Y | **Full** | high | **P1** (easy win) |
| God files: db/index, SplitCalendar, options page | B, C, E | — | Y | **Full** | high | **P1** |
| Dual session/PIN writers | A | — | Y | **Full** | med | **P2** |
| Desktop idle never expires without quick-unlock | A | — | — | Single (A) | high | **P1** |
| Offline routes miss `/calendar/split`, `/profile` | F | — | — | Single (F) | med | **P2** |
| Docs/README/CI drift | F | — | — | Single (F) | high | **P2** |

### Conflicts / product decisions (need your call)

| Topic | Side A | Side B | Note |
|-------|--------|--------|------|
| Crew calendar write access | C/G: lock down (read-only or status-only) | Current product: full edit on assigned jobs | PB + UI both allow full update |
| Client roster for crew | G: scope or hide PII | Current: full pull for offline CRM | Lost-phone risk |
| Invoice auto write-back | D/spec: optional admin action | Code: always on generate | Product vs implementation |
| Dual crew notify (client + cron) | F: pick one writer | May want client fallback offline | Dedup is soft today |

---

## Adversarial comparison (G vs H)

| Area | G (security) emphasis | H (maintainability) emphasis | Overlap |
|------|----------------------|------------------------------|---------|
| Auth APIs | Critical open proxies | — | Fix first; no structure debate |
| PB rules | Role escalation, client list, job update | — | Migrations + hooks |
| Logout / queue | Data loss on wipe | Dual `logout` naming trap | Same fix path: one app logout, flush-then-clear |
| Sync queue | UUID PATCH drop, LWW | God-tree FormData copy-paste | Extract handlers *after* policy fixes |
| Giant files | Indirect (hard to secure) | Primary judo target | Delete dead duals first, then split |
| Invoices | Money integrity (via D) | Dead panel + FormData clones | Delete JobInvoicePanel; unify builders |

**Neither agent contradicted the other’s top risks.** G did not claim the codebase is structurally fine; H did not claim security is fine. Highest confidence items are those both domain agents *and* G (or H) hit.

---

## Multi-model fingerprints (cross-agent)

Seen in A–H:

- Comment markers: `)= -`, Batch A/B, Phase 0/1/2 invoice, Remedine template lineage  
- Dual systems: session writers, PIN fields, force-photo modals, invoice UIs, calendars, logout functions, dark themes, notify senders, invoice number formats  
- Incomplete migrations: fields “removed from UI” still merged in sync; dead components still ship  

---

## What not to do next

- Do **not** start with a mega-refactor of `db/index.ts` before P0 security/data-loss fixes.  
- Do **not** “clean up” by deleting features on a half-wiped tree (already restored).  
- Do **not** expand bulk import apply until authz + dry-run semantics are solid.

See `cleanup-backlog.md` for PR-sized next steps.
