# Agent G: Correctness & security

**Commit:** `64e9233`  
**Lens:** Bugs, data loss, authz/authn holes, unsafe restore/sync, secret leakage, race conditions, offline edge cases, API trust boundaries.  
**Severity filter:** critical / high / medium only.

## Summary

The app’s local-first Dexie + PocketBase design is solid for offline CRM use, and most **admin** backup/API routes correctly re-check `role === 'admin'` via auth-refresh. The serious problems cluster around **unauthenticated SvelteKit “elevated” auth helpers that proxy `INTERNAL_SECRET`**, **PocketBase collection rules that over-expose clients/users and over-authorize crew job updates**, **logout that cannot actually flush the sync queue (token cleared first)**, and **post-restore epoch handling that can fail silently**. Several issues can lose money (job/invoice mutation, queue wipe) or leak customer/crew PII without needing admin credentials.

Independent judgment only — other agent reports under `docs/reviews` were not read.

## Findings

### F1 — Severity: critical
- **File:** `src/routes/api/auth/mark-verified/+server.ts:5-77`
- **Theme:** security / authn hole
- **Description:** `POST /api/auth/mark-verified` accepts `{ pbId, email }` with **no Authorization check**. It uses `X-Internal-Secret` / `INTERNAL_SECRET` to PATCH any users record `verified: true`.
- **Why it matters:** Any anonymous caller who can reach the app can mark any account verified (or spam internal PB updates). Combined with temp passwords / welcome flows, this undermines onboarding gates. The endpoint is explicitly designed as an elevated privilege path and is exposed on the public app origin.
- **Suggested fix:** Require a valid admin JWT (`assertAdminFromAuthHeader`) **or** a short-lived HMAC token minted only after authenticated admin create / after password confirm. Never expose `INTERNAL_SECRET` behavior without app-level auth. Rate-limit and audit-log.
- **Effort:** S (½–1 day)
- **Confidence:** high
- **Would block a cleanup PR?** yes

### F2 — Severity: critical
- **File:** `src/routes/api/auth/send-welcome/+server.ts:6-38`
- **Theme:** security / abuse
- **Description:** `POST /api/auth/send-welcome` is unauthenticated. It calls PB internal `request-password-reset` with `INTERNAL_SECRET` and emails a reset/welcome link via Brevo for any supplied email.
- **Why it matters:** Account-takeover-adjacent: attacker can trigger password-reset links for any known crew/admin email (inbox spam, link fishing, Brevo cost/abuse). Same internal secret power as admin tooling without being an admin.
- **Suggested fix:** Require admin auth. Optionally allow self-service only via the existing password-reset path with uniform success responses and strict rate limits. Do not return detailed Brevo errors to clients.
- **Effort:** S
- **Confidence:** high
- **Would block a cleanup PR?** yes

### F3 — Severity: high
- **File:** `src/routes/api/auth/request-email-change/+server.ts:6-37`
- **Theme:** security / authn hole
- **Description:** Unauthenticated body `{ email, newEmail }` triggers internal email-change token generation and sends mail. No proof the caller owns `email`.
- **Why it matters:** Email-change harassment / confusion for any known address; amplifies phishing if confirmation UX is weak. Not full account takeover by itself if link must be opened from current inbox, but still an unauthenticated privileged proxy.
- **Suggested fix:** Require authenticated session where `auth.email === email` (or admin). Rate-limit per IP/email.
- **Effort:** S
- **Confidence:** high
- **Would block a cleanup PR?** yes

### F4 — Severity: high
- **File:** `pb_migrations/1779352449_updated_users.js:10` (updateRule still in force; later migrations only changed list/create/delete variants) + `src/lib/db/index.ts:1642-1668`
- **Theme:** security / privilege escalation
- **Description:** Users `updateRule` is `@request.auth.role = "admin" || @request.auth.id = id`. The `role` field is a normal non-system select (`pb_migrations/1779352393_updated_users.js:15-28`) with **no field-level write restriction**. Any crew user can `PATCH` their own record `{ "role": "admin" }` via PocketBase API (or by queueing `updateUser` with `role` if they tamper with the client).
- **Why it matters:** Full privilege escalation: admin roster, backups restore, bulk, Google Drive disconnect, etc. App UI hides admin screens, but PB is the real enforcement boundary.
- **Suggested fix:** Tighten update rule, e.g. self may only change safe fields via API rules / hooks:  
  `@request.auth.id = id && @request.data.role:isset = false && @request.data.active:isset = false` (and similar for force flags), **or** admin-only for role/active. Add a PB hook that rejects non-admin role/active/verified mutations.
- **Effort:** M
- **Confidence:** high
- **Would block a cleanup PR?** yes

### F5 — Severity: high
- **File:** `pb_migrations/1781120207_updated_users.js:7` + `src/lib/db/pb.ts:716-720` (comment assumes admin-only list)
- **Theme:** security / data leak
- **Description:** Final users `listRule` is `@request.auth.id != ""` — **any authenticated user can list the full users collection** (emails, names, roles, flags, photos metadata).
- **Why it matters:** Crew devices can enumerate all staff emails and roles. Undermines least privilege and increases phishing surface. Code comments still claim roster pull is admin-gated client-side only.
- **Suggested fix:** Restore `listRule` to `@request.auth.role = "admin" || id = @request.auth.id`. Keep elevated roster only on `/api/admin/users-roster`.
- **Effort:** S
- **Confidence:** high
- **Would block a cleanup PR?** yes

### F6 — Severity: high
- **File:** `pb_migrations/1779352908_created_clients.js:184` + `src/lib/db/pb.ts:550-626`
- **Theme:** security / data leak
- **Description:** Clients `listRule` is `@request.auth.role != ""` (any logged-in user). `pullClientsFromServer` downloads the **entire** client roster into Dexie for every authenticated session.
- **Why it matters:** Crew offline DB holds full CRM PII (names, phones, emails, service/billing addresses, notes). UI route guards hide `/clients`, but IndexedDB and PB API remain readable. High-impact leak on lost phone or malicious crew.
- **Suggested fix:** Scope client list/view to admin, **or** to clients linked to jobs assigned to the crew member (relation filter). Stop full client pull for non-admin roles; pull only needed client rows for assigned jobs.
- **Effort:** M–L
- **Confidence:** high
- **Would block a cleanup PR?** yes

### F7 — Severity: high
- **File:** `pb_migrations/1779353392_created_jobs.js:279-284` + `src/lib/calendar/SplitCalendar.svelte:1310-1564` + `src/lib/components/JobFormModal.svelte:295-320` + `src/lib/db/index.ts:641-810`
- **Theme:** security / authz hole / money risk
- **Description:** Jobs `updateRule` allows any assigned crew member to update the **entire** job record (`assignedCrew ~ @request.auth.name`). There is no field-level restriction. UI:
  - SplitCalendar sets `editable: true` for everyone and calls `updateJobDates` on drop/resize with **no role check**.
  - `JobFormModal` has **zero** `isAdmin` / role guards on create/update/cancel.
  - Crew can open full edit (billable items, crew reassignment, notes, status) for assigned jobs.
- **Why it matters:** Crew can change prices, schedules, assignments, cancel/reschedule, and push those changes to PB — financial and operational integrity risk. Create is admin-only on PB, but assigned-job updates are fully open.
- **Suggested fix:** PB: admin-only update **or** crew update limited to status/notes (hooks/`@request.data` field locks). UI: `editable: auth.currentUser?.role === 'admin'`, block `openJobModal` mutations for crew, read-only details for crew.
- **Effort:** M
- **Confidence:** high
- **Would block a cleanup PR?** yes

### F8 — Severity: high
- **File:** `src/lib/stores/auth.svelte.ts:310-346` + `src/lib/db/index.ts:1873-1910`
- **Theme:** data-loss
- **Description:** `logout()` clears `pb.authStore` **before** calling `processSyncQueue()`. Queue processing uses the PB client auth token for create/update/delete. With the token already cleared, flush almost always fails; logout then **wipes IndexedDB** (including remaining queue items), after only logging a warning if count > 0.
- **Why it matters:** Offline job/invoice/client edits made before logout are destroyed and never reach the server. Direct money/ops data loss. The code comment claims a best-effort flush that cannot succeed in the current order.
- **Suggested fix:** Flush queue **while token is still valid**, then clear auth, then wipe. If flush fails, **block** logout (or export queue blob) when pending > 0 unless user explicitly confirms data loss. For post-restore epoch logout, use a dedicated path that **discards** queue without push (see F9).
- **Effort:** S–M
- **Confidence:** high
- **Would block a cleanup PR?** yes

### F9 — Severity: high
- **File:** `src/lib/auth/authEpoch.ts:35-56` + `src/lib/server/backups.ts:370-391` + `src/routes/api/admin/backups/restore/+server.ts:38-42`
- **Theme:** data-loss / unsafe restore
- **Description:**  
  1. Restore fires `void finalizeRestoreAfterPbRestart()` (async, not awaited by client). If PB never becomes healthy or `bumpAuthEpoch` fails, clients are **not** force-logged-out.  
  2. Epoch check is skipped when offline (`navigator.onLine` false). Offline devices keep pre-restore local data.  
  3. Force logout reuses normal `logout()`, which is written to flush queue first (broken today — F8; dangerous if F8 is fixed without an epoch-specific discard flag).
- **Why it matters:** After restore, divergent offline devices can reintroduce post-backup mutations into a rolled-back database (especially with LWW `updatedAt` — F10), undoing restore or corrupting finances/schedule.
- **Suggested fix:** Await/health-gate epoch bump; surface restore incomplete if bump fails. On epoch mismatch: **discard local queue**, do not push. Persist a “restored_at / min epoch” server marker; refuse outbound sync until local epoch matches. Consider invalidating PB tokens server-side on restore.
- **Effort:** M
- **Confidence:** high
- **Would block a cleanup PR?** yes

### F10 — Severity: high
- **File:** `src/lib/db/pb.ts:446-483`, `602-604`, `688-691`
- **Theme:** data-loss / race / offline edge case
- **Description:** Pull merge is last-write-wins by comparing local vs server `updatedAt`. If local clock is ahead, or local offline edits carry a newer timestamp, **server truth is skipped forever** until local is rewritten. Pull-then-queue ordering in `syncAppDataFromServer` can also apply server state then immediately push older-but-still-queued local patches.
- **Why it matters:** Silent loss of admin desktop edits when a phone has a skewed clock or stale offline edits. Multi-device CRM without vector clocks / server-authoritative fields.
- **Suggested fix:** Prefer server for conflict when online after reconnect (or field-level merge). Use server timestamps only on apply. On 409/version mismatch, re-pull. Do not skip server records solely because local Date is newer without a pending queue item for that record.
- **Effort:** M–L
- **Confidence:** medium–high
- **Would block a cleanup PR?** no (but schedule soon)

### F11 — Severity: medium
- **File:** `src/routes/api/invoices/send-email/+server.ts:5-44` + `src/routes/api/notifications/job-assignment/+server.ts:5-45`
- **Theme:** security / abuse
- **Description:** Both endpoints only require any valid user token, not admin. Caller supplies arbitrary `clientEmail` / `email`, HTML-bound fields, and (invoice) arbitrary `docxBase64` attachment.
- **Why it matters:** Authenticated crew can use company Brevo quota as an open relay (spam, phishing with company From address, large attachments). Invoice email should be admin (or explicitly permitted role) and should load docx from PB server-side by invoice id.
- **Suggested fix:** Admin-only (or job-assignment only for assigned crew with server-built body). Server builds content from trusted PB records; never trust client HTML/base64 alone. Rate-limit.
- **Effort:** M
- **Confidence:** high
- **Would block a cleanup PR?** no

### F12 — Severity: medium
- **File:** `src/routes/api/auth/request-verification/+server.ts:6-38` + `src/routes/api/auth/request-password-reset/+server.ts:6-38`
- **Theme:** security / abuse
- **Description:** Password-reset is expected to be public; verification request is also public. Neither implements app-level rate limiting. Errors for verification can leak generation failures differently than password-reset (which always returns success on PB failure).
- **Why it matters:** Email bombing of crew addresses; cost and operational noise. Lower severity than F1–F2 because reset is a normal pattern, but still unprotected.
- **Suggested fix:** IP/email rate limits, CAPTCHA on login page, uniform responses.
- **Effort:** S–M
- **Confidence:** high
- **Would block a cleanup PR?** no

### F13 — Severity: medium
- **File:** `src/lib/stores/options.svelte.ts:100-189` + `pb_migrations/1782900000_unhide_google_drive_refresh_token.js:1-14` + `pb_migrations/1780477923_updated_options_rules.js:8-9`
- **Theme:** secret leakage / data exposure
- **Description:** Options `listRule`/`viewRule` allow any authenticated user. `backupGoogleDriveRefreshToken` was **unhidden** so internal backup code can read it (encrypted with `INTERNAL_SECRET`). Any crew session can still **read the sealed ciphertext** (and other backup metadata, `authEpoch`, alert emails, and potentially `syncQueueSnapshot` if present on the record) via PB API even though the Svelte store omits mapping the token.
- **Why it matters:** Defense-in-depth failure: secret material and backup operational metadata should not be world-readable inside the auth boundary. Ciphertext + future secret leak = Drive takeover.
- **Suggested fix:** Keep token field **hidden**; read only via superuser/internal PB routes. Split “public app options” from “server-only backup secrets” collections. Hide `syncQueueSnapshot` from non-admin.
- **Effort:** M
- **Confidence:** medium–high
- **Would block a cleanup PR?** no

### F14 — Severity: medium
- **File:** `src/lib/auth/deviceUnlock.ts:325-376` + `src/lib/auth/deviceUnlock.ts:120-136`
- **Theme:** security / offline edge case
- **Description:**  
  - Local WebAuthn unlock only checks that `navigator.credentials.get` returned an assertion; **signature is not verified** against a stored public key.  
  - PIN attempt counter lives in `sessionStorage` → refresh resets lockout.  
  - 4-digit PIN (`PIN_LENGTH = 4`) with 5 attempts per session is weak for offline CRM data on a stolen phone.
- **Why it matters:** Quick-unlock is a screen gate only; full Dexie DB (client PII, jobs, invoice metadata, sometimes PB JWT in `appSession`) remains in IndexedDB. Weak gate + JWT in IDB is high impact on device theft.
- **Suggested fix:** Document as UI lock not encryption. Prefer not persisting PB JWT longer than needed; encrypt IDB at rest if platform allows. Verify local assertion with stored pubkey; persist lockout with backoff in IndexedDB; encourage 6+ digit PIN.
- **Effort:** M
- **Confidence:** high
- **Would block a cleanup PR?** no

### F15 — Severity: medium
- **File:** `src/lib/auth/sessionPersist.ts:187-210` + `src/lib/stores/auth.svelte.ts:140-167`
- **Theme:** security / session
- **Description:** PB JWT is stored in Dexie `appSession` for iOS PWA survival. Session restore can mark user authenticated from local markers even when token refresh fails offline. Role is taken from local user / model JSON, not revalidated offline.
- **Why it matters:** Stolen device with unlocked browser profile yields full offline CRM + reusable JWT until expiry. After F4, a locally elevated role would also unlock admin UI offline until next online refresh.
- **Suggested fix:** Short JWT TTL; on online resume always `authRefresh` and force logout on failure; never trust local-only role for admin mutations (always re-check server before backup/restore APIs — already done for many admin routes).
- **Effort:** M
- **Confidence:** medium
- **Would block a cleanup PR?** no

### F16 — Severity: medium
- **File:** `src/lib/components/InvoiceEditor.svelte:51`, `425-434` + invoice PB rules `pb_migrations/1781125957_updated_invoices.js:7-9`
- **Theme:** bug / authz consistency
- **Description:** Invoice UI gates many actions with `isAdmin`, but workflow status transitions (`handleWorkflowStep` → `persistDraft`) are not clearly admin-only end-to-end. Invoice API rules use `id = @request.auth.id` (invoice id vs user id) which is almost never true — so effective PB access is admin-only for create/update **if** rules deployed as migrated. Client-side still allows confusing paths; crew with local Dexie invoice rows can edit offline-only state that never syncs or fails opaquely.
- **Why it matters:** Inconsistent authz causes support bugs; any future relaxation of invoice rules would immediately expose financial documents.
- **Suggested fix:** Explicit admin checks on all invoice mutate paths; fix PB rules to `@request.auth.role = "admin"` only (remove nonsensical `id = @request.auth.id`); deny crew invoice list/view if product intent is admin-only billing.
- **Effort:** S–M
- **Confidence:** medium
- **Would block a cleanup PR?** no

### F17 — Severity: medium
- **File:** `src/lib/components/NewUserModal.svelte:71-82` + `src/routes/api/auth/mark-verified/+server.ts:5`
- **Theme:** bug / correctness
- **Description:** After admin creates a user with `verified: false` locally, NewUserModal immediately calls unauthenticated `mark-verified`, setting **PB `verified: true` before the user sets a real password**. WelcomeModal also marks verified after password change. Server-side verified flag no longer tracks “completed onboarding.”
- **Why it matters:** Business logic for activation/onboarding is split and contradictory; security gates that trust PB `verified` are bypassed at create time.
- **Suggested fix:** Only mark verified after password confirm (WelcomeModal or PB password-reset hook already sets verified). Remove create-time mark-verified call.
- **Effort:** S
- **Confidence:** high
- **Would block a cleanup PR?** no

### F18 — Severity: medium
- **File:** `src/routes/(app)/+layout.svelte:120-138`
- **Theme:** security / authz
- **Description:** Crew route restriction is **client-only** `$effect` + `goto`. There is no `+layout.server.ts` / hooks enforcement for `/admin/*`. Admin API routes are server-checked (good); admin **pages** are still downloadable JS and rely on PB rules for data.
- **Why it matters:** UI bypass is trivial; real risk depends on PB rules (see F4–F7). Defense in depth missing for SSR/data loaders.
- **Suggested fix:** Server hooks or layout loads that 403 non-admins for `/admin`. Keep treating PB rules as source of truth.
- **Effort:** S
- **Confidence:** high
- **Would block a cleanup PR?** no

### F19 — Severity: medium
- **File:** `src/lib/server/pbAdmin.ts:3-17` + `src/lib/server/pbAuth.ts:3-26`
- **Theme:** security / API trust boundary
- **Description:** Admin/user identity for app APIs is established solely by forwarding `Authorization` to PocketBase `auth-refresh`. No audience/issuer binding, no app session cookie, no CSRF concern for pure bearer tokens (OK for header tokens) but **token theft = full admin API** including restore.
- **Why it matters:** Backup restore/download are correctly admin-gated, but a stolen admin JWT is catastrophic (restore, Drive, roster). No step-up auth for restore.
- **Suggested fix:** Require re-auth or confirm password for restore/upload; shorter admin token TTL; optional allowlist of admin user ids for destructive routes.
- **Effort:** M
- **Confidence:** medium
- **Would block a cleanup PR?** no

### F20 — Severity: medium
- **File:** `src/lib/calendar/SplitCalendar.svelte:1060-1066`
- **Theme:** bug / privacy
- **Description:** Crew calendar filters display with `crewScopedJobs`, but underlying `jobs` state is loaded via `getJobsForRange` from **local Dexie**, which may contain broader data if an admin previously used the device, or if rules/pull ever over-fetched. Only UI filters; no hard isolation of Dexie per role.
- **Why it matters:** Shared-device or role-change scenarios can leave residual jobs/clients visible via DevTools even when UI hides them. Logout wipe helps only on explicit logout (F8 may leave partial state if wipe fails).
- **Suggested fix:** On login as crew, purge non-assigned jobs/clients from Dexie after pull; never leave admin full dataset on a crew session.
- **Effort:** M
- **Confidence:** medium
- **Would block a cleanup PR?** no

## Top 10 ranked risks

1. **Unauthenticated `mark-verified` / `send-welcome` (F1, F2)** — public elevated PB admin power.
2. **Crew → admin privilege escalation via users updateRule + writable `role` (F4)**.
3. **Full client PII listable/pullable by any crew (F6)**.
4. **Crew full job mutation (schedule/pricing) via PB updateRule + editable calendar (F7)**.
5. **Logout wipes offline queue without successful sync (F8)** — pure data loss.
6. **Restore/epoch race: offline devices & failed epoch bump can re-pollute restored DB (F9)**.
7. **LWW `updatedAt` can drop server updates silently (F10)**.
8. **Users collection list open to all authenticated users (F5)** — staff email/role leak.
9. **Email APIs as authenticated open relay (F11)**.
10. **Options secrets/metadata readable by all auth users; sealed Drive token unhidden (F13)**.

## Recommended P0 fixes (ordered)

1. **Lock down unauthenticated auth APIs:** add admin (or session) auth to `mark-verified`, `send-welcome`, `request-email-change`; rate-limit public reset/verification. *(F1–F3, F12)*
2. **Hardening PocketBase users rules:** prevent self-service `role`/`active`/`verified` writes; restore admin-scoped listRule. *(F4, F5)*
3. **Scope clients + job updates:** clients not world-listable to crew; job updates admin-only or field-limited; calendar/JobFormModal non-editable for crew. *(F6, F7)*
4. **Fix logout/sync order:** flush queue with valid token; refuse destructive wipe when pending fails; separate “epoch force logout” that discards queue. *(F8, F9)*
5. **Make restore finalization reliable:** await health + epoch bump; fail restore UX if bump fails; block outbound sync until epoch matches. *(F9)*
6. **Conflict policy:** don’t skip server rows on local clock skew without pending queue; consider server-authoritative pull on resume. *(F10)*
7. **Email endpoints:** admin-only / server-built payloads; rate limits. *(F11)*
8. **Hide backup secrets** from options list/view for non-superuser; keep tokens internal-only. *(F13)*

---

*Reviewer: Agent G (correctness & security). Scope: full app with priority on auth, db, API, server, InvoiceEditor, backups/restore, SplitCalendar.*
