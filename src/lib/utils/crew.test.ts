import { describe, it, expect } from 'vitest';
import { getUserDisplayName, isJobAssignedToCrew } from './crew';

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
});