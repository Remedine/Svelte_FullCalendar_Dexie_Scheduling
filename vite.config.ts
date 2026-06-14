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
			// Add crossorigin="anonymous" to all generated preload/modulepreload links.
			// This fixes "A preload ... is found, but is not used because the request credentials mode does not match"
			// warnings (common with SvelteKit + Vite PWA + service workers, especially on platforms like Railway).
			// The browser's preload hints will then use a consistent (anonymous) credentials mode.
			name: 'add-crossorigin-to-preloads',
			transformIndexHtml(html) {
				return html.replace(
					/<link rel="(modulepreload|preload)"((?![^>]*crossorigin)[^>]*)>/g,
					'<link rel="$1" crossorigin="anonymous"$2>'
				);
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
