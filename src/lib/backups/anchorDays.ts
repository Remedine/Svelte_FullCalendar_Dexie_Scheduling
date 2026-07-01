import { backupDateInAlaska } from './names';

type AlaskaParts = { year: number; month: number; day: number };

function alaskaPartsFromDateString(dateStr: string): AlaskaParts | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
	if (!m) return null;
	return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

function daysInMonth(year: number, month: number): number {
	return new Date(year, month, 0).getDate();
}

/** Retention anchor days per spec §14.3 — also trigger a full native zip backup. */
export function isRetentionAnchorDay(dateStr = backupDateInAlaska()): boolean {
	const parts = alaskaPartsFromDateString(dateStr);
	if (!parts) return false;
	const anchors = [1, 8, 15, 22, 29];
	if (anchors.includes(parts.day)) return true;
	return parts.day === daysInMonth(parts.year, parts.month);
}