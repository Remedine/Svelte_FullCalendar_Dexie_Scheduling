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

/** Spec §14.2: YYYY-MM-DD_{Business Name}_Backup.zip */
export function buildBackupFilename(businessName: string, date?: string): string {
	const d = date ?? backupDateInAlaska();
	return `${d}_${sanitizeBusinessName(businessName)}_Backup.zip`;
}

/** Parse comma/semicolon/newline-separated alert emails. */
export function parseAlertEmails(raw: string | undefined | null): string[] {
	if (!raw?.trim()) return [];
	return raw
		.split(/[,;\n]+/)
		.map((e) => e.trim().toLowerCase())
		.filter((e) => e.includes('@'));
}