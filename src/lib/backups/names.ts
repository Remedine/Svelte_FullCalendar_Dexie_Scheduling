const BACKUP_TZ = 'America/Anchorage';

/** Calendar date in Alaska time as YYYY-MM-DD (for backup filenames). */
export function backupDateInAlaska(now = new Date()): string {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: BACKUP_TZ,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(now);
}

/** Sanitize business name for filesystem-safe backup filenames. */
export function sanitizeBusinessName(name: string): string {
	const cleaned = (name || 'Business')
		.trim()
		.replace(/[^a-zA-Z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.slice(0, 50);
	return cleaned || 'Business';
}

export type BackupArtifactKind = 'records' | 'files' | 'full' | 'legacy' | 'sync_queue';

/** Spec §14.2 legacy MVP name — still accepted for restore/upload. */
export function buildBackupFilename(businessName: string, date?: string): string {
	const d = date ?? backupDateInAlaska();
	return `${d}_${sanitizeBusinessName(businessName)}_Backup.zip`;
}

/** Spec §14.3 split archive artifact names. */
export function buildSplitBackupFilename(
	businessName: string,
	kind: 'records' | 'files' | 'full',
	date?: string
): string {
	const d = date ?? backupDateInAlaska();
	return `${d}_${sanitizeBusinessName(businessName)}_${kind}.zip`;
}

export function buildSyncQueueFilename(businessName: string, date?: string): string {
	const d = date ?? backupDateInAlaska();
	return `${d}_${sanitizeBusinessName(businessName)}_sync_queue.json`;
}

export function backupArtifactKindFromFilename(filename: string): BackupArtifactKind {
	const lower = filename.toLowerCase();
	if (lower.endsWith('_sync_queue.json')) return 'sync_queue';
	if (lower.endsWith('_records.zip')) return 'records';
	if (lower.endsWith('_files.zip')) return 'files';
	if (lower.endsWith('_full.zip')) return 'full';
	return 'legacy';
}

/** Only full native zips and legacy MVP archives can use pb.RestoreBackup. */
export function isRestorableBackupFilename(filename: string): boolean {
	const kind = backupArtifactKindFromFilename(filename);
	return kind === 'full' || kind === 'legacy';
}

/** Parse comma/semicolon/newline-separated alert emails. */
export function parseAlertEmails(raw: string | undefined | null): string[] {
	if (!raw?.trim()) return [];
	return raw
		.split(/[,;\n]+/)
		.map((e) => e.trim().toLowerCase())
		.filter((e) => e.includes('@'));
}