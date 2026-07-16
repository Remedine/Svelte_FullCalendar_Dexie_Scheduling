# Agent A: Auth & session

## Scope

- `src/lib/auth/**` (authEpoch, deviceUnlock, passkeys, sessionPersist, sessionSecurity + tests)
- `src/lib/stores/auth.svelte.ts`, `src/lib/stores/auth.test.ts`
- `src/routes/login/**`
- `src/routes/api/auth/**`
- `src/lib/server/webauthn.ts`, `src/lib/server/pbAuth.ts`
- Auth guards / logout / session in `src/routes/(app)/+layout.svelte`
- Related: `QuickUnlock.svelte`, `ForcePhotoUpdate*.svelte`, `WelcomeModal.svelte`, `NewUserModal.svelte`, `userSync` / `pb` login merge paths

## Summary

Auth is a multi-layer stack (PocketBase JWT, durable Dexie `appSession`, localStorage markers, device quick-unlock PIN/biometric, server passkeys, and post-restore `authEpoch`) that clearly evolved across several implementations. The intended model is clean: **PB email/password (or server WebAuthn) for real auth**, device PIN/bio only as a local gate, force-photo as onboarding. Several merge residues undermine that: unauthenticated privileged API routes, an `authEpoch` check that no-ops during cold restore (exactly when backup restore needs it), desktop idle “security” that never expires sessions without quick-unlock, and create-user code that marks PB `verified:true` immediately while the UI still assumes a first-login password gate. Local biometric unlock stores only a credential id and accepts any successful `credentials.get` without signature verification. Cleanup should prefer consolidating on the PB + `sessionPersist` + `deviceAuth` path and locking down server routes.

## Findings

### F1 — Severity: critical
- File: `src/lib/auth/authEpoch.ts:35-56`, called from `src/lib/stores/auth.svelte.ts:159-166`
- Theme: bug | security | data-loss
- Description: `checkAuthEpochAndForceLogoutIfNeeded()` only forces logout when `auth.isAuthenticated && auth.currentUser`. Cold-start restore calls it **before** `completeSessionRestore` sets those flags. On epoch mismatch it takes the early branch, **writes local epoch = server epoch**, returns `false`, and restore proceeds with pre-restore local data. The layout interval later sees epochs equal and never logs out.
- Why it matters: Post-backup `authEpoch` bump is meant to force every device to wipe/re-login and re-sync. The primary restore path defeats that, leaving stale CRM data after restore.
- Suggested fix (behavior-preserving if possible):
  - Split “epoch behind?” from “logout if authenticated.”
  - On restore: if `serverEpoch > localEpoch`, call full `logout()` (or clear session + wipe) **even when not yet authenticated**, then set local epoch, then return false from restore.
  - Layout path can keep the authenticated-only logout.
  - Add a unit test for “not authenticated + epoch ahead → clear markers / do not advance epoch without wipe.”
- Effort: M

### F2 — Severity: critical
- File: `src/routes/api/auth/mark-verified/+server.ts:5-77`
- Theme: security
- Description: `POST /api/auth/mark-verified` accepts `{ pbId, email }` with **no client auth check**, then uses `INTERNAL_SECRET` to PATCH any user `verified: true`. Same unauthenticated privilege pattern on `send-welcome` (`src/routes/api/auth/send-welcome/+server.ts:6-38`) and `request-email-change` (`src/routes/api/auth/request-email-change/+server.ts:6-37`).
- Why it matters: Any network client can mark accounts verified (skips onboarding semantics), trigger welcome/password-reset emails (spam / link abuse), or initiate email-change flows. Internal secret never leaves the server, but the public SvelteKit routes are open proxies.
- Suggested fix:
  - Require `Authorization` via `getUserFromAuthHeader` (or admin-only for send-welcome / mark-verified).
  - For WelcomeModal: only mark verified for the **same** user id as the token, after password change.
  - For NewUserModal: admin role required.
  - Rate-limit password-reset / welcome / email-change.
  - Prefer PB self-service or admin rules for `verified` instead of a blanket internal patch when possible.
- Effort: M

### F3 — Severity: high
- File: `src/lib/components/NewUserModal.svelte:65-86` + `src/lib/db/pb.ts:314-372` / `src/lib/db/userSync.ts:189-198`
- Theme: bug | inconsistency | merge-residue
- Description: Create path sets local `verified: false` (WelcomeModal gate) but immediately calls `/api/auth/mark-verified`, setting **PB** `verified: true`. On next email login, `mergeAuthUserIntoLocal` sets `verified: !!pbUser.verified` from PB → WelcomeModal **does not run**. Comments still describe verified as “set via welcome email or WelcomeModal after real password.”
- Why it matters: First-login forced password change is bypassed when mark-verified succeeds; temp passwords remain valid. Onboarding model is split between two agents’ assumptions.
- Suggested fix: Remove mark-verified from NewUserModal create path. Only WelcomeModal (after successful password change) or the welcome-email confirm hook should set `verified`. Align comments and tests.
- Effort: S

### F4 — Severity: high
- File: `src/lib/stores/auth.svelte.ts:240-260`, `src/lib/stores/auth.svelte.ts:288-293`, `src/lib/stores/auth.svelte.ts:264-286`
- Theme: bug | security | dead-code
- Description: Desktop idle path (`enforceDesktopLockIfInactive` → `lockAppIfQuickUnlockEnabled` → `shouldRequireUnlock`) only sets `auth.locked` when **device quick-unlock is enabled**. If the admin configures `desktopSecurityIdleMinutes` but the user never set a device PIN/bio, idle expiry is a no-op. `expireSessionToLogin` implements full sign-out to `/login?session=expired` but is **never called** anywhere in the repo. Options copy implies desktop inactivity forces re-auth; behavior is “optional local lock only.”
- Why it matters: Shared/desktop workstations keep full offline CRM sessions open indefinitely without quick-unlock setup.
- Suggested fix: When desktop idle expires and quick-unlock is **not** available, call `expireSessionToLogin('expired')`. When it is available, keep lock overlay (current). Wire tests for both branches. Optionally rename options label to match.
- Effort: S

### F5 — Severity: high
- File: `src/lib/auth/sessionPersist.ts:118-123`, `src/lib/stores/auth.svelte.ts:68-102`, `src/lib/stores/auth.test.ts:93-125`
- Theme: security | inconsistency
- Description: App auth (`auth.isAuthenticated`) restores from `localStorage.currentUserId` / Dexie `users` / rebuilt `appSession` **without requiring a valid PB token**. Tests explicitly encode “Dexie user + currentUserId ⇒ logged in.” PB is refreshed opportunistically but offline UI session is local-marker based. Dual models coexist: `pb.authStore` (sync/API) vs durable local session (UI guard).
- Why it matters: Intended for offline-first PWA, but any process that can write IndexedDB/localStorage can present as a user for local data. Role-based layout guards trust Dexie `role`. After PB token expiry, UI may still show authenticated until sync fails.
- Suggested fix (behavior-preserving): Document threat model (device trust). Online: refuse complete restore without successful `authRefresh` when a token exists but is invalid; clear spoofable markers. Keep offline restore only when last known good session markers match (userId + non-empty token or signed blob). Avoid elevating role from local-only rebuilt users without PB model.
- Effort: M

### F6 — Severity: medium
- File: `src/lib/auth/deviceUnlock.ts:349-376`, `src/lib/auth/deviceUnlock.ts:242-273`
- Theme: security
- Description: Local quick-unlock biometric registration stores only `biometricCredentialId` (rawId). Unlock calls `navigator.credentials.get` and treats any non-null assertion as success—**no public key stored, no signature/challenge verification**. Server passkeys (`src/lib/server/webauthn.ts`) correctly verify via `@simplewebauthn/server`. Two WebAuthn systems: real passkeys vs “presence-only” local bio.
- Why it matters: Local bio is a UX gate, not cryptographic unlock. Acceptable if documented; dangerous if treated as equivalent to passkey login. Compromised origin JS can call `unlockApp()` directly anyway (`auth.locked` is client-only).
- Suggested fix: Document as convenience lock only. Optionally store public key at registration and verify assertion client-side (still not server-grade). Keep distinct from passkey login naming in UI (“Device unlock” vs “Sign in with passkey”).
- Effort: S (docs) / L (real local verify)

### F7 — Severity: medium
- File: `src/lib/db/index.ts:232-237`, `src/lib/db/userSync.ts:140-151`, `src/lib/db/userSync.ts:189-221`, `src/lib/auth/sessionPersist.ts:111-112`, `src/routes/(app)/profile/+page.svelte:11`
- Theme: duplication | schema-drift | dead-code
- Description: **Dual PIN models**: (1) legacy `User.pinHash` / `forcePinUpdate` still typed, merged, and partially synced; (2) real device PIN lives in `deviceAuth.pinHash` via bcrypt in `deviceUnlock.ts`. Profile comments say PIN/forcePin fully removed from UI; sync layer still carries fields. `buildUserFromAppSession` always emits empty `pinHash` / `forcePinUpdate: false`.
- Why it matters: Multi-model residue confuses reviewers and future features; risk of reintroducing PIN-login against the wrong hash store.
- Suggested fix: Stop reading/writing `pinHash`/`forcePinUpdate` in merge paths (always `''`/`false`). Plan Dexie migration to drop fields after a grace release. Single source of truth: `db.deviceAuth` for unlock PIN.
- Effort: M

### F8 — Severity: medium
- File: `src/lib/components/ForcePhotoUpdate.svelte` vs `src/lib/components/ForcePhotoUpdateModal.svelte`; login uses only the former (`src/routes/login/+page.svelte:8`, `393-394`)
- Theme: duplication | dead-code
- Description: Two near-duplicate force-photo modals (different state names, same flow). Login uses `ForcePhotoUpdate`; `ForcePhotoUpdateModal` appears unused. Force-photo is skippable via “Later (from Profile)” (`ForcePhotoUpdate.svelte:200-202`), so `forcePhotoUpdate` is soft, not hard, despite “Required” copy.
- Why it matters: Merge residue; inconsistent enforcement if a second entry point reintroduces the other component.
- Suggested fix: Delete unused modal; one component. Product decision: hard gate (no Later) vs soft (keep Later, rename title).
- Effort: S

### F9 — Severity: medium
- File: `src/lib/auth/deviceUnlock.ts:120-136`, `src/lib/components/QuickUnlock.svelte:86-112`
- Theme: security
- Description: PIN attempt lockout is stored in **sessionStorage** (`ccw_pin_attempts`). Reload/new tab resets attempts. Lockout UI says “Sign in with email” but does not auto-logout; only optional button calls `logout()`.
- Why it matters: Brute-force of 4-digit PIN is limited mainly by user patience + sessionStorage lifetime, not durable lockout.
- Suggested fix: Persist attempt count + lockout-until in `deviceAuth` (or localStorage with backoff). On lockout, auto-call logout path. Rate-limit is still client-side only—acceptable for local gate if documented.
- Effort: S

### F10 — Severity: medium
- File: `src/lib/db/index.ts:466-484` vs `src/lib/auth/sessionPersist.ts:125-181`
- Theme: duplication | inconsistency
- Description: Two session writers: `persistSessionUserId` / `readPersistedSessionUserId` (partial `appSession` put, no PB token backup) and `persistAppSession` / `clearAppSession` / `hasRestorableSession` (full durable session). Restore still falls back to `readPersistedSessionUserId` (`auth.svelte.ts:72-78`). Risk of partial rows without `pbToken`/`email`.
- Why it matters: Incomplete merges leave “which API owns session?” ambiguity and weaker restore durability.
- Suggested fix: Deprecate `persistSessionUserId`; only `sessionPersist` owns `appSession`. Grep and remove callers.
- Effort: S

### F11 — Severity: low
- File: `src/lib/server/webauthn.ts:237`, `src/lib/server/webauthn.ts:325`; challenge HMAC good at `74-92`
- Theme: security
- Description: Server passkey verify uses `requireUserVerification: false` while options request `userVerification: 'preferred'`. Challenge tokens are HMAC-signed with `INTERNAL_SECRET` and expiry—solid. `getUserFromAuthHeader` correctly validates tokens via PB auth-refresh (`pbAuth.ts:8-22`).
- Why it matters: UV optional may allow weaker authenticators in some browsers; not a break of ownership checks (credential still verified).
- Suggested fix: Prefer `requireUserVerification: true` if all target devices support UV; or document preferred-but-not-required.
- Effort: S

### F12 — Severity: low
- File: `src/lib/components/QuickUnlock.svelte:2`, `46-57`; AGENTS.md forbids legacy `onMount`
- Theme: inconsistency
- Description: QuickUnlock uses Svelte `onMount` for history lock; rest of app migrated to `$effect`. Auth store uses `currentUser: null as any` (`auth.svelte.ts:7`).
- Why it matters: Style/merge residue; history trap is fine, just non-idiomatic for this repo.
- Suggested fix: Convert history trap to `$effect` with cleanup; type `auth.currentUser` as `User | null`.
- Effort: S

### F13 — Severity: low
- File: `src/lib/stores/auth.svelte.ts:297-376` (logout), `src/lib/auth/sessionPersist.ts:168-181`
- Theme: abstraction
- Description: Logout is carefully ordered (invalidate sync → clear PB → clear markers → snapshot deviceAuth → wipe Dexie → restore deviceAuth). Intentional: PIN survives logout. Does not clear `ccw_auth_epoch` (correct). Does not clear PIN attempts session keys (minor). `expireSessionToLogin` does not wipe Dexie (by design for soft expiry) but is unused (see F4).
- Why it matters: Mostly good; document “deviceAuth survives logout” so future agents do not “fix” it by wiping PIN.
- Suggested fix: Comment contract in logout; optionally clear PIN attempts on logout.
- Effort: S

## Multi-model fingerprints

| Fingerprint | Evidence |
| --- | --- |
| Dual session identity | `localStorage.currentUserId` + Dexie `appSession` + `pb.authStore` + legacy `persistSessionUserId` |
| Dual PIN | `User.pinHash` / `forcePinUpdate` vs `deviceAuth.pinHash` (bcrypt) |
| Dual WebAuthn | Server passkeys (`passkeys.ts` + `server/webauthn.ts`) vs local bio id-only (`deviceUnlock`) |
| Dual force-photo UI | `ForcePhotoUpdate.svelte` vs unused `ForcePhotoUpdateModal.svelte` |
| Dual verified semantics | Local onboarding gate vs PB field; NewUserModal sets PB true early; WelcomeModal also sets |
| Dual desktop idle semantics | Options “force sign-in” vs code path only quick-unlock lock; dead `expireSessionToLogin` |
| Dual Svelte styles | `$effect` guards in layout vs `onMount` in QuickUnlock |
| Comment archaeology | Profile “PIN completely removed”; userSync still merges pinHash; NewUser “verified after welcome” vs immediate mark-verified |
| Test vs product gap | `auth.test.ts` restores session from Dexie id alone; authEpoch tests only cover localStorage helpers, not force-logout race |

## Reuse opportunities

1. **Single session module** — Collapse all durable session R/W into `sessionPersist.ts`; delete `persistSessionUserId`/`readPersistedSessionUserId` after call-site migration.
2. **Single privileged-auth helper** — Extend `getUserFromAuthHeader` (+ optional `requireAdmin`) for all `/api/auth/*` mutating routes.
3. **Shared base64url helpers** — Local deviceUnlock buffer helpers could share with passkey code if local verify is added; otherwise leave isolated.
4. **One force-photo component** — Keep `ForcePhotoUpdate.svelte`; delete modal twin.
5. **Epoch check primitive** — `isEpochBehind()` pure function used by restore (always wipe) and layout (logout if authenticated).
6. **Onboarding gate helpers** — Already centralized in `deviceUnlock` (`userNeedsWelcomeOnboarding`, `userNeedsPhotoOnboarding`); keep login/profile using only these; do not re-fork conditions.

## Top 5 cleanup actions for this domain

1. **Fix authEpoch restore race (F1)** — Epoch mismatch must force logout/wipe even when `auth.isAuthenticated` is still false; add regression test.
2. **Lock down `/api/auth/*` privileged routes (F2)** — AuthZ on mark-verified, send-welcome, request-email-change; never open-proxy INTERNAL_SECRET actions.
3. **Stop marking verified on user create (F3)** — Only after real password / email activation; restore WelcomeModal gate.
4. **Wire desktop idle to real expiry (F4)** — Use dead `expireSessionToLogin` when quick-unlock unavailable; lock when available.
5. **Retire legacy User PIN fields + dual session writers (F7, F10)** — deviceAuth-only PIN; sessionPersist-only session; delete unused ForcePhotoUpdateModal.

---

*Review mode: read-only. Commit under review: `64e9233` (origin/main). Agent A — Auth & session.*
