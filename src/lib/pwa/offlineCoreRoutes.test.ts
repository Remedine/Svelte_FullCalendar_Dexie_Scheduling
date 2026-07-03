import { describe, expect, it } from 'vitest';
import { OFFLINE_CORE_ROUTES, isOfflineCoreRoutePath } from './offlineCoreRoutes';

describe('OFFLINE_CORE_ROUTES', () => {
	it('includes calendar, jobs, clients, and login', () => {
		expect(OFFLINE_CORE_ROUTES).toEqual(['/calendar', '/jobs', '/clients', '/login']);
	});
});

describe('isOfflineCoreRoutePath', () => {
	it('matches core CRM routes', () => {
		for (const path of OFFLINE_CORE_ROUTES) {
			expect(isOfflineCoreRoutePath(path)).toBe(true);
		}
	});

	it('rejects unrelated paths', () => {
		expect(isOfflineCoreRoutePath('/profile')).toBe(false);
		expect(isOfflineCoreRoutePath('/api/health')).toBe(false);
	});
});