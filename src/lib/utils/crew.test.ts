import { describe, it, expect } from 'vitest';
import {
	getUserDisplayName,
	isJobAssignedToCrew,
	userIdentityKey,
	pickPreferredCrewUser,
	getCrewNameAliases,
	buildCanonicalCrewDirectory,
	isJobAssignedToAnyCrewFilter,
	resolveCrewCanonicalName
} from './crew';

describe('crew utils', () => {
	it('getUserDisplayName prefers name then first/last', () => {
		expect(getUserDisplayName({ name: 'Alex Crew' })).toBe('Alex Crew');
		expect(getUserDisplayName({ firstName: 'Alex', lastName: 'Crew' })).toBe('Alex Crew');
	});

	it('isJobAssignedToCrew matches trimmed crew names', () => {
		const job = { assignedCrew: [' Alex Crew ', 'Sam'] };
		expect(isJobAssignedToCrew(job, 'Alex Crew')).toBe(true);
		expect(isJobAssignedToCrew(job, 'Sam')).toBe(true);
		expect(isJobAssignedToCrew(job, 'Nobody')).toBe(false);
	});

	it('userIdentityKey prefers pbId then email then id', () => {
		expect(userIdentityKey({ pbId: 'pb1', email: 'a@b.com', id: 'x' })).toBe('pb:pb1');
		expect(userIdentityKey({ email: 'A@B.com', id: 'x' })).toBe('email:a@b.com');
		expect(userIdentityKey({ id: 'local-1' })).toBe('id:local-1');
	});

	it('pickPreferredCrewUser prefers pbId + complete name + photo', () => {
		const thin = { id: 'a', firstName: 'Jo', name: 'Jo' };
		const rich = {
			id: 'b',
			pbId: 'pb',
			firstName: 'Jo',
			lastName: 'Smith',
			name: 'Jo Smith',
			photo: 'data:x'
		};
		expect(pickPreferredCrewUser(thin, rich)).toBe(rich);
	});

	it('getCrewNameAliases includes full name and first name', () => {
		const aliases = getCrewNameAliases({
			name: 'Alex Crew',
			firstName: 'Alex',
			lastName: 'Crew'
		});
		expect(aliases).toContain('Alex Crew');
		expect(aliases).toContain('Alex');
	});

	it('buildCanonicalCrewDirectory collapses Dexie dupes and same display names', () => {
		const { options, aliasToCanonical, users } = buildCanonicalCrewDirectory([
			{
				id: 'local-uuid',
				email: 'alex@example.com',
				firstName: 'Alex',
				lastName: 'Crew',
				name: 'Alex Crew'
			},
			{
				id: 'pb-row',
				pbId: 'pb-alex',
				email: 'alex@example.com',
				firstName: 'Alex',
				lastName: 'Crew',
				name: 'Alex Crew',
				photo: 'pic.png'
			},
			{
				id: 'sam',
				pbId: 'pb-sam',
				name: 'Sam Helper',
				firstName: 'Sam',
				lastName: 'Helper'
			},
			// inactive ignored
			{ id: 'gone', name: 'Old Guy', active: false }
		]);

		expect(options).toEqual(['Alex Crew', 'Sam Helper']);
		expect(users).toHaveLength(2);
		// preferred alex row has photo + pbId
		expect(users.find((u) => getUserDisplayName(u) === 'Alex Crew')?.pbId).toBe('pb-alex');
		expect(resolveCrewCanonicalName('Alex', aliasToCanonical)).toBe('Alex Crew');
		expect(resolveCrewCanonicalName('alex crew', aliasToCanonical)).toBe('Alex Crew');
	});

	it('buildCanonicalCrewDirectory does not add job-only orphan names', () => {
		// directory is users-only; orphans are intentionally omitted from options
		const { options } = buildCanonicalCrewDirectory([
			{ id: '1', pbId: 'p1', name: 'Only Real', firstName: 'Only', lastName: 'Real' }
		]);
		expect(options).toEqual(['Only Real']);
		expect(options).not.toContain('Ghost From Job');
	});

	it('isJobAssignedToAnyCrewFilter matches via alias map after renames', () => {
		const { aliasToCanonical } = buildCanonicalCrewDirectory([
			{
				id: '1',
				pbId: 'p1',
				name: 'New Name',
				firstName: 'New',
				lastName: 'Name'
			}
		]);
		// Job still has first-name-only string
		const job = { assignedCrew: ['New'] };
		expect(isJobAssignedToAnyCrewFilter(job, ['New Name'], aliasToCanonical)).toBe(true);
		expect(isJobAssignedToAnyCrewFilter(job, ['Other'], aliasToCanonical)).toBe(false);
	});
});
