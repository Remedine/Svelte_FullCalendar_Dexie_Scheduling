import { describe, it, expect } from 'vitest';
import {
	computeCrewNotificationSendAt,
	isCrewNotificationDue,
	clientPrefersEmailBilling
} from './crewSchedule';

describe('computeCrewNotificationSendAt', () => {
	it('subtracts days and sets hour in local time', () => {
		const jobStart = new Date(2026, 5, 20, 14, 30); // Jun 20 2026 2:30pm
		const sendAt = computeCrewNotificationSendAt(jobStart, 2, 7);
		expect(sendAt.getFullYear()).toBe(2026);
		expect(sendAt.getMonth()).toBe(5);
		expect(sendAt.getDate()).toBe(18);
		expect(sendAt.getHours()).toBe(7);
		expect(sendAt.getMinutes()).toBe(0);
	});
});

describe('isCrewNotificationDue', () => {
	it('returns true when now is past scheduled time', () => {
		const scheduled = new Date(2020, 0, 1, 8, 0);
		expect(isCrewNotificationDue(scheduled, new Date(2026, 0, 1))).toBe(true);
	});
});

describe('clientPrefersEmailBilling', () => {
	it('is true only for email preference', () => {
		expect(clientPrefersEmailBilling('email')).toBe(true);
		expect(clientPrefersEmailBilling('check')).toBe(false);
	});
});