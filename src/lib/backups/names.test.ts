import { describe, expect, it } from 'vitest';
import {
	backupArtifactKindFromFilename,
	buildFullBackupFilename,
	buildSplitBackupFilename,
	isFullBackupFilename,
	isNonFullBackupArtifact,
	isRestorableBackupFilename
} from './names';

describe('buildFullBackupFilename', () => {
	it('builds daily full archive names', () => {
		expect(buildFullBackupFilename('Capital City Windows', '2026-06-30')).toBe(
			'2026-06-30_Capital_City_Windows_full.zip'
		);
		expect(buildSplitBackupFilename('Capital City Windows', 'full', '2026-06-30')).toBe(
			'2026-06-30_Capital_City_Windows_full.zip'
		);
	});
});

describe('backupArtifactKindFromFilename', () => {
	it('classifies full and retired fragment kinds', () => {
		expect(backupArtifactKindFromFilename('2026-06-30_Biz_records.zip')).toBe('records');
		expect(backupArtifactKindFromFilename('2026-06-30_Biz_files.zip')).toBe('files');
		expect(backupArtifactKindFromFilename('2026-06-30_Biz_full.zip')).toBe('full');
		expect(backupArtifactKindFromFilename('2026-06-30_Biz_sync_queue.json')).toBe('sync_queue');
		expect(backupArtifactKindFromFilename('2026-06-30_Biz_Backup.zip')).toBe('legacy');
	});
});

describe('isRestorableBackupFilename', () => {
	it('allows only full zips (not legacy or fragments)', () => {
		expect(isRestorableBackupFilename('2026-06-30_Biz_full.zip')).toBe(true);
		expect(isFullBackupFilename('2026-06-30_Biz_full.zip')).toBe(true);
		expect(isRestorableBackupFilename('2026-06-30_Biz_Backup.zip')).toBe(false);
		expect(isRestorableBackupFilename('2026-06-30_Biz_records.zip')).toBe(false);
		expect(isRestorableBackupFilename('2026-06-30_Biz_files.zip')).toBe(false);
		expect(isRestorableBackupFilename('2026-06-30_Biz_sync_queue.json')).toBe(false);
	});
});

describe('isNonFullBackupArtifact', () => {
	it('flags fragments and legacy for cleanup', () => {
		expect(isNonFullBackupArtifact('2026-06-30_Biz_records.zip')).toBe(true);
		expect(isNonFullBackupArtifact('2026-06-30_Biz_files.zip')).toBe(true);
		expect(isNonFullBackupArtifact('2026-06-30_Biz_sync_queue.json')).toBe(true);
		expect(isNonFullBackupArtifact('2026-06-30_Biz_Backup.zip')).toBe(true);
		expect(isNonFullBackupArtifact('2026-06-30_Biz_full.zip')).toBe(false);
	});
});
