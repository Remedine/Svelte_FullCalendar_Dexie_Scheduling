import { describe, expect, it } from 'vitest';
import {
	dateFromBackupFilename,
	previewRetention,
	shouldKeepBackupDate
} from './retention';

describe('shouldKeepBackupDate', () => {
	it('keeps all backups within 30 days', () => {
		expect(shouldKeepBackupDate('2026-06-15', new Date('2026-06-20T12:00:00Z'))).toBe(true);
		expect(shouldKeepBackupDate('2026-06-01', new Date('2026-06-30T12:00:00Z'))).toBe(true);
	});

	it('keeps monthly anchors between 31 and 90 days', () => {
		const today = new Date('2026-08-15T12:00:00Z');
		expect(shouldKeepBackupDate('2026-06-01', today)).toBe(true);
		expect(shouldKeepBackupDate('2026-06-08', today)).toBe(true);
		expect(shouldKeepBackupDate('2026-06-10', today)).toBe(false);
	});

	it('keeps only 1st of month between 91 days and 1 year', () => {
		const today = new Date('2026-12-01T12:00:00Z');
		expect(shouldKeepBackupDate('2026-08-01', today)).toBe(true);
		expect(shouldKeepBackupDate('2026-08-08', today)).toBe(false);
	});
});

describe('dateFromBackupFilename', () => {
	it('parses legacy MVP filename prefix', () => {
		expect(dateFromBackupFilename('2026-06-30_Capital_City_Windows_Backup.zip')).toBe(
			'2026-06-30'
		);
	});

	it('parses split archive filename prefixes', () => {
		expect(dateFromBackupFilename('2026-06-30_Capital_City_Windows_records.zip')).toBe(
			'2026-06-30'
		);
		expect(dateFromBackupFilename('2026-06-30_Capital_City_Windows_full.zip')).toBe('2026-06-30');
		expect(dateFromBackupFilename('2026-06-30_Capital_City_Windows_sync_queue.json')).toBe(
			'2026-06-30'
		);
	});
});

describe('previewRetention', () => {
	it('counts keep vs prune', () => {
		const today = new Date('2026-08-15T12:00:00Z');
		const result = previewRetention(
			['2026-06-01', '2026-06-08', '2026-06-10', '2026-07-01'],
			today
		);
		expect(result.total).toBe(4);
		expect(result.wouldKeep).toBe(3);
		expect(result.wouldPrune).toBe(1);
	});
});