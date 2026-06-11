# CapitalCity Windows Scheduler

A custom, offline-first CRM, scheduling, and invoicing system built for CapitalCity Windows in Juneau, Alaska.

## Features

- Fully offline-capable Progressive Web App (PWA)
- Intelligent color-coded calendar by Juneau service areas (Thane, Douglas, Egan zones)
- Crew member icons visible directly on appointments
- One-click "Mark Complete" → auto-generated editable Word invoice
- Complete client history and notes
- Local-first data storage with sync capabilities
- Mobile-optimized for field use
- Crew and admin views for team specific calendars
- Use Pocketbase for data sync

## Tech Stack

- **Frontend**: SvelteKit 2 + Svelte 5
- **Local Database**: Dexie.js
- **Calendar**: FullCalendar v6
- **Styling**: Custom CSS with BEM methodology
- **PWA**: vite-plugin-pwa

## Status

**Private / Proprietary Software**  
© 2026 Digital Seeds Development & CapitalCity Windows  
All Rights Reserved.

---

## Development

```bash
pnpm install
pnpm dev
```

## Self-Hosting (Full Stack on One Server)

This is a **fully client-side SvelteKit PWA** (SSR disabled globally) that uses **Dexie (IndexedDB)** for local/offline storage and **PocketBase** as the remote source of truth for auth + sync.

The goal is to run the entire stack (SvelteKit Node server + PocketBase) on the same machine (VPS, dedicated server, or strong homelab box).

### Build & Run

```bash
pnpm install
pnpm build
pnpm start          # runs: node build   (provided by @sveltejs/adapter-node)
```

The `build/` directory contains a standalone Node server. You can also run it directly with `node build`.

### PocketBase on the Same Server

- Use the `pocketbase` (or `pocketbase.exe`) binary + `pb_data/` on the target server.
- Run the first-time setup / apply migrations from `pb_migrations/`.
- Typical local-same-box URL for the app: `PUBLIC_POCKETBASE_URL=http://127.0.0.1:8090`
- You can run both processes with PM2, Docker Compose, systemd units, or a simple shell script + supervisor.

Example minimal PM2 ecosystem (conceptual):

```json
{
  "apps": [
    { "name": "ccw-pb", "script": "./pocketbase", "args": "serve --http=127.0.0.1:8090" },
    { "name": "ccw-app", "script": "pnpm", "args": "start" }
  ]
}
```

### Environment Variables

- Copy `.env.example` → `.env` (or `.env.production`) on the server.
- The main required variable is `PUBLIC_POCKETBASE_URL`.
- With adapter-node you can also set other `PUBLIC_*` vars as needed.
- For robust production, prefer the host's environment variable mechanism (systemd `Environment=`, Docker `-e`, PM2 env files, etc.) over checking a `.env` file into the server.

### Recommended Production Setup

- Reverse proxy (Caddy or Nginx) in front of the SvelteKit port (default 3000 when using adapter-node in production) and optionally the PocketBase port.
- Use a real domain + HTTPS.
- Run both services under a process manager so they restart on crash / reboot.
- Back up `pb_data/` regularly (PocketBase has built-in backup commands).
- The PWA service worker gives excellent offline behavior even when the server is reachable.

### Local Production Verification (with real PB)

```bash
# Terminal 1: start your local or server PocketBase
./pocketbase serve --http=127.0.0.1:8090

# Terminal 2: build and run the SvelteKit server
pnpm build
PUBLIC_POCKETBASE_URL=http://127.0.0.1:8090 pnpm start
```

Then open the app and log in (it will sync against the real PB instance).

### Environment Files

- `.env.example` is committed. Copy to `.env.local` for local work.
- Never commit real `.env` files (already in `.gitignore`).

### PWA Notes

- Service worker + offline support is active (vite-plugin-pwa).
- For best home-screen install experience, add 192×192 and 512×512 PNG icons to `/static` and re-enable the `icons` array in `vite.config.ts`.

Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling

---

**Private / Proprietary Software**  
© 2026 Digital Seeds Development & CapitalCity Windows  
All Rights Reserved.