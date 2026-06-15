// vite.config.ts
import { sveltekit } from '@sveltejs/kit/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit(),
		VitePWA({
			registerType: 'autoUpdate',
			manifest: {
				name: 'Capital City Windows Scheduler',
				short_name: 'CCW Scheduler',
				description: 'Window Cleaning CRM & Scheduler',
				theme_color: '#1e3a8a',
				background_color: '#f8fafc',
				display: 'standalone'
				// )=- PWA icons intentionally omitted for initial staging deploy.
				// Add 192x192 and 512x512 PNG icons to /static and re-enable before full production launch.
				// Current favicon.svg is used for browser tab; proper PNGs improve home-screen install experience.
				// icons: [
				// 	{ src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
				// 	{ src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' }
				// ]
			},
			// )=- Workbox will still generate sw.js and precache the app shell for offline use (Dexie + PWA).
			includeAssets: ['favicon.svg']
		}),
		{
			// Add crossorigin="anonymous" (and ensure proper as= for common cases) to generated preload/modulepreload links.
			// This addresses the repeated live console warnings:
			//   "A preload for '<URL>' is found, but is not used because the request credentials mode does not match.
			//    Consider taking a look at crossorigin attribute."
			//   "The resource <URL> was preloaded using link preload but not used within a few seconds..."
			// The transform runs on the shell HTML. Some dynamic/chunk preloads from SvelteKit runtime or Workbox
			// may still appear; those are often speculative (for code-split routes/modals) and harmless once the
			// user navigates. The polyfill:false below also reduces some noise.
			name: 'add-crossorigin-to-preloads',
			transformIndexHtml(html) {
				let out = html.replace(
					/<link([^>]*?)rel=["'](modulepreload|preload)["']([^>]*?)>/gi,
					(match, before, rel, after) => {
						if (/crossorigin/i.test(before) || /crossorigin/i.test(after)) return match;
						// Try to preserve existing attributes and inject crossorigin early.
						return `<link${before}rel="${rel}" crossorigin="anonymous"${after}>`;
					}
				);
				// Also ensure common font preloads have crossorigin (required for CORS + avoids warnings).
				out = out.replace(
					/<link([^>]*?)rel=["']preload["']([^>]*?)as=["']font["']([^>]*?)>/gi,
					(match, before, mid, after) => {
						if (/crossorigin/i.test(before) || /crossorigin/i.test(mid) || /crossorigin/i.test(after)) return match;
						return `<link${before}rel="preload"${mid}as="font" crossorigin="anonymous"${after}>`;
					}
				);
				return out;
			},
		}
	],

	ssr: {
		noExternal: [
			'@fullcalendar/core',
			'@fullcalendar/daygrid',
			'@fullcalendar/timegrid',
			'@fullcalendar/interaction',
			'@fullcalendar/multimonth',
			'dexie'
		]
	},

	// Reduce aggressive module preloading (helps with "preloaded using link preload but not used" warnings
	// in PWA setups with route-based code splitting). The crossorigin plugin above handles credentials mismatches.
	build: {
		modulePreload: {
			polyfill: false,
		},
	},

	// )=- Stronger optimization settings to prevent 504 errors
	optimizeDeps: {
		include: [
			'@fullcalendar/core',
			'@fullcalendar/daygrid',
			'@fullcalendar/timegrid',
			'@fullcalendar/interaction',
			'@fullcalendar/multimonth',
			'dexie'
		]
	},

	// )=- Fix for worker_threads / Dexie error
	define: {
		'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV)
	},

	server: {
		fs: {
			allow: ['..']
		}
	}
});
