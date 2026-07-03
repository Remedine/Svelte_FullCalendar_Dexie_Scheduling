/** App routes that must load offline after one online visit (see vite.config workbox runtimeCaching). */
export const OFFLINE_CORE_ROUTES = ['/calendar', '/jobs', '/clients', '/login'] as const;

export function isOfflineCoreRoutePath(pathname: string): boolean {
	return (OFFLINE_CORE_ROUTES as readonly string[]).includes(pathname);
}