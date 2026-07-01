import { describe, expect, it } from 'vitest';
import { alaskaHourNow, shouldRunScheduledBackup } from './schedule';

describe('alaskaHourNow', () => {
	it('returns hour in Anchorage timezone', () => {
		// 2026-07-02 07:00 UTC = 2026-07-01 23:00 AKDT
		expect(alaskaHourNow(new Date('2026-07-02T07:00:00Z'))).toBe(23);
	});
});

describe('shouldRunScheduledBackup', () => {
	it('runs at configured Alaska hour when enabled and not yet run today', () => {
		const now = new Date('2026-07-02T07:00:00Z');
		const result = shouldRunScheduledBackup(
			{
				backupScheduledEnabled: true,
				backupScheduledHour: 23,
				lastScheduledBackupDate: '2026-06-30'
			},
			now
		);
		expect(result.run).toBe(true);
	});

	it('skips when already ran today', () => {
		const now = new Date('2026-07-02T07:00:00Z');
		const result = shouldRunScheduledBackup(
			{
				backupScheduledEnabled: true,
				backupScheduledHour: 23,
				lastScheduledBackupDate: '2026-07-01'
			},
			now
		);
		expect(result.run).toBe(false);
		expect(result.reason).toMatch(/Already ran/i);
	});

	it('skips outside scheduled hour', () => {
		const now = new Date('2026-07-02T08:00:00Z');
		const result = shouldRunScheduledBackup(
			{
				backupScheduledEnabled: true,
				backupScheduledHour: 23,
				lastScheduledBackupDate: ''
			},
			now
		);
		expect(result.run).toBe(false);
		expect(result.reason).toMatch(/Not scheduled hour/i);
	});
});