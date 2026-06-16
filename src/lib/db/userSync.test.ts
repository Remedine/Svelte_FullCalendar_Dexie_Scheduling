import { describe, it, expect, beforeEach } from 'vitest';
import {
	canRunStaleUserDelete,
	mergeAuthUserIntoLocal,
	cleanupDuplicateUsers
} from '$lib/db/userSync';
import { db } from '$lib/db';

describe('canRunStaleUserDelete', () => {
	it('refuses empty roster', () => {
		expect(canRunStaleUserDelete(new Set(), 0)).toBe(false);
		expect(canRunStaleUserDelete(new Set(), 3)).toBe(false);
	});

	it('refuses partial roster', () => {
		expect(canRunStaleUserDelete(new Set(['a']), 3)).toBe(false);
	});

	it('allows full roster', () => {
		expect(canRunStaleUserDelete(new Set(['a', 'b', 'c']), 3)).toBe(true);
	});
});

describe('mergeAuthUserIntoLocal', () => {
	it('preserves local UUID and stamps pbId on hybrid login', () => {
		const existing = {
			id: 'local-uuid',
			pbId: '0fa0o3w39qb5r9f',
			email: 'joe@example.com',
			firstName: 'Joe',
			lastName: 'Poe',
			name: 'Joe Poe',
			role: 'crew' as const,
			pinHash: '',
			active: true,
			forcePinUpdate: false,
			forcePhotoUpdate: true,
			createdAt: new Date(),
			updatedAt: new Date()
		};

		const merged = mergeAuthUserIntoLocal(
			{
				id: '0fa0o3w39qb5r9f',
				verified: true,
				email: 'joe@example.com',
				role: 'admin'
			},
			'joe@example.com',
			existing
		);

		expect(merged.id).toBe('local-uuid');
		expect(merged.pbId).toBe('0fa0o3w39qb5r9f');
		expect(merged.verified).toBe(true);
	});

	it('sets pbId on pure PB login row', () => {
		const merged = mergeAuthUserIntoLocal(
			{ id: 'pb-only-id', verified: true, name: 'Tim', role: 'admin' },
			'tim@example.com'
		);
		expect(merged.id).toBe('pb-only-id');
		expect(merged.pbId).toBe('pb-only-id');
	});
});

describe('cleanupDuplicateUsers by pbId', () => {
	beforeEach(async () => {
		await db.users.clear();
	});

	it('merges pbId onto kept row when duplicates share pbId', async () => {
		await db.users.put({
			id: 'uuid-1',
			email: 'a@example.com',
			firstName: 'A',
			lastName: 'User',
			name: 'A User',
			role: 'crew',
			active: true,
			createdAt: new Date(),
			updatedAt: new Date()
		} as any);

		await db.users.put({
			id: 'pb-1',
			pbId: 'pb-1',
			email: 'a@example.com',
			name: 'a',
			role: 'crew',
			active: true,
			createdAt: new Date(),
			updatedAt: new Date()
		} as any);

		await cleanupDuplicateUsers();

		const remaining = await db.users.toArray();
		expect(remaining.length).toBe(1);
		expect(remaining[0].id).toBe('uuid-1');
		expect(remaining[0].pbId).toBe('pb-1');
	});
});