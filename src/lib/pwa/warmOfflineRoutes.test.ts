import { describe, expect, it } from 'vitest';
import { OFFLINE_CORE_ROUTES } from './warmOfflineRoutes';

describe('OFFLINE_CORE_ROUTES', () => {
	it('includes calendar, jobs, clients, and login', () => {
		expect(OFFLINE_CORE_ROUTES).toEqual(['/calendar', '/jobs', '/clients', '/login']);
	});
});