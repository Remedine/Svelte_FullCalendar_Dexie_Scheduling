# Agent F: Platform, PWA, notifications, clients/crew

**Commit:** `64e9233`  
**Date:** 2026-07-16  
**Scope:** PWA / offline, Vite+Svelte+package config, notifications + cron + Brevo, crew/profile, styles/theme/toast, CI + Playwright/Vitest, app layout nav, README vs reality  
**Mode:** Read-only review

---

## Findings

### F1 — Unauthenticated email / account APIs are open proxies

| Field | Value |
|--------|--------|
| **Severity** | Critical |
| **File:line** | `src/routes/api/auth/send-welcome/+server.ts:6–38`; `src/routes/api/auth/request-email-change/+server.ts:6–37`; `src/routes/api/auth/request-verification/+server.ts:6–38`; `src/routes/api/auth/request-password-reset/+server.ts:6–38` |
| **Theme** | API RBAC / abuse |
| **Description** | These SvelteKit routes accept unauthenticated POSTs, call PocketBase with `INTERNAL_SECRET`, and send real Brevo emails. `send-welcome` can trigger password-reset-style welcome links for any email; `request-email-change` can initiate email-change for any known address; verification/reset are open mailers. |
| **Why** | Any internet client that can reach the app origin can burn Brevo quota, harass inboxes, and (depending on PB internal behavior) drive account-lifecycle flows without holding a user session. Password-reset correctly hides existence on PB failure, but still sends when PB succeeds—and still has no rate limit. |
| **Fix** | Require admin auth for `send-welcome`; require valid user session matching `email` (or PB-owned flow) for email-change/verification; keep forgot-password public but add rate limiting / CAPTCHA / IP throttling; never expose INTERNAL_SECRET-backed side effects without auth or strict abuse controls. |
| **Effort** | M |

---

### F2 — Job-assignment and invoice email APIs: any authed user → any recipient

| Field | Value |
|--------|--------|
| **Severity** | High |
| **File:line** | `src/routes/api/notifications/job-assignment/+server.ts:5–45`; `src/routes/api/invoices/send-email/+server.ts:5–44` |
| **Theme** | API RBAC / email correctness |
| **Description** | Both endpoints only call a local `assertAuthenticated` (auth-refresh OK). They do not check admin role, do not bind the payload to a real job/invoice the caller may access, and accept arbitrary `email` / `clientEmail` + free-form HTML-bound fields. |
| **Why** | A compromised or malicious crew session can spam arbitrary addresses through Brevo and inject content into transactional emails. |
| **Fix** | Reuse `assertAdminFromAuthHeader` / `getUserFromAuthHeader`; resolve job/client server-side from IDs; for crew assignment prefer server cron only; for invoices verify preferred billing + client record ownership. |
| **Effort** | M |

---

### F3 — `mark-sent` is admin-only while in-app poller runs for all roles

| Field | Value |
|--------|--------|
| **Severity** | High |
| **File:line** | `src/routes/api/admin/crew-notifications/mark-sent/+server.ts:6–10`; `src/lib/notifications/crewAssignment.ts:145–159`; `src/routes/(app)/+layout.svelte:92–111` |
| **Theme** | Email/notify correctness / double-send |
| **Description** | Layout ticks `processScheduledCrewNotifications` for **any** logged-in user every 5 minutes. On success it POSTs `mark-sent` (admin-gated) then deletes the local Dexie queue row **regardless of mark-sent status**. |
| **Why** | If only a crew device is online during the Alaska send hour, email can send, local queue clears, server `crewNotificationLog` is not updated (403), and the **server cron** may send the same assignment again. |
| **Fix** | Allow mark-sent for any authenticated user (or service-style endpoint with INTERNAL_SECRET only); **or** drop client-side sending entirely and rely solely on cron; only delete local queue after confirmed log append. |
| **Effort** | S–M |

---

### F4 — Dual send paths (Dexie poller + Railway cron) race without strong single-writer

| Field | Value |
|--------|--------|
| **Severity** | High |
| **File:line** | `src/lib/notifications/crewAssignment.ts:111–163`; `src/routes/api/cron/process-crew-notifications/+server.ts:75–167` |
| **Theme** | Email/notify correctness |
| **Description** | Two independent senders share `Options.crewNotificationLog` for dedup. Client path: send → mark-sent → delete local. Cron path: send → patch log. Concurrent ticks in the same Alaska hour can both pass `crewLogHas` / `log.has` before either persists. |
| **Why** | Duplicate crew assignment emails under load or multi-tab admin sessions. Cron also continues and returns 200 even if `patchOptionsRecord` fails after sends (`153–156`). |
| **Fix** | Prefer **one** authoritative path (cron). If dual path kept: optimistic lock / compare-and-swap on log, or mark log **before** send (with tombstone/retry on send failure). Fail closed if log persist fails. |
| **Effort** | M |

---

### F5 — Email-change confirmation goes to **current** email; UI claims **new** address

| Field | Value |
|--------|--------|
| **Severity** | High |
| **File:line** | `src/routes/api/auth/request-email-change/+server.ts:31`; `src/routes/(app)/profile/+page.svelte:496–498` |
| **Theme** | Email/notify correctness |
| **Description** | API calls `sendEmailChangeConfirmation(email, link)` where `email` is the **current** address. Profile success copy: “A confirmation link has been sent to the **new** address.” |
| **Why** | User checks the wrong inbox; confirmation never seen; email never updates. If PB token is meant for new-inbox proof-of-control, sending to the old address is the wrong security model. |
| **Fix** | Align with product: typically send confirmation to `newEmail` (and optional notice to old). Fix UI string to match actual destination. Check `fetch` `res.ok` on client (see F12). |
| **Effort** | S |

---

### F6 — Offline core routes incomplete vs real app surfaces

| Field | Value |
|--------|--------|
| **Severity** | Medium |
| **File:line** | `src/lib/pwa/offlineCoreRoutes.ts:2–5`; `vite.config.ts:54–74`; `src/lib/pwa/warmOfflineRoutes.ts:12–27`; `tests/e2e/offline-pages.spec.ts:7` |
| **Theme** | Offline coverage |
| **Description** | `OFFLINE_CORE_ROUTES = ['/calendar', '/jobs', '/clients', '/login']`. Exact pathname match only—so `/calendar/split` and `/profile` are **not** NetworkFirst-cached as HTML warm targets. Admin routes (`/admin/crew`, `/admin/options`) and profile (crew-critical) are excluded. `navigateFallback: null` means never-visited routes fail hard offline. |
| **Why** | Crew offline field use needs Schedule + My Jobs + Profile; split calendar is the real scheduling UI. Clients warm helps admins only. Hard-refresh offline only works if SW already has that document. |
| **Fix** | Expand core list (`/calendar/split`, `/profile`; optionally admin). Consider path prefix matching for `/calendar/*`. Document that first online visit (or warm) is required. Align offline E2E with the same list. |
| **Effort** | S–M |

---

### F7 — HTML injection into Brevo templates (unescaped user/client fields)

| Field | Value |
|--------|--------|
| **Severity** | Medium |
| **File:line** | `src/lib/server/brevo.ts:199–218`, `242–254`, `278–280` |
| **Theme** | Email correctness / security |
| **Description** | `clientName`, `address`, `phone`, `jobTitle`, backup `error` strings are interpolated into HTML with no escaping. |
| **Why** | Malicious client name / notes can alter email HTML, phishing links, or break layout. Combined with F2 this is stronger. |
| **Fix** | Add `escapeHtml()` for all dynamic fields; prefer text alternatives for error dumps. |
| **Effort** | S |

---

### F8 — Cron auth is correct; secret absence fails closed

| Field | Value |
|--------|--------|
| **Severity** | Info (positive) / Low residual |
| **File:line** | `src/routes/api/cron/process-crew-notifications/+server.ts:78–81`; `src/routes/api/cron/run-backup/+server.ts:8–11` |
| **Theme** | Cron auth |
| **Description** | Both cron routes require `X-Internal-Secret === INTERNAL_SECRET` and reject if secret unset (`!INTERNAL_SECRET \|\| secret !== …` → 403). Good. Residual: constant-time compare not used (low practical risk); no GET handler / health distinct from secret. |
| **Why** | Misconfigured Railway cron without secret fails closed—good. |
| **Fix** | Optional: `crypto.timingSafeEqual` for secret compare; document required Railway cron headers in README. |
| **Effort** | S |

---

### F9 — Layout RBAC vs comments / nav inconsistency

| Field | Value |
|--------|--------|
| **Severity** | Low–Medium |
| **File:line** | `src/routes/(app)/+layout.svelte:114–137`, `171–173` |
| **Theme** | Dead routes / nav / RBAC |
| **Description** | Comment still says “crew can only use `/calendar`”; guard allows `/calendar*`, `/jobs`, `/profile`. Desktop nav hides Clients/Crew/Options for crew; mobile bottom nav matches. `/admin/import` is a redirect stub (not linked)—OK legacy. Crew can still deep-link `/clients` until client guard redirects—layout will bounce non-admin away. |
| **Why** | Stale comments mislead maintainers; generally nav/guard are aligned for crew vs admin. |
| **Fix** | Fix comments; ensure `/clients` page has its own server/client guard if not already. |
| **Effort** | S |

---

### F10 — Styling / theme leftovers: dual dark systems + legacy Toast lifecycle

| Field | Value |
|--------|--------|
| **Severity** | Medium |
| **File:line** | `src/lib/stores/theme.svelte.ts:41–46`; `src/lib/styles/globals.css:105–178`; `src/lib/components/Toast.svelte:1–8` |
| **Theme** | Styling inconsistency / multi-model leftovers |
| **Description** | Dark theme always adds both `dark` and experimental `test-apple-dark`, so Apple HIG tokens override the “baseline” dark tokens—two competing design systems permanently stacked. `Toast.svelte` still uses Svelte 3/4 `onMount` (violates AGENTS.md runes-only). Profile/layout mostly BEM + tokens; some pages keep raw hex fallbacks. |
| **Why** | Unclear which palette is product truth; a11y/contrast drift; Toast is a Svelte 5 compliance outlier. |
| **Fix** | Choose one dark token set; remove `test-apple-dark` or gate behind debug. Convert Toast to `$effect`. |
| **Effort** | S |

---

### F11 — README and TESTING_PLAN drift from reality

| Field | Value |
|--------|--------|
| **Severity** | Medium |
| **File:line** | `readme.md:107–110`; `docs/TESTING_PLAN.md:9–13`; `railway.toml:25–28` vs `.env.example` |
| **Theme** | README vs reality |
| **Description** | README still says re-enable PWA icons in `vite.config.ts`—icons + `includeAssets` are already live. README under-documents `PUBLIC_PB_URL`, `INTERNAL_SECRET`, Brevo, cron, Google Drive, `BODY_SIZE_LIMIT`. TESTING_PLAN still claims “Zero tests” and missing Vitest/Playwright—repo has many unit tests, e2e specs, offline config. |
| **Why** | Onboarding and ops will follow wrong steps; false confidence or false panic. |
| **Fix** | Refresh README (env matrix, cron, PWA status, scripts). Update TESTING_PLAN current state section. |
| **Effort** | S |

---

### F12 — Profile email change ignores HTTP errors and mutates local state optimistically

| Field | Value |
|--------|--------|
| **Severity** | Medium |
| **File:line** | `src/routes/(app)/profile/+page.svelte:448–499`, `564–570` |
| **Theme** | Email/notify correctness |
| **Description** | `await fetch(...)` without `if (!res.ok) throw`; non-network failures (4xx/5xx) still update Dexie email + show success / pending pill. |
| **Why** | Local profile email diverges from PB; crew identity for assignment matching can desync. |
| **Fix** | Check `res.ok` + parse JSON error; only update local on success. |
| **Effort** | S |

---

### F13 — Crew assignment matched by exact display name string

| Field | Value |
|--------|--------|
| **Severity** | Medium |
| **File:line** | `src/lib/notifications/crewAssignment.ts:19–25`; `src/routes/api/cron/process-crew-notifications/+server.ts:62–72` |
| **Theme** | Email/notify correctness |
| **Description** | Job `assignedCrew[]` names must **exactly** equal `user.name` or `firstName + ' ' + lastName`. Rename, extra spaces, or name vs first/last drift → silent no-email (`if (!email) continue`). |
| **Why** | Silent notification loss; hard to debug in field. |
| **Fix** | Prefer stable user id on jobs; or normalize names; log skipped crew without email. |
| **Effort** | M |

---

### F14 — Unused / misplaced dependencies & config smells

