# Baseline — 2026-07-16 multi-agent review

- **Commit:** `64e9233` — fix(bulk): theme-aware buttons and controls for light/dark mode
- **Branch:** `main` / `origin/main` (aligned)
- **Prep:** Restored working tree from HEAD (discarded ~188 staged deletions / skeleton wipe)
- **src files:** 149
- **Unit tests:** ~25 `*.test.ts` + Playwright under `tests/e2e/`

## Largest source files

| Size | Path |
|------|------|
| ~96 KB / ~2.7k lines | `src/lib/db/index.ts` |
| ~85 KB / ~2.6k lines | `src/lib/calendar/SplitCalendar.svelte` |
| ~81 KB / ~2.8k lines | `src/routes/(app)/admin/options/+page.svelte` |
| ~50 KB | `src/lib/db/index.test.ts` |
| ~44 KB | `src/routes/(app)/profile/+page.svelte` |
| ~40 KB | `src/lib/components/InvoiceEditor.svelte` |
| ~36–38 KB | jobs/clients pages, JobFormModal |
| ~28 KB | `src/lib/db/pb.ts` |

## Agents

| ID | Lens | Report |
|----|------|--------|
| A | Auth & session | `agents/A-auth-session.md` |
| B | Data layer & sync | `agents/B-data-sync.md` |
| C | Calendar & jobs | `agents/C-calendar-jobs.md` |
| D | Invoices & billing | `agents/D-invoices.md` |
| E | Backups, options, bulk | `agents/E-backups-admin.md` |
| F | Platform, PWA, notify | `agents/F-platform.md` |
| G | Adversarial: correctness & security | `agents/G-correctness-security.md` |
| H | Adversarial: maintainability | `agents/H-maintainability.md` |

## Outputs

- `synthesis.md` — comparison matrix + consensus
- `cleanup-backlog.md` — prioritized PR-sized work
