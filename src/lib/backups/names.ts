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

/** Known backup filename kinds (full is the only supported product artifact). */
export type BackupArtifactKind = 'full' | 'records' | 'files' | 'legacy' | 'sync_queue' | 'other';

/** Daily restorable archive name: `YYYY-MM-DD_{Business}_full.zip`. */
export function buildFullBackupFilename(businessName: string, date?: string): string {
	const d = date ?? backupDateInAlaska();
	return `${d}_${sanitizeBusinessName(businessName)}_full.zip`;
}

/** @deprecated Prefer buildFullBackupFilename — kept for tests/migration parsing. */
export function buildSplitBackupFilename(
	businessName: string,
	kind: 'records' | 'files' | 'full',
	date?: string
): string {
	const d = date ?? backupDateInAlaska();
	return `${d}_${sanitizeBusinessName(businessName)}_${kind}.zip`;
}

export function backupArtifactKindFromFilename(filename: string): BackupArtifactKind {
	const lower = filename.toLowerCase();
	if (lower.endsWith('_sync_queue.json')) return 'sync_queue';
	if (lower.endsWith('_records.zip')) return 'records';
	if (lower.endsWith('_files.zip')) return 'files';
	if (lower.endsWith('_full.zip')) return 'full';
	if (lower.endsWith('_backup.zip')) return 'legacy';
	return 'other';
}

/** Only daily full native zips are restorable in-app. */
export function isFullBackupFilename(filename: string): boolean {
	return backupArtifactKindFromFilename(filename) === 'full';
}

/** Alias used by restore APIs — full zips only (legacy no longer accepted). */
export function isRestorableBackupFilename(filename: string): boolean {
	return isFullBackupFilename(filename);
}

/** Fragment / legacy files that should be cleaned up (not restorable full zips). */
export function isNonFullBackupArtifact(filename: string): boolean {
	const kind = backupArtifactKindFromFilename(filename);
	return kind === 'records' || kind === 'files' || kind === 'legacy' || kind === 'sync_queue';
}

/** Parse comma/semicolon/newline-separated alert emails. */
export function parseAlertEmails(raw: string | undefined | null): string[] {
	if (!raw?.trim()) return [];
	return raw
		.split(/[,;\n]+/)
		.map((e) => e.trim().toLowerCase())
		.filter((e) => e.includes('@'));
}
