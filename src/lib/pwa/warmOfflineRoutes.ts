import { browser } from '$app/environment';

/** App routes that must load offline after one online visit (see vite.config workbox runtimeCaching). */
export const OFFLINE_CORE_ROUTES = ['/calendar', '/jobs', '/clients', '/login'] as const;

let warmInFlight: Promise<void> | null = null;

/**
 * Populate the service worker page cache for core routes.
 * Safe to call multiple times; deduped per tab session.
 */
export async function warmOfflineRouteCache(): Promise<void> {
	if (!browser || !navigator.onLine || !('serviceWorker' in navigator)) return;

	if (!warmInFlight) {
		warmInFlight = (async () => {
			try {
				await navigator.serviceWorker.ready;
				await Promise.allSettled(
					OFFLINE_CORE_ROUTES.map((path) =>
						fetch(path, { credentials: 'same-origin', cache: 'reload' })
					)
				);
			} catch (err) {
				console.warn('[pwa] warmOfflineRouteCache failed', err);
			} finally {
				warmInFlight = null;
			}
		})();
	}

	await warmInFlight;
}