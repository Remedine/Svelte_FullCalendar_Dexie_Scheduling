# Agent E: Backups, options, bulk admin

**Commit:** `64e9233`  
**Workspace:** Capital City Windows CRM  
**Date:** 2026-07-16  
**Scope:** `src/lib/backups/**`, `src/lib/server/{backups,googleDrive,pbAdmin}.ts`, `src/routes/api/admin/backups/**`, `src/routes/(app)/admin/options/**`, `src/lib/bulk/**`, `BulkImportPanel.svelte`, `src/routes/api/admin/bulk/**`, `src/lib/stores/options.svelte.ts`

---

## Executive summary

Backup/Drive plumbing is **substantially well designed**: admin authz on admin APIs, sealed OAuth refresh tokens, restore confirmation by exact filename, full-zip-only restores, Alaska retention policy with Drive safety-net, and bulk import correctly hard-blocked at dry-run (501 on commit). Main risks are **token storage readable by every authenticated user**, **client write-back of server-authoritative backup metadata**, **god-page size (~2800 lines)** on Options, and **operational edges** (hourly schedule window, in-memory Drive buffers, unbounded sync-queue body).

---

## Findings

| ID | Severity | File:line | Theme | Description | Why it matters | Fix | Effort |
|----|----------|-----------|-------|-------------|----------------|-----|--------|
| E-01 | **High** | `pb_migrations/1780477923_updated_options_rules.js:8-9`; `1782900000_unhide_google_drive_refresh_token.js`; `src/lib/server/googleDrive.ts:19-55` | OAuth / secrets | `backupGoogleDriveRefreshToken` is **not** PB-hidden (required for internal JSON) and options **list/view** allow **any authenticated user**. Client store omits the field (`options.svelte.ts:186-187`), but any crew JWT can still `GET /api/collections/options` and receive the sealed (or legacy plain) token blob. | Sealed tokens still are high-value secrets; if `INTERNAL_SECRET` ever leaks, or if a legacy plain token remains, Drive account is fully compromiseable. Defense-in-depth fails at the data layer. | Move token to admin-only collection or server secret store (env/encrypted file); or keep sealed but never return field via public PB rules (separate collection with `listRule/viewRule` admin-only). Re-seal any plain tokens. | M |
| E-02 | **High** | `src/lib/stores/options.svelte.ts:304-318` | Restore / schedule safety | `syncToPB` writes **client-held** `lastScheduledBackupDate`, `lastBackupAt`, `lastBackupStatus`, `lastBackupError`, `lastBackupFilename`, `lastBackupSizeBytes` back to PB on every Options save. | Stale admin UI after a cron backup can **overwrite success status**, re-open the daily schedule gate (double backup), or clear failure signals. Server job and UI fight over the same fields. | Strip server-authoritative backup fields from client payload; only server/`patchOptionsRecord` may update them. Optionally whitelist client fields in a dedicated PATCH. | S |
| E-03 | **Medium** | `src/lib/server/googleDrive.ts:38-42` | OAuth token handling | `openDriveRefreshToken` returns **unsealed legacy plain** values as-is (`!startsWith('enc:v1:')`). | Any pre-seal or partial migration token is plaintext in a world-readable-to-auth options record (E-01). | One-shot migration: read all plain tokens, `sealDriveRefreshToken`, rewrite; reject plain on open in prod. | S |
| E-04 | **Medium** | `src/routes/api/admin/backups/restore/+server.ts:38-42`; `google-drive/restore/+server.ts:45-48`; `src/lib/server/backups.ts:226-237, 292-333` | Restore safety | Restore is admin + filename confirm only; no password re-prompt, no concurrency lock, no audit log. Drive path loads entire zip into memory then re-uploads. `finalizeRestoreAfterPbRestart` is fire-and-forget. | Accidental or malicious admin click is one confirm away from full data wipe; concurrent restores undefined; large Drive restores risk OOM; failed authEpoch bump leaves clients with pre-restore sessions. | Add re-auth step or typed phrase beyond filename; mutex on restore; stream Drive→PB where possible; await/retry finalize; audit log who/when/name. | M |
| E-05 | **Medium** | `src/lib/backups/schedule.ts:44-46`; `src/routes/api/cron/run-backup/+server.ts` | Retention / schedule | Scheduled run requires **exact** Alaska hour match on an hourly cron tick. Missed hour → **no backup until next day**. | Ops/latency/restart can silently skip nightly backup with no catch-up window. | Allow window (e.g. `hour >= target && !alreadyRanToday`) or retry until success before midnight. | S |
| E-06 | **Medium** | `src/routes/api/admin/backups/sync-queue/+server.ts:19-23` | Authz / DoS | Sync-queue POST accepts arbitrary `items` array with **no size/count cap** and patches options. | Admin-only but still DoS / oversized PB record risk; large snapshot on every 5 min upload path. | Cap bytes/items (e.g. 1–2 MB / N rows); reject oversize with 413. | S |
| E-07 | **Medium** | `src/lib/server/backups.ts:536-543, 322-329`; `googleDrive.ts:348-366` | Ops / memory | Full backup zip buffered in Node for Drive upload/download. | Large file sets (attachments) can spike memory during backup/restore. | Stream to Drive (`media.body` stream from PB download); stream stage for restore. | M |
| E-08 | **Medium** | `src/routes/(app)/admin/options/+page.svelte` (~2800 lines) | God-page | Single Svelte file owns scheduling, security, invoice, backups UI/logic, restore modal, and ~1k lines CSS. | High regression cost; multi-agent churn concentrated here; hard to review/test. | Split into tab components + `options-page.css` / shared backup helpers (see structure map). | L |
| E-09 | **Low** | `src/lib/server/pbAdmin.ts:3-17` | Authz | Admin check is `auth-refresh` + `role === 'admin'` only; no `active` check. | Deactivated admin JWT may still hit backup/restore until token expires. | Also require `record.active !== false` (and optionally not expired). | S |
| E-10 | **Low** | `src/lib/server/googleDrive.ts:132-174` | OAuth | OAuth `state` is HMAC + TTL + nonce but **nonce not single-use stored**. | Replay of state within 15m is mostly moot (Google code single-use) but weaker than best practice. | Store nonce in short-lived server store / cookie. | S |
| E-11 | **Low** | `src/lib/server/googleDrive.ts:267-276` | Secrets / scope | Service-account path uses full `drive` scope vs OAuth `drive.file`. | Broader than needed if SA JSON is compromised. | Prefer `drive.file` or domain-restricted folder scope. | S |
| E-12 | **Low** | `src/lib/bulk/dryRun.ts`; `src/routes/api/admin/bulk/+server.ts:137-145` | Bulk dry-run vs apply | Commit correctly returns **501**; dry-run only validates payload shape/cross-refs **within package** — no PB existence checks; only `would_create` / `error`. | False confidence before real import; duplicates vs live data not detected. | Slice 2: DB-aware actions (`would_create`/`would_update`/`would_skip`); keep default dryRun true; require explicit confirm for apply. | M |
| E-13 | **Low** | `src/lib/stores/options.svelte.ts:345` | Secrets on client | `console.log('📤 Sending to PocketBase:', pbPayload)` logs full options payload in browser. | Not the refresh token (stripped), but PII/business config in console; noisy. | Remove or guard with `import.meta.env.DEV`. | S |
| E-14 | **Info** | `src/lib/backups/names.ts:32-40, 62-65`; create-split residual | Multi-model residue | Split artifact kinds (`records`/`files`/`legacy`/`sync_queue`) still pruned; product path is `_full.zip` only. Email dest flag forced false. | Harmless cleanup surface; confuses new readers. | Document “full-only product”; eventually drop dead kinds after data purge. | S |
| E-15 | **Info** | Admin backup routes all use `assertAdminFromAuthHeader` | Authz (positive) | List/create/download/upload/restore/Drive/files/bulk all gate on admin JWT. Cron uses `INTERNAL_SECRET`. OAuth callback uses signed state (no auth header by design). | Baseline is solid. | Keep pattern; centralize helper import to avoid drift (users-roster still has local assert). | — |
| E-16 | **Info** | `src/lib/backups/retention.ts`; `backups.ts:557-571` | Retention (positive) | Calendar retention (30d daily → anchors → monthly → quarterly → yearly) + **5-day server safety net** when Drive upload succeeds; server full retention if Drive off/fail. | Good durability design. | Add admin UI “retention preview” already partially present under Advanced. | — |

---

## Structure map of options page

**File:** `src/routes/(app)/admin/options/+page.svelte` (**~2800 lines**)

| Lines (approx) | Region | Responsibility |
|----------------|--------|----------------|
| 1–23 | Imports | optionsStore, auth, toast/restore countdown, dates, pb, backup name/retention helpers, BulkImportPanel |
| 25–75 | Boot comments + load `$effect` | Admin options load/pull; heavy “removed guard” comment residue |
| 45–210 | State | `activeTab`, Drive status, backup lists, unified merge, restore dialog state, schedule hour 12h UI |
| 214–322 | `$effect`s | Clone `editingOptions`, hour12 sync, OAuth deep-link `?tab=backups&gdrive=` |
| 324–418 | `saveOptions` | Validation + Dexie + `syncToPB` |
| 422–505 | List editors | Areas / billables / cancel reasons reorder+delete |
| 507–864 | **Backup subsystem** | ensureFreshAdminSession, list/run/download/restore/upload, Drive connect/disconnect, tab `$effect` |
| 871–891 | Shell | Header + tab strip |
| 895–1089 | Tab: **scheduling** | Duration, areas, crew notify time, calendar hours, cancel reasons |
| 1091–1136 | Tab: **security** | Quick unlock + desktop idle |
| 1138–1337 | Tab: **invoice** | Business identity, mailing, tax, invoice numbers, default billables |
| 1339–1743 | Tab: **backups** | Status hero, schedule, Drive destinations, unified restore list, Advanced upload |
| 1744–1746 | Tab: **import** | `<BulkImportPanel />` only |
| 1749–1801 | Global modal | Restore confirm overlay |
| 1809–1819 | Sticky footer | Save All (hidden on Import) |
| 1822–2799 | `<style>` | BEM `options-page__*`, backup/*, mobile @768 |

### Hotspots (decomposition order)

1. **Backup script block + Backups tab + restore modal** (~350 LOC script + ~400 LOC markup + CSS) → `OptionsBackupsTab.svelte` + `lib/admin/backupsUi.ts`
2. **Scheduling list editors** (areas / cancel reasons) → reusable `ReorderableList` patterns
3. **Invoice tab** (business fields + billables)
4. **Security tab** (tiny; extract last)
5. **CSS** → `options-page.css` or colocated partials per tab

Import tab is already cleanly extracted (`BulkImportPanel.svelte`).

---

## Multi-model fingerprints

Evidence of multi-pass / multi-agent authorship rather than a single clean author:

| Fingerprint | Where | Notes |
|-------------|-------|-------|
| `)= -` / `)=` comment markers | `options.svelte.ts`, `+page.svelte` | Distinctive agent “section” markers |
| `HYG-01` hygiene ticket | `+page.svelte:28` | Named cleanup pass (onMount → `$effect`) |
| Stacked “Removed redundant role guard” comments | `+page.svelte:25-75, 866-868` | Multiple agents removed the same pattern; comments left as archaeology |
| `Remedine/Svelte_FullCalendar_Dexie_Scheduling` refs | store + page footer | Cross-repo boilerplate |
| Split-backup / email-dest deprecations | `names.ts`, `backups.ts` `backupDestEmail: false` | Product simplified; code still carries prior model |
| Bulk “slice 1” language | `bulk/*`, API, panel | Explicit staged delivery from another workstream |
| Sealed-token + unhide migrations | `1782800000`, `1782900000` | Iterative production fix (hidden field broke internal API) |
| Mixed auth patterns | Most admin routes use `pbAdmin`; `users-roster` local assert | Copy-paste divergence |
| Emoji console logs | `📤` / `✅` in options store | Chatty agent-style logging |
| `any` on options store data | `options.svelte.ts:6` | Typed elsewhere poorly; residue of rapid store rewrite |

No raw LLM disclaimers found in scope; fingerprints are **style/process** rather than “as an AI” text.

---

## Positive controls (keep)

- Refresh token **never mapped** into client store or `syncToPB` payload; sealed with AES-GCM (`enc:v1:`) keyed from `INTERNAL_SECRET`.
- Restore requires exact `confirmName === name` and `_full.zip` only (server + Drive).
- Drive restore verifies file id ∈ connected folder and name match before stage.
- All `/api/admin/backups/**` and `/api/admin/bulk` use `assertAdminFromAuthHeader`.
- Bulk commit hard-disabled (`501`, `commitSupported: false`); UI labels dry-run only.
- Retention logic unit-tested (`retention.test.ts`, `schedule.test.ts`, `names.test.ts`).
- Post-restore `authEpoch` bump design forces fleet re-login when finalize succeeds.

---

## Top 5 cleanup actions

1. **Relocate Drive refresh token off public options list/view** (E-01/E-03) — admin-only collection or server store; re-seal plains.  
2. **Stop client write-back of backup run metadata** (`lastBackup*`, `lastScheduledBackupDate`) in `syncToPB` (E-02).  
3. **Decompose Options god-page** — extract Backups tab + restore dialog first (E-08).  
4. **Harden restore + schedule** — catch-up window for cron hour; restore mutex; cap sync-queue body (E-04/E-05/E-06).  
5. **Bulk slice 2 prep** — DB-aware dry-run outcomes; keep apply behind explicit confirm + still-default dryRun (E-12).

---

## Top 3 (priority)

1. **E-01 — OAuth refresh token readable by any authenticated user via options collection**  
2. **E-02 — Client Options save overwrites server backup schedule/status fields**  
3. **E-08 / E-04 — God-page + restore safety (decompose backups UI; strengthen destructive restore path)**

---

## Deliverable path

`docs/reviews/2026-07-16-multi-agent/agents/E-backups-admin.md`
