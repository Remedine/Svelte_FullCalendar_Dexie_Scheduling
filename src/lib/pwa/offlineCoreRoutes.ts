/**
 * App document routes prefetched into the service worker page cache after login
 * (see warmOfflineRouteCache + vite.config workbox runtimeCaching).
 *
 * Includes every client-facing shell path so hard navigation / PWA reopen works
 * offline without first visiting each page while online. API and PocketBase
 * endpoints stay network-only; app data is served from Dexie.
 */
export const OFFLINE_APP_ROUTES = [
	'/login',
	'/calendar',
	'/calendar/split',
	'/jobs',
	'/clients',
	'/profile',
	'/admin/crew',
	'/admin/options',
	'/admin/import'
] as const;

/** @deprecated Prefer OFFLINE_APP_ROUTES — kept as alias for existing imports. */
export const OFFLINE_CORE_ROUTES = OFFLINE_APP_ROUTES;

export function isOfflineAppRoutePath(pathname: string): boolean {
	const path = pathname.endsWith('/') && pathname.length > 1 ? pathname.slice(0, -1) : pathname;
	return (OFFLINE_APP_ROUTES as readonly string[]).includes(path);
}

/** @deprecated Prefer isOfflineAppRoutePath */
export function isOfflineCoreRoutePath(pathname: string): boolean {
	return isOfflineAppRoutePath(pathname);
}
