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
		}
	},
	kit: {
		adapter: adapter({
			// Default output is ./build with index.js entrypoint.
			// Run with: node build  (or node build/index.js)
			// Precompress can be enabled if you want .br/.gz files generated.
			precompress: false
		})
	},
	preprocess: vitePreprocess()
};

export default config;
