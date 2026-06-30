import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$app/environment', () => ({
	browser: true,
	dev: true
}));

import {
	getLastLoginEmail,
	setLastLoginEmail,
	persistAppSession,
	clearAppSession,
	restorePbAuthFromAppSession
} from './sessionPersist';

describe('sessionPersist', () => {
	beforeEach(async () => {
		localStorage.clear();
		const { db } = await import('$lib/db');
		await db.appSession.clear();
		const { pb } = await import('$lib/db/pb');
		pb.authStore.clear();
	});

	it('stores and reads last login email', () => {
		expect(getLastLoginEmail()).toBe('');
		setLastLoginEmail(' Crew@Example.COM ');
		expect(getLastLoginEmail()).toBe('crew@example.com');
	});

	it('persistAppSession writes durable markers and PB backup', async () => {
		const { pb } = await import('$lib/db/pb');
		pb.authStore.save('test-token', {
			id: 'pb-1',
			email: 'crew@example.com',
			collectionId: 'users',
			collectionName: 'users'
		} as any);

		await persistAppSession({ userId: 'local-1', email: 'crew@example.com' });

		expect(localStorage.getItem('currentUserId')).toBe('local-1');
		expect(getLastLoginEmail()).toBe('crew@example.com');

		const { db } = await import('$lib/db');
		const row = await db.appSession.get('current');
		expect(row?.currentUserId).toBe('local-1');
		expect(row?.email).toBe('crew@example.com');
		expect(row?.pbToken).toBe('test-token');
		expect(row?.pbModelJson).toContain('crew@example.com');
	});

	it('restorePbAuthFromAppSession recovers cleared PB authStore', async () => {
		const { pb } = await import('$lib/db/pb');
		pb.authStore.save('backup-token', {
			id: 'pb-1',
			email: 'crew@example.com',
			collectionId: 'users',
			collectionName: 'users'
		} as any);
		await persistAppSession({ userId: 'local-1', email: 'crew@example.com' });

		pb.authStore.clear();
		expect(pb.authStore.token).toBe('');

		const restored = await restorePbAuthFromAppSession();
		expect(restored).toBe(true);
		expect(pb.authStore.token).toBe('backup-token');
		expect(pb.authStore.model?.email).toBe('crew@example.com');
	});

	it('clearAppSession removes auth markers but keeps last email', async () => {
		await persistAppSession({ userId: 'local-1', email: 'crew@example.com' });
		await clearAppSession();

		expect(localStorage.getItem('currentUserId')).toBeNull();
		const { db } = await import('$lib/db');
		await expect(db.appSession.get('current')).resolves.toBeUndefined();
		expect(getLastLoginEmail()).toBe('crew@example.com');
	});
});