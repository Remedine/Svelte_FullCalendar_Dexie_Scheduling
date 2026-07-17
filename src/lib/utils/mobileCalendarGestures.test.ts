import { describe, expect, it } from 'vitest';
import {
	formatMobileAppointmentHud,
	formatMobileDuration,
	formatMobileTime,
	formatMobileTimeRange,
	MOBILE_GESTURE_DEFAULTS
} from './mobileCalendarGestures';

describe('mobileCalendarGestures', () => {
	it('formats times in a short, HUD-friendly style', () => {
		const d = new Date(2026, 0, 15, 14, 30, 0);
		const text = formatMobileTime(d, 'en-US');
		expect(text).toMatch(/2:30/);
		expect(text.toLowerCase()).toMatch(/pm/);
	});

	it('formats a start–end range for the live move HUD', () => {
		const start = new Date(2026, 0, 15, 9, 0, 0);
		const end = new Date(2026, 0, 15, 10, 30, 0);
		const range = formatMobileTimeRange(start, end, 'en-US');
		expect(range).toContain('–');
		expect(range.toLowerCase()).toMatch(/9:00/);
		expect(range.toLowerCase()).toMatch(/10:30/);
	});

	it('formats duration for resize HUD', () => {
		const start = new Date(2026, 0, 15, 9, 0, 0);
		expect(formatMobileDuration(start, new Date(2026, 0, 15, 9, 30, 0))).toBe('30m');
		expect(formatMobileDuration(start, new Date(2026, 0, 15, 10, 0, 0))).toBe('1h');
		expect(formatMobileDuration(start, new Date(2026, 0, 15, 10, 30, 0))).toBe('1h 30m');
	});

	it('uses Google-like activation defaults (vs prior select-first-only move)', () => {
		expect(MOBILE_GESTURE_DEFAULTS.longPressMs).toBeLessThan(450);
		expect(MOBILE_GESTURE_DEFAULTS.longPressMs).toBeGreaterThanOrEqual(300);
		expect(MOBILE_GESTURE_DEFAULTS.dragMinDistancePx).toBeLessThan(18);
		expect(MOBILE_GESTURE_DEFAULTS.requireSelectBeforeMove).toBe(false);
	});

	it('formats drag HUD with range and total length', () => {
		const start = new Date(2026, 0, 15, 14, 30, 0);
		const end = new Date(2026, 0, 15, 16, 0, 0);
		const hud = formatMobileAppointmentHud(start, end, { locale: 'en-US' });
		expect(hud).toContain('·');
		expect(hud.toLowerCase()).toMatch(/2:30/);
		expect(hud.toLowerCase()).toMatch(/4:00/);
		expect(hud).toMatch(/1h 30m/);
		expect(
			formatMobileAppointmentHud(start, end, { locale: 'en-US', verb: 'Moving' })
		).toMatch(/^Moving ·/);
	});
});