| Field | Value |
|--------|--------|
| **Severity** | Low |
| **File:line** | `package.json:41`, `76`; `vitest.config.ts:18–30` |
| **Theme** | Unused deps |
| **Description** | `@sveltejs/adapter-auto` unused (adapter-node is live). `playwright` is a **runtime** dependency while only `@playwright/test` is needed for e2e. `vitest.config.ts` declares `deps` twice (second overwrites first—confusing). |
| **Why** | Larger install surface; CI noise; accidental prod bloat. |
| **Fix** | Drop adapter-auto; move playwright to devDeps or remove if only `@playwright/test`; merge vitest `deps`. |
| **Effort** | S |

---

### F15 — CI runs unit tests only; offline/e2e/check not gated

| Field | Value |
|--------|--------|
| **Severity** | Medium |
| **File:line** | `.github/workflows/test.yml:16–19`; `playwright.config.ts`; `playwright.offline.config.ts` |
| **Theme** | Test gaps |
| **Description** | CI: `pnpm install` + `pnpm test`. Commented: Playwright. No `pnpm check`, lint, or `test:e2e:offline`. Offline suite can `test.skip` when SW controller missing. |
| **Why** | Regressions in SW, cron auth, email RBAC, login shell can merge green. |
| **Fix** | Add `pnpm check` + install browsers + e2e smoke; optional offline job on main. |
| **Effort** | M |

---

### F16 — Dead / deprecated notification surface area

| Field | Value |
|--------|--------|
| **Severity** | Low |
| **File:line** | `src/lib/server/brevo.ts:294–310` (`sendInvoiceSentEmail`); `src/lib/notifications/crewAssignment.ts:166–173`; `src/lib/notifications/crewSchedule.ts:69–86` |
| **Theme** | Dead code |
| **Description** | `sendInvoiceSentEmail` appears unused. Deprecated `notifyNewCrewAssignments`, `computeCrewNotificationSendAt`, `isCrewNotificationDue` still exported; client still writes `scheduledFor` but send decision uses `shouldSendCrewNotification`. |
| **Why** | Confusion about which path is real; false sense of scheduling precision. |
| **Fix** | Delete unused email helper; collapse deprecated APIs or document single source of truth. |
| **Effort** | S |

---

### F17 — Brevo every-send outbound IP probe

| Field | Value |
|--------|--------|
| **Severity** | Low |
| **File:line** | `src/lib/server/brevo.ts:40–51`, `61–62` |
| **Theme** | Platform reliability |
| **Description** | Every email calls `api.ipify.org` for logging (Railway/Brevo IP allowlist debugging). |
| **Why** | Extra latency, third-party dependency, failure modes if ipify is slow (best-effort, but still delays send). |
| **Fix** | Cache IP for process lifetime; sample once per deploy; disable in production once static IPs settled. |
| **Effort** | S |

---

### F18 — `crewNotificationLog` unbounded growth on Options JSON

| Field | Value |
|--------|--------|
| **Severity** | Low–Medium |
| **File:line** | `pb_migrations/1782700000_updated_options_crew_notification_log.js`; `src/lib/server/crewNotificationLog.ts:4–13` |
| **Theme** | Platform / notify correctness |
| **Description** | Log is an ever-growing string array (field maxSize 2MB). No pruning of old job keys. |
| **Why** | Options payload bloat for every client that loads options; eventual patch failures. |
| **Fix** | Prune keys for jobs past retention window; or store sent flags on job records. |
| **Effort** | M |

---

## Test gap map (critical untested paths)

| Path / behavior | Current coverage | Risk if broken |
|-----------------|------------------|----------------|
| Cron `X-Internal-Secret` accept/reject | None | Open backup/notify or silent skip |
| Cron crew send + log persist / failure | Schedule unit tests only (`crewSchedule.test.ts`) | Double/miss emails |
| Client poller + mark-sent admin 403 | None | Double emails (F3) |
| `POST /api/notifications/job-assignment` RBAC | None | Spam / abuse |
| `POST /api/invoices/send-email` RBAC + attachment limits | None | Abuse / DoS |
| Unauthed auth email routes | Forgot-password happy path in e2e only | Open mailer |
| Email-change to correct inbox + profile `res.ok` | None | Stuck profiles |
| SW install + offline for `/calendar/split`, `/profile` | Offline e2e: calendar/jobs/clients only; flaky SW skip | Field offline fail |
| `warmOfflineRouteCache` after login | None | Cold offline shell |
| Brevo HTML escape | None | Email HTML injection |
| Layout crew nav RBAC (deep links) | None | Data exposure if guard regresses |
| Toast restore countdown / theme class on `<html>` | Toast unit/store tests partial | UX regressions |
| CI: no e2e / check / offline | Unit only | Ship regressions |

**Existing good coverage (platform-adjacent):** `offlineCoreRoutes.test.ts`, `crewSchedule.test.ts` (hour window), toast store tests, many pure utils—but not the HTTP edges that matter for abuse and delivery.

---

## Multi-model fingerprints

Patterns consistent with multi-agent / multi-session AI authorship rather than a single house style:

1. **Signature comment marker `)= -` / `)= -`** littered across layouts, vite, profile, calendar, tests (“`// )=- …`”). Looks like a repeated agent preface token.
2. **Boilerplate “Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling”** (and TESTING_PLAN / JOBS_AND_INVOICES_SPEC) pasted into many files—including unrelated ones.
3. **Verbose narrative comments** that restate code history (“PIN login removed”, “Phase 5”, “Rolldown Unexpected token…”) instead of stable design notes.
4. **Svelte era mix:** runes-first project (`$state` / `$effect`) but `Toast.svelte` still `onMount`; script without `lang="ts"`.
5. **Competing design experiments left on:** `test-apple-dark` stacked on production dark theme.
6. **Duplicate / conflicting docs:** TESTING_PLAN “zero tests” vs full Vitest suite; README PWA icon instructions vs live icons.
7. **Duplicate config keys** (`vitest.config.ts` `deps` twice)—classic partial-merge artifact.
8. **Dead dual APIs** (deprecated notify helpers + live cron + live poller) without a single design owner comment that matches behavior.
9. **Inline HTML email templates** with marketing credit line and external Wix CDN logo—ops/debug comments for Railway/Brevo denser than production hardening.
10. **Comment vs code drift** in layout (crew-only calendar vs actual jobs/profile access).

These are maintainability/signal issues; highest product risk is still the RBAC and dual-send findings above.

---

## Top 5 cleanup actions

1. **Lock down email-related API routes** — auth + role + rate limits on welcome / email-change / verification; admin or server-only for assignment & invoice send; never free-form arbitrary recipients (F1, F2).
2. **Single-writer crew notifications** — prefer Railway cron only; fix mark-sent auth **or** remove client poller; only drop queue after durable log write (F3, F4).
3. **Fix email-change destination + client `res.ok`** — send to new address (or update copy) and stop optimistic local success (F5, F12).
4. **Offline route set for real field UX** — include `/calendar/split` + `/profile`; align warm + workbox + offline e2e (F6).
5. **CI + docs hygiene** — run `check` + e2e smoke; drop unused deps; resolve dark tokens; rewrite README/TESTING_PLAN current state (F10, F11, F14, F15).

---

## README vs reality (summary)

| Claim | Reality at 64e9233 |
|--------|---------------------|
| Fully offline-capable PWA | Partial: core HTML NetworkFirst + warm for 4 paths; no offline API; split/profile/admin gaps |
| Re-enable icons in vite | Already configured with 192/512 + maskable |
| Self-host: mainly `PUBLIC_POCKETBASE_URL` | Also needs `PUBLIC_PB_URL`, `INTERNAL_SECRET`, Brevo, cron secrets, optional Drive/OAuth, `BODY_SIZE_LIMIT` |
| adapter-node self-host | Correct (`svelte.config.js`) |
| “Fully client-side SSR disabled” | Correct (`+layout.server.ts` `ssr=false`) |
| TESTING_PLAN zero tests | Outdated—unit + limited e2e exist; CI only unit |

---

## Final

**Writeup path:** `docs/reviews/2026-07-16-multi-agent/agents/F-platform.md`

### Top 3

1. **Open / weak email APIs (F1–F2)** — unauthenticated or any-user endpoints can drive Brevo and account flows; highest external abuse risk.  
2. **Crew notify double-send architecture (F3–F4)** — client poller + admin-only mark-sent + cron share a soft log; duplicates and missed dedup under real multi-device use.  
3. **Offline + docs/CI incomplete (F6, F11, F15)** — field offline routes under-specified; green CI without e2e/check; README/TESTING_PLAN mislead operators and agents.
