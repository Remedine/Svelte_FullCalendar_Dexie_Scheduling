import { describe, expect, it } from 'vitest';
import {
	backupArtifactKindFromFilename,
	buildSplitBackupFilename,
	buildSyncQueueFilename,
	isRestorableBackupFilename
} from './names';

describe('split backup filenames', () => {
	it('builds records, files, and sync queue names', () => {
		expect(buildSplitBackupFilename('Capital City Windows', 'records', '2026-06-30')).toBe(
			'2026-06-30_Capital_City_Windows_records.zip'
		);
		expect(buildSplitBackupFilename('Capital City Windows', 'full', '2026-06-30')).toBe(
			'2026-06-30_Capital_City_Windows_full.zip'
		);
		expect(buildSyncQueueFilename('Capital City Windows', '2026-06-30')).toBe(
			'2026-06-30_Capital_City_Windows_sync_queue.json'
		);
	});
});

describe('backupArtifactKindFromFilename', () => {
	it('classifies split and legacy artifacts', () => {
		expect(backupArtifactKindFromFilename('2026-06-30_Biz_records.zip')).toBe('records');
		expect(backupArtifactKindFromFilename('2026-06-30_Biz_files.zip')).toBe('files');
		expect(backupArtifactKindFromFilename('2026-06-30_Biz_full.zip')).toBe('full');
		expect(backupArtifactKindFromFilename('2026-06-30_Biz_sync_queue.json')).toBe('sync_queue');
		expect(backupArtifactKindFromFilename('2026-06-30_Biz_Backup.zip')).toBe('legacy');
	});
});

describe('isRestorableBackupFilename', () => {
	it('allows only full and legacy zips', () => {
		expect(isRestorableBackupFilename('2026-06-30_Biz_full.zip')).toBe(true);
		expect(isRestorableBackupFilename('2026-06-30_Biz_Backup.zip')).toBe(true);
		expect(isRestorableBackupFilename('2026-06-30_Biz_records.zip')).toBe(false);
		expect(isRestorableBackupFilename('2026-06-30_Biz_files.zip')).toBe(false);
		expect(isRestorableBackupFilename('2026-06-30_Biz_sync_queue.json')).toBe(false);
	});
});