# Cleanup backlog (PR-sized)

**Source:** Multi-agent review `64e9233` (agents A–H)  
**Priority:** P0 = security/data-loss/money → P1 = structure that blocks safe change → P2 = consistency/tests/docs → P3 = polish

---

## Recommended first sequence

1. **PR-1** Auth API lockdown + stop mark-verified on create  
2. **PR-2** PocketBase rules (role field, users list, clients list, job update fields)  
3. **PR-3** Logout flush-then-clear + authEpoch restore fix  
4. **PR-4** Sync data-loss trio (invoice stale-delete, job update promote, LWW timestamps)  
5. **PR-5** Invoice money UX (tax constant, disable stale send, tax on snapshot)  
6. **PR-6** Delete dead duals (~1.4k lines)  
7. **PR-7+** Structural splits (db sync handlers, SplitCalendar, options tabs)

---

## P0 — Fix first

### P0-1 — Lock down privileged `/api/auth/*` routes
- **Problem:** Unauthenticated POSTs proxy `INTERNAL_SECRET` (mark-verified, send-welcome, email-change; open verification/reset mailers).
- **Evidence:** A-F2, F-F1, G-F1/F2/F3  
- **Approach:** Require admin JWT for mark-verified/send-welcome; require session ownership for email-change; rate-limit public reset; never open-proxy elevated PB actions.
- **Verify:** Attempt unauthenticated curl → 401; admin path still works; unit/integration if present  
- **Effort:** S–M  

### P0-2 — Stop NewUserModal from marking PB verified
- **Problem:** Local `verified:false` but API sets PB `true` → WelcomeModal/temp-password gate skipped on next login.
- **Evidence:** A-F3, G (mark-verified abuse path)  
- **Approach:** Remove mark-verified from create; only after real password change / email confirm.  
- **Verify:** Create user → first login still forces welcome/password flow  
- **Effort:** S  

### P0-3 — PocketBase authz: role, users list, clients, job updates
- **Problem:** Self can PATCH `role` → admin; any authed lists all users; full client roster for crew; assigned crew can update entire job (prices).
- **Evidence:** G-F4/F5/F6/F7, C-F5  
- **Approach:** New migrations/hooks: block non-admin role/active changes; admin-or-self list users; scope clients; crew job update field-limited (status/notes) **or** product-confirm full edit then document.  
- **Verify:** Crew JWT cannot escalate; cannot list all clients if scoped; admin still OK  
- **Effort:** M  
- **Decision needed:** Crew full edit vs status-only; client PII scope  

### P0-4 — Logout: flush queue with valid token, then clear, then wipe
- **Problem:** Token cleared before `processSyncQueue`; offline work lost on logout wipe.
- **Evidence:** G-F8, H dual-logout, B queue policy  
- **Approach:** Reorder logout; block or confirm if pending queue remains after failed flush; rename `pb.logout` → `clearPbAuthStore`. Epoch logout should **discard** queue, not push.  
- **Verify:** Offline edit → logout online → appears on server; pending-fail shows confirm  
- **Effort:** S–M  

### P0-5 — Auth epoch cold-restore race
- **Problem:** Epoch check before auth flags set advances local epoch and continues with stale data.
- **Evidence:** A-F1, G-F9  
- **Approach:** On epoch behind, always clear session + wipe (or force re-login) even if not yet authenticated; don’t advance epoch without wipe; add unit test.  
- **Verify:** Simulated server epoch+1 on cold start → login required, no silent continue  
- **Effort:** M  

### P0-6 — Invoice stale-delete empty roster
- **Problem:** `pullInvoicesFromServer` deletes all local synced invoices if PB returns empty list (no size guard unlike jobs/clients).
- **Evidence:** B-F1  
- **Approach:** Mirror jobs/clients `if (pbIds.size > 0)`; skip if pending queue for that id.  
- **Verify:** Unit test empty pull does not delete; non-empty still prunes true orphans  
- **Effort:** S  

### P0-7 — Job update without pbId (UUID PATCH → drop)
- **Problem:** Job updates can PATCH Dexie UUID, 404, delete queue item; soft client id on relations.
- **Evidence:** B-F2  
- **Approach:** Promote to create or hold until pbId; use strict `resolveClientPbIdForSync` like invoices.  
- **Verify:** Offline create job → edit offline → online → one PB record  
- **Effort:** M  

### P0-8 — Drive token off public options; stop client backup metadata write-back
- **Problem:** Any authed user can read sealed/plain Drive refresh token via options; Options save overwrites `lastBackup*` / schedule gate fields.
- **Evidence:** E-01, E-02  
- **Approach:** Admin-only secret storage; strip server fields from `optionsStore.syncToPB`.  
- **Verify:** Crew cannot read token field; Options save does not clobber last backup status  
- **Effort:** M + S  

### P0-9 — Invoice tax + stale email money bugs
- **Problem:** UI tax fallback 8% vs engine 5%; Send allowed when `docxStale` with live total vs old file.
- **Evidence:** D-F1, D-F3  
- **Approach:** Single `DEFAULT_TAX_RATE_PERCENT = 5`; disable Send when stale (or force regen); prefer stored `invoice.amount` in email body.  
- **Verify:** Options unloaded → consistent 5%; stale banner blocks Send  
- **Effort:** S  

### P0-10 — Crew fail-open + email APIs any-recipient
- **Problem:** Empty crew display name → all jobs visible; job-assignment/invoice-send accept any email for any authed user.
- **Evidence:** C-F1, F-F2, D-F17, G-F7  
- **Approach:** Fail-closed crew filter; server-side bind send to real job/invoice + role checks.  
- **Verify:** Crew without name sees empty + prompt; crew cannot send to arbitrary email  
- **Effort:** S–M  

---

## P1 — Structure & product consistency

### P1-1 — Delete dead duals
- Delete unused: `JobInvoicePanel.svelte`, `Calendar.svelte`, `ForcePhotoUpdateModal.svelte`  
- **Evidence:** C, D, A, H  
- **Effort:** S — **best first maintainability PR**

### P1-2 — Unify complete/cancel job policy
- Shared `canCompleteJob` / `completeJob` used by form + details  
- **Evidence:** C-F2  
- **Effort:** M  

### P1-3 — Desktop idle → real session expiry
- Wire dead `expireSessionToLogin` when quick-unlock unavailable  
- **Evidence:** A-F4  
- **Effort:** S  

### P1-4 — LWW `timestampMs` for clients + invoices
- **Evidence:** B-F3, G-F10  
- **Effort:** S  

### P1-5 — Single crew notification writer
- Prefer cron-only **or** fix mark-sent + CAS log; no double-send  
- **Evidence:** F-F3/F4  
- **Effort:** M  

### P1-6 — Invoice write-back product alignment
- Stop auto write-back **or** document + confirm UI per spec  
- **Evidence:** D-F2  
- **Effort:** M  

### P1-7 — Extract sync invoice FormData builders / queue handlers
- Collapse 4 copy-paste invoice push paths in `runProcessSyncQueue`  
- **Evidence:** B-F6/F9, H  
- **Effort:** L  

### P1-8 — Split god files (behavior-preserving)
1. Options page → tab components (Backups first)  
2. SplitCalendar → jobs store + gestures + CSS  
3. `db/index.ts` → schema / CRUD / sync packages  
- **Evidence:** E-08, C, H, B-F4  
- **Effort:** L each  

### P1-9 — assignedCrew identity
- Short-term: one `resolveCrewLabel` + trim everywhere  
- Medium: store user ids not display names  
- **Evidence:** C-F3, F-F13  
- **Effort:** M / L  

---

## P2 — Consistency, tests, docs

| ID | Item | Effort |
|----|------|--------|
| P2-1 | Retire legacy `User.pinHash` / dual `persistSessionUserId` | M |
| P2-2 | Snapshot tax rate on invoice; recompute in docx generator | S–M |
| P2-3 | Offline warm routes: `/calendar/split`, `/profile` | S |
| P2-4 | README / TESTING_PLAN / CI (add check + e2e smoke optional) | S |
| P2-5 | Tests: authEpoch restore, invoice empty pull, logout flush order, tax fallback | M |
| P2-6 | Cap backup sync-queue body; backup schedule catch-up window | S |
| P2-7 | Fix email-change UI (“new” vs actual current inbox) | S |
| P2-8 | Escape HTML in Brevo templates | S |

---

## P3 — Polish

- Remove emoji console noise or gate DEV  
- Convert remaining `onMount` / `createEventDispatcher` (MonthPicker, Toast, QuickUnlock)  
- Drop unused deps (`adapter-auto` if node-only, etc.)  
- Unbounded `crewNotificationLog` pruning  

---

## Suggested verification commands (after any cleanup PR)

```powershell
pnpm check
pnpm lint
pnpm test
# optional:
pnpm test:e2e
```

Manual: offline create → edit → online sync; logout with pending queue; restore + second device epoch; crew login cannot open admin/API elevated routes.

---

## Explicit non-goals for first cleanup wave

- Bulk import “apply” implementation  
- Full rewrite of offline conflict model (vector clocks)  
- Feature expansion while P0 open  

---

## Pick next

Reply with which P0/P1 IDs to implement first (e.g. `P0-1, P0-2, P0-6, P1-1`) and we execute those only.
