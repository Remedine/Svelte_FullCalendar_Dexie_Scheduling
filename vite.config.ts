// vite.config.ts
import { sveltekit } from '@sveltejs/kit/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit(),
		VitePWA({
			registerType: 'autoUpdate',
			injectRegister: false,
			scope: '/',
			buildBase: '/',
			manifest: {
				name: 'Capital City Windows',
				short_name: 'Capital City Windows',
				description: 'Window Cleaning CRM & Scheduler',
				theme_color: '#002b5c',
				background_color: '#002b5c',
				display: 'standalone',
				start_url: '/calendar',
				// )=- PWA install icons generated from Capital City Windows brand logo (user-provided PNG).
				// 192/512 required for Chrome/Android install prompts; maskable variant uses safe-zone padding.
				// Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling
				icons: [
					{ src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
					{ src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
					{
						src: '/pwa-512x512.png',
						sizes: '512x512',
						type: 'image/png',
						purpose: 'maskable'
					}
				]
			},
			// )=- Precache favicon + PWA icons so install/offline shell has branded assets.
			includeAssets: [
				'favicon.ico',
				'favicon-16x16.png',
				'favicon-32x32.png',
				'pwa-192x192.png',
				'pwa-512x512.png',
				'apple-touch-icon.png'
			],
			// )=- Offline shell: SvelteKit adapter-node has no static index.html — cache navigations at runtime.
			// Precache already covers _app/immutable/*; NetworkFirst on document requests caches each route HTML
			// after one online visit; warmOfflineRouteCache() prefetches calendar/jobs/clients/login on login.
			workbox: {
				navigateFallback: null,
				navigateFallbackDenylist: [/^\/api\//, /^\/_/],
				globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff,woff2,webmanifest}'],
				runtimeCaching: [
					{
						urlPattern: ({ request, url }) =>
							request.mode === 'navigate' && !url.pathname.startsWith('/api/'),
						handler: 'NetworkFirst',
						options: {
							cacheName: 'ccw-pages',
							networkTimeoutSeconds: 4,
							expiration: {
								maxEntries: 48,
								maxAgeSeconds: 60 * 60 * 24 * 30
							},
							cacheableResponse: { statuses: [0, 200] }
						}
					},
					{
						urlPattern: /\/_app\/immutable\/.*/i,
						handler: 'CacheFirst',
						options: {
							cacheName: 'ccw-immutable',
							expiration: {
								maxEntries: 300,
								maxAgeSeconds: 60 * 60 * 24 * 365
							}
						}
					}
				]
			}
		}),
		{
			// Add crossorigin="anonymous" (and ensure proper as= for common cases) to generated preload/modulepreload links.
			// This addresses the repeated live console warnings:
			//   "A preload for '<URL>' is found, but is not used because the request credentials mode does not match.
			//    Consider taking a look at crossorigin attribute."
			//   "The resource <URL> was preloaded using link preload but not used within a few seconds..."
			//
			// The transform runs on the shell HTML during build (transformIndexHtml + post order).
			// SvelteKit still injects additional modulepreload links for the current page's chunks at runtime/render time.
			// The changes below + `data-sveltekit-preload-data="false"` in app.html + polyfill:false reduce the volume.
			// For fully static control one would need a custom adapter hook or post-build HTML rewrite, but this
			// catches the ones emitted into the initial index.html and many of the Vite-generated ones.
			name: 'add-crossorigin-to-preloads',
			enforce: 'post',
			transformIndexHtml: {
				order: 'post',
				handler(html) {
					// Do not add crossorigin to modulepreload — same-origin modules load without it.
					let out = html;
					// Font preloads require crossorigin to avoid CORS + warning.
					out = out.replace(
						/<link([^>]*?)rel=["']preload["']([^>]*?)as=["']font["']([^>]*?)>/gi,
						(match, before, mid, after) => {
							if (
								/crossorigin/i.test(before) ||
								/crossorigin/i.test(mid) ||
								/crossorigin/i.test(after)
							)
								return match;
							return `<link${before}rel="preload"${mid}as="font" crossorigin="anonymous"${after}>`;
						}
					);
					return out;
				}
			}
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
			resolveDependencies: () => []
		}
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
