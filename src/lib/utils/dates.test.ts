import { describe, it, expect } from 'vitest';
import {
	toLocalDateString,
	getLocalDateString,
	parseLocalDate,
	dateToInputValue,
	inputValueToDate,
	toDateString,
	calculateDueDate,
	hour12To24,
	hour24To12
} from './dates';

describe('toLocalDateString / getLocalDateString', () => {
	it('formats a Date to YYYY-MM-DD using local components', () => {
		const d = new Date(2026, 5, 15); // June 15, 2026 (month is 0-indexed)
		expect(toLocalDateString(d)).toBe('2026-06-15');
		expect(getLocalDateString(d)).toBe('2026-06-15');
	});

	it('pads single-digit month and day', () => {
		const d = new Date(2026, 0, 5); // Jan 5
		expect(toLocalDateString(d)).toBe('2026-01-05');
	});

	it('defaults to today when no argument', () => {
		const result = toLocalDateString();
		expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	it('uses the local day even near midnight', () => {
		// Simulate a date object that might be affected by TZ in naive code
		const d = new Date(2026, 11, 31, 23, 59); // Dec 31
		expect(toLocalDateString(d)).toBe('2026-12-31');
	});
});

describe('parseLocalDate', () => {
	it('parses YYYY-MM-DD into a local midnight Date', () => {
		const d = parseLocalDate('2026-03-07');
		expect(d.getFullYear()).toBe(2026);
		expect(d.getMonth()).toBe(2); // March
		expect(d.getDate()).toBe(7);
		expect(d.getHours()).toBe(0);
	});

	it('returns an invalid Date for bad input', () => {
		const d = parseLocalDate('not-a-date');
		expect(isNaN(d.getTime())).toBe(true);
	});

	it('handles February and leap years at the local level (no UTC shift)', () => {
		const feb = parseLocalDate('2024-02-29'); // 2024 is a leap year
		expect(feb.getMonth()).toBe(1);
		expect(feb.getDate()).toBe(29);
	});
});

describe('dateToInputValue', () => {
	it('returns empty string for null/undefined/empty', () => {
		expect(dateToInputValue(null)).toBe('');
		expect(dateToInputValue(undefined)).toBe('');
		expect(dateToInputValue('')).toBe('');
	});

	it('accepts Date and returns YYYY-MM-DD local', () => {
		const d = new Date(2025, 8, 9); // Sep 9
		expect(dateToInputValue(d)).toBe('2025-09-09');
	});

	it('accepts clean YYYY-MM-DD strings directly (fast path) and handles real Date objects safely', () => {
		// Clean picker-format strings are returned as-is (no Date(string) constructor risk)
		expect(dateToInputValue('2026-07-10')).toBe('2026-07-10');

		// When we have a real Date created with local components, get* methods are trustworthy
		const localDate = new Date(2026, 6, 10); // July 10 local
		expect(dateToInputValue(localDate)).toBe('2026-07-10');
	});

	it('returns empty string for invalid date input', () => {
		expect(dateToInputValue('garbage')).toBe('');
		expect(dateToInputValue(new Date('invalid'))).toBe('');
	});
});

describe('inputValueToDate', () => {
	it('returns undefined for empty / falsy', () => {
		expect(inputValueToDate('')).toBeUndefined();
		expect(inputValueToDate(null as any)).toBeUndefined();
	});

	it('builds a local midnight Date from YYYY-MM-DD input value', () => {
		const d = inputValueToDate('2026-11-03');
		expect(d).toBeInstanceOf(Date);
		expect(d!.getFullYear()).toBe(2026);
		expect(d!.getMonth()).toBe(10); // November
		expect(d!.getDate()).toBe(3);
		expect(d!.getHours()).toBe(0);
	});

	it('returns undefined for malformed / out-of-range strings (after Phase 1 guards)', () => {
		expect(inputValueToDate('2026-13-99')).toBeUndefined();
		expect(inputValueToDate('2026/01/01')).toBeUndefined();
		expect(inputValueToDate('2026-00-01')).toBeUndefined();
	});
});

describe('toDateString (compatibility)', () => {
	it('handles Date objects (local constructor) and clean YYYY-MM-DD strings', () => {
		expect(toDateString(new Date(2026, 3, 1))).toBe('2026-04-01');
		// The fast-path now protects clean strings from TZ shift in new Date(string)
		expect(toDateString('2026-12-25')).toBe('2026-12-25');
	});

	it('returns empty for falsy / invalid', () => {
		expect(toDateString(null)).toBe('');
		expect(toDateString('bad')).toBe('');
	});
});

describe('calculateDueDate (pure, used by ensureInvoiceForJob)', () => {
	it('adds exact days to the base date (no time-of-day mutation on the day part)', () => {
		const base = new Date('2026-08-20T10:00:00');
		const due = calculateDueDate(base, 45);
		expect(due.toISOString().slice(0, 10)).toBe('2026-10-04'); // 20 Aug + 45 days
	});

	it('is pure and does not mutate input', () => {
		const base = new Date('2026-01-01');
		const originalTime = base.getTime();
		calculateDueDate(base, 10);
		expect(base.getTime()).toBe(originalTime);
	});
});

describe('hour24To12 / hour12To24', () => {
	it('converts midnight and noon', () => {
		expect(hour24To12(0)).toEqual({ hour12: 12, period: 'AM' });
		expect(hour24To12(12)).toEqual({ hour12: 12, period: 'PM' });
		expect(hour12To24(12, 'AM')).toBe(0);
		expect(hour12To24(12, 'PM')).toBe(12);
	});

	it('round-trips common morning and afternoon hours', () => {
		for (const hour24 of [1, 7, 11, 13, 19, 23]) {
			const { hour12, period } = hour24To12(hour24);
			expect(hour12To24(hour12, period)).toBe(hour24);
		}
	});
});
