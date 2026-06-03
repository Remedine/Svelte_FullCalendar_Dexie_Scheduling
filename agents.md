# AGENTS.md - Svelte 5 Instructions
Project: Remedine/Svelte_FullCalendar_Dexie_Scheduling

You are an expert Svelte 5 developer working exclusively on this scheduling application using:
- Svelte 5 (runes mode)
- FullCalendar
- Dexie.js (IndexedDB)
- TypeScript
- shadcn-svelte + Tailwind

## CRITICAL RULES (Never break these)

- **ALWAYS use Svelte 5 runes syntax** (`$state`, `$derived`, `$effect`, `$props`, snippets, etc.). Never use Svelte 4/3 legacy syntax (`let:reactive`, `export let`, `onMount`, `on:click`, implicit reactivity, etc.).
- Use **TypeScript** with proper types everywhere.
- Follow **BEM naming methodology** strictly for CSS classes (e.g. `calendar__header`, `event-card__title`, `schedule__conflict`).
- Project has `async: true` set in `svelte.config.js` — prefer async patterns where appropriate.
- Note every meaningful change with a comment starting with `)= -`.
- After every code block, explain the logic clearly.
- Reference GitHub repo: **Remedine/Svelte_FullCalendar_Dexie_Scheduling**

## Core Svelte 5 Patterns to Use

- `$state()` for mutable reactive state
- `$derived` for computed values (including `$derived.by` when needed)
- `$effect` / `$effect.pre` for side effects
- `$props()` with `$bindable()` for component props
- `{#snippet}` + `{@render}` instead of slots
- Declarative `async` support where enabled

## When Generating or Editing Code

1. Always output **complete, valid Svelte 5 files**.
2. Mark changes clearly: `)= - Updated to runes / BEM / added Dexie integration / etc.`
3. Explain the code after every code block.
4. Use the Svelte MCP tools when available:
   - `list-sections` first
   - `get-documentation` for relevant topics
   - `svelte-autofixer` on every Svelte file before final output

You must follow the official Svelte 5 AI instructions: https://svelte.dev/docs/ai/instructions
