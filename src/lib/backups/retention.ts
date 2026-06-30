import { backupDateInAlaska } from './names';

const BACKUP_TZ = 'America/Anchorage';

type AlaskaParts = { year: number; month: number; day: number };

function alaskaPartsFromDateString(dateStr: string): AlaskaParts | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
	if (!m) return null;
	return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

function daysInMonth(year: number, month: number): number {
	return new Date(year, month, 0).getDate();
}

/** Monthly anchor days for 31–90 day retention (Feb uses last day of month). */
function isMonthlyAnchorDay(parts: AlaskaParts): boolean {
	const anchors = [1, 8, 15, 22, 29];
	if (anchors.includes(parts.day)) return true;
	const last = daysInMonth(parts.year, parts.month);
	return parts.day === last;
}

/** Whether a backup dated `backupDate` (YYYY-MM-DD Alaska) should be kept per spec §14.4. */
export function shouldKeepBackupDate(backupDate: string, today = new Date()): boolean {
	const parts = alaskaPartsFromDateString(backupDate);
	if (!parts) return false;

	const todayStr = backupDateInAlaska(today);
	const todayParts = alaskaPartsFromDateString(todayStr);
	if (!todayParts) return false;

	const ageDays = Math.floor(
		(Date.parse(`${todayStr}T12:00:00Z`) - Date.parse(`${backupDate}T12:00:00Z`)) /
			(24 * 60 * 60 * 1000)
	);

	if (ageDays < 0) return true;
	if (ageDays <= 30) return true;
	if (ageDays <= 90) return isMonthlyAnchorDay(parts);
	if (ageDays <= 365) return parts.day === 1;

	const ageYears = ageDays / 365;
	if (ageYears <= 7) {
		return parts.day === 1 && [1, 4, 7, 10].includes(parts.month);
	}

	return parts.day === 1 && parts.month === 1;
}

export type RetentionPreview = {
	total: number;
	wouldKeep: number;
	wouldPrune: number;
};

/** Summarize retention for a list of backup date strings (from filenames). */
export function previewRetention(dates: string[], today = new Date()): RetentionPreview {
	const unique = [...new Set(dates.filter(Boolean))];
	let wouldKeep = 0;
	for (const d of unique) {
		if (shouldKeepBackupDate(d, today)) wouldKeep++;
	}
	return {
		total: unique.length,
		wouldKeep,
		wouldPrune: unique.length - wouldKeep
	};
}

/** Extract YYYY-MM-DD prefix from a backup filename. */
export function dateFromBackupFilename(filename: string): string | null {
	const m = /^(\d{4}-\d{2}-\d{2})_/.exec(filename);
	return m?.[1] ?? null;
}