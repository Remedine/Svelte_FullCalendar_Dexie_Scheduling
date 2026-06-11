import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

// )=- Vitest configuration for Svelte 5 runes + Dexie + SvelteKit project.
// Uses happy-dom for fast DOM (better perf than jsdom for most Svelte tests).
// Setup file installs fake-indexeddb so all Dexie usage in tests is isolated and in-memory.
// $lib alias is handled via SvelteKit Vite plugin + tsconfig paths.
// Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling + TESTING_PLAN.md (Phase 0)
export default defineConfig({
	plugins: [sveltekit()],
	test: {
		environment: 'happy-dom',
		setupFiles: ['./vitest.setup.ts'],
		include: ['src/**/*.{test,spec}.{js,ts}'],
		// Keep globals false for explicit imports (cleaner, matches modern Vitest guidance)
		globals: false,
		// Dexie benefits from being inlined in the test transform in some environments
		deps: {
			inline: ['dexie', '@testing-library/svelte']
		},
		// Help @testing-library/svelte + Svelte 5 runes components resolve the client build
		// instead of the server one (avoids mount / $state lifecycle errors in happy-dom).
		// Additional tweaks for Svelte 5 component testing.
		resolve: {
			conditions: ['browser', 'development']
		},
		// Inline Svelte and testing lib to avoid resolution issues.
		deps: {
			inline: ['svelte', '@testing-library/svelte', 'dexie']
		},
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html'],
			exclude: [
				'**/*.svelte',
				'**/node_modules/**',
				'**/*.config.*',
				'**/build/**',
				'**/*.test.*'
			]
		}
	}
});
