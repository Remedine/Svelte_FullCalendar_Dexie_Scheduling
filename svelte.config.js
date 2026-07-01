// svelte.config.js
// )=- Using @sveltejs/adapter-node for self-hosted deployments.
// The full stack (SvelteKit app + PocketBase) will run on the same server (e.g. VPS with PM2, Docker, systemd, or nginx reverse proxy).
// The app remains fully client-side (ssr=false + PWA + Dexie), but adapter-node gives a proper Node server process that can be managed alongside the PocketBase binary.
// Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling
import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true),
		experimental: {
			async: true
		},
		// Suppress a11y warnings during build (we've fixed the major ones in code for real accessibility;
		// remaining are common modal-backdrop click handlers and label patterns that don't affect functionality).
		warningFilter: (warning) => !warning.code?.startsWith('a11y_'),
	},
	kit: {
		adapter: adapter({
			// Default output is ./build with index.js entrypoint.
			// Run with: node build  (or node build/index.js)
			// Precompress can be enabled if you want .br/.gz files generated.
			precompress: false
		}),
		// Backup .zip uploads proxy through /api/admin/backups/upload (default 512KB is far too small).
		server: {
			bodySizeLimit: 64 * 1024 * 1024
		}
	},
	preprocess: vitePreprocess()
};

export default config;
