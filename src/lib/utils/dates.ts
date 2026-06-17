/**
 * Pure date utilities for consistent local (calendar-day) handling.
 *
 * The app has a long history of timezone bugs with <input type="date"> / due dates / paid dates
 * and calendar navigation (especially relevant for Alaska local time).
 *
 * These helpers always treat "YYYY-MM-DD" strings as local midnight dates using
 * `new Date(year, monthIndex, day)` (no UTC conversion).
 *
 * )=- Extracted in Phase 1 of TESTING_PLAN.md so the logic can be thoroughly unit tested
 * and reused everywhere instead of being duplicated inside components.
 * Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling + JOBS_AND_INVOICES_SPEC.md
 */

export function toLocalDateString(date: Date = new Date()): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

/**
 * Parse a "YYYY-MM-DD" string into a Date at local midnight.
 * This is the safe counterpart to the browser date picker.
 *
 * )=- Phase 1: added the same month/day range guards as inputValueToDate for consistency.
 */
export function parseLocalDate(dateStr: string): Date {
	const [y, m, d] = dateStr.split('-').map(Number);
	if (!y || !m || !d) {
		return new Date(NaN);
	}
	if (m < 1 || m > 12 || d < 1 || d > 31) {
		return new Date(NaN);
	}
	return new Date(y, m - 1, d);
}

/**
 * Convert a Date (or string) to "YYYY-MM-DD" suitable for <input type="date"> / dueDate fields.
 * Preserves the local calendar day (the whole reason these helpers exist).
 *
 * )=- Improved in Phase 1 after tests exposed the classic string-Date UTC shift.
 * If the input is already a clean YYYY-MM-DD string we return it directly (no Date constructor).
 * Only real Date objects go through getFullYear/getMonth/getDate (which are safe when the Date
 * was created with the local constructor).
 */
export function dateToInputValue(d: Date | string | undefined | null): string {
	if (!d) return '';
	if (typeof d === 'string') {
		// Fast path: already in the expected picker format. Avoids new Date(string) entirely.
		if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
		// Fall back for other string forms (e.g. full ISO from server) — still risky but better than before
		const parsed = new Date(d);
		if (isNaN(parsed.getTime())) return '';
		d = parsed;
	}
	if (isNaN(d.getTime())) return '';
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

/**
 * Convert a "YYYY-MM-DD" value from a date input back into a local Date.
 *
 * )=- Phase 1 improvement: added range guards. The native Date constructor happily
 * normalizes invalid months/days (e.g. month 13 or day 99), which would produce
 * surprising dates downstream. We now reject obvious garbage early.
 */
export function inputValueToDate(val: string): Date | undefined {
	if (!val) return undefined;
	const [y, m, d] = val.split('-').map(Number);
	if (!y || !m || !d) return undefined;
	if (m < 1 || m > 12) return undefined;
	if (d < 1 || d > 31) return undefined; // loose upper bound is acceptable here
	return new Date(y, m - 1, d);
}

/**
 * Generic "to YYYY-MM-DD string" that accepts Date or anything Date can parse.
 * Kept for compatibility with existing calendar code.
 *
 * )=- Phase 1 hardening: same fast-path for clean YYYY-MM-DD strings as dateToInputValue.
 */
export function toDateString(d: any): string {
	if (!d) return '';
	if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
		return d;
	}
	const date = d instanceof Date ? d : new Date(d);
	if (isNaN(date.getTime())) return '';
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

// Convenience re-exports of the most common names used before extraction
export { toLocalDateString as getLocalDateString };

/**
 * Calculate due date for an invoice: base (usually job.end) + N days.
 * Pure and easy to unit test in isolation.
 *
 * )=- Extracted as part of Phase 2 to make ensureInvoiceForJob more testable
 * and to centralize the "dueDays from options" arithmetic (previously inline).
 * Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling + JOBS_AND_INVOICES_SPEC.md
 */
export function calculateDueDate(base: Date, days: number): Date {
	return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Default invoice due date: job end (or today when unset) + invoiceDueDays from options. */
export function getInvoiceDueDateForJob(
	job: { end?: Date | string | null },
	invoiceDueDays: number = 30
): Date {
	const base = job.end ? new Date(job.end) : new Date();
	return calculateDueDate(base, invoiceDueDays);
}

export type Hour12Period = 'AM' | 'PM';

/** Convert 24-hour clock (0–23) to 12-hour display parts. */
export function hour24To12(hour24: number): { hour12: number; period: Hour12Period } {
	if (!Number.isInteger(hour24) || hour24 < 0 || hour24 > 23) {
		return { hour12: 7, period: 'AM' };
	}
	const period: Hour12Period = hour24 < 12 ? 'AM' : 'PM';
	const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
	return { hour12, period };
}

/** Convert 12-hour clock (1–12 + AM/PM) to 24-hour (0–23). */
export function hour12To24(hour12: number, period: Hour12Period): number {
	if (!Number.isInteger(hour12) || hour12 < 1 || hour12 > 12) {
		return NaN;
	}
	if (period === 'AM') {
		return hour12 === 12 ? 0 : hour12;
	}
	return hour12 === 12 ? 12 : hour12 + 12;
}
