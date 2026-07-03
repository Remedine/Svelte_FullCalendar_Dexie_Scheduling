import { browser } from '$app/environment';
import { registerSW } from 'virtual:pwa-register';

/** Register the app service worker with vite-plugin-pwa autoUpdate lifecycle. */
export function registerAppServiceWorker(): void {
	if (!browser) return;
	registerSW({ immediate: true });
}