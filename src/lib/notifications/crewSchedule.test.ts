import { describe, expect, it } from 'vitest';
import {
	crewNotificationLogKey,
	isCrewNotificationCronWindow,
	shouldSendCrewNotification
} from './crewSchedule';

describe('isCrewNotificationCronWindow', () => {
	it('matches configured Alaska hour only', () => {
		// 2026-07-02 15:00 UTC = 07:00 AKDT
		expect(isCrewNotificationCronWindow(7, new Date('2026-07-02T15:00:00Z'))).toBe(true);
		expect(isCrewNotificationCronWindow(8, new Date('2026-07-02T15:00:00Z'))).toBe(false);
	});
});

describe('shouldSendCrewNotification', () => {
	const jobStart = '2026-07-10T18:00:00.000Z';

	it('sends on the notification day at the configured hour', () => {
		// 1 day before July 10 job → July 9 at 7 AM Alaska ≈ 2026-07-09 15:00 UTC (AKDT)
		const now = new Date('2026-07-09T15:00:00Z');
		expect(shouldSendCrewNotification(jobStart, 1, 7, now)).toBe(true);
	});

	it('does not send before the notification day', () => {
		const now = new Date('2026-07-08T15:00:00Z');
		expect(shouldSendCrewNotification(jobStart, 1, 7, now)).toBe(false);
	});

	it('does not send on notification day outside configured hour', () => {
		const now = new Date('2026-07-09T16:00:00Z');
		expect(shouldSendCrewNotification(jobStart, 1, 7, now)).toBe(false);
	});
});

describe('crewNotificationLogKey', () => {
	it('builds stable dedup key', () => {
		expect(crewNotificationLogKey('job1', 'Alice')).toBe('email::job1::Alice');
	});
});