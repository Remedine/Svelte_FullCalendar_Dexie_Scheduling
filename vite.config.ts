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
				display: 'standalone',
				icons: [
					{ src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
					{ src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' }
				]
			}
		})
	],

	ssr: {
		noExternal: ['@fullcalendar/*']
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
		],
		exclude: [
			// Add any packages that keep causing issues
		]
	},

	server: {
		fs: {
			allow: ['..']
		}
	}
});