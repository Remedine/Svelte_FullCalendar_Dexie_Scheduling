import { browser } from '$app/environment';
import { OFFLINE_CORE_ROUTES } from './offlineCoreRoutes';

export { OFFLINE_CORE_ROUTES } from './offlineCoreRoutes';

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
						fetch(path, {
							credentials: 'same-origin',
							cache: 'reload',
							headers: { Accept: 'text/html' }
						})
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