import { browser } from '$app/environment';

/** Register the app service worker (vite-plugin-pwa generateSW output at /sw.js). */
export function registerAppServiceWorker(): void {
	if (!browser || !('serviceWorker' in navigator)) return;
	void navigator.serviceWorker.register('/sw.js', { scope: '/' });
}