import { describe, it, expect, beforeEach } from 'vitest';
import {
	canRunStaleUserDelete,
	mergeAuthUserIntoLocal,
	cleanupDuplicateUsers,
	resolveUserEmail,
	mergeServerUserOverLocal
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

describe('resolveUserEmail', () => {
	it('prefers PB email when present', () => {
		expect(resolveUserEmail({ id: '1', email: 'joe@example.com' }, { email: 'old@example.com' } as any)).toBe(
			'joe@example.com'
		);
	});

	it('keeps local email when PB omits it (list rule privacy)', () => {
		expect(resolveUserEmail({ id: '1' }, { email: 'brick@example.com' } as any)).toBe('brick@example.com');
	});

	it('uses auth email for current user self-sync', () => {
		expect(resolveUserEmail({ id: '1' }, undefined, 'tim@example.com')).toBe('tim@example.com');
	});
});

describe('mergeServerUserOverLocal', () => {
	it('patches missing email when local updatedAt is newer', () => {
		const local = {
			id: 'local-1',
			pbId: 'pb-1',
			email: '',
			firstName: 'Joe2',
			lastName: 'Poe2',
			name: 'Joe2 Poe2',
			role: 'admin' as const,
			updatedAt: new Date('2026-06-16T18:45:16Z'),
			createdAt: new Date('2026-06-16T18:40:15Z'),
			active: true
		};
		const server = {
			...local,
			email: 'joe2@example.com',
			updatedAt: new Date('2026-06-16T18:40:15Z')
		};

		const merged = mergeServerUserOverLocal(local as any, server as any);
		expect(merged.email).toBe('joe2@example.com');
		expect(merged.id).toBe('local-1');
		expect(merged.updatedAt).toEqual(local.updatedAt);
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