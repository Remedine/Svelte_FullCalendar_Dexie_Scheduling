import { describe, expect, it } from 'vitest';
import {
	OFFLINE_APP_ROUTES,
	OFFLINE_CORE_ROUTES,
	isOfflineAppRoutePath,
	isOfflineCoreRoutePath
} from './offlineCoreRoutes';

describe('OFFLINE_APP_ROUTES', () => {
	it('covers login plus every authenticated shell page', () => {
		expect(OFFLINE_APP_ROUTES).toEqual([
			'/login',
			'/calendar',
			'/calendar/split',
			'/jobs',
			'/clients',
			'/profile',
			'/admin/crew',
			'/admin/options',
			'/admin/import'
		]);
	});

	it('keeps OFFLINE_CORE_ROUTES as an alias', () => {
		expect(OFFLINE_CORE_ROUTES).toBe(OFFLINE_APP_ROUTES);
	});
});

describe('isOfflineAppRoutePath', () => {
	it('matches every app shell route', () => {
		for (const path of OFFLINE_APP_ROUTES) {
			expect(isOfflineAppRoutePath(path)).toBe(true);
			expect(isOfflineCoreRoutePath(path)).toBe(true);
		}
	});

	it('accepts trailing slashes on app routes', () => {
		expect(isOfflineAppRoutePath('/jobs/')).toBe(true);
		expect(isOfflineAppRoutePath('/admin/options/')).toBe(true);
	});

	it('rejects API and unknown paths', () => {
		expect(isOfflineAppRoutePath('/api/health')).toBe(false);
		expect(isOfflineAppRoutePath('/not-a-page')).toBe(false);
		expect(isOfflineAppRoutePath('/')).toBe(false);
	});
});
