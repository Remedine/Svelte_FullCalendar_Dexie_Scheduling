import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$app/environment', () => ({
	browser: true,
	dev: true
}));

import {
	DEFAULT_DESKTOP_SESSION_IDLE_MINUTES,
	getDesktopSessionIdleMs,
	isDesktopSessionExpired,
	markSessionActivity,
	clearSessionActivity
} from './sessionSecurity';

describe('sessionSecurity', () => {
	beforeEach(() => {
		sessionStorage.clear();
	});

	it('isDesktopSessionExpired is false until idle threshold', () => {
		markSessionActivity();
		expect(isDesktopSessionExpired(60_000)).toBe(false);

		const last = Date.now() - 60_001;
		sessionStorage.setItem('ccw_last_activity_at', String(last));
		expect(isDesktopSessionExpired(60_000)).toBe(true);
	});

	it('isDesktopSessionExpired is false when no activity recorded', () => {
		expect(isDesktopSessionExpired(1)).toBe(false);
	});

	it('clearSessionActivity removes marker', () => {
		markSessionActivity();
		clearSessionActivity();
		expect(isDesktopSessionExpired(0)).toBe(false);
	});

	it('getDesktopSessionIdleMs uses options when set', async () => {
		const db = (await import('$lib/db')).db;
		await db.options.put({
			id: '1',
			taxRate: 5,
			defaultJobDurationHours: 2,
			invoiceDueDays: 30,
			desktopSecurityIdleMinutes: 45,
			areasOfTown: [],
			defaultBillableItems: [],
			cancelReasons: [],
			lastUpdated: new Date(),
			updatedBy: 'test'
		});

		await expect(getDesktopSessionIdleMs()).resolves.toBe(45 * 60 * 1000);
	});

	it('getDesktopSessionIdleMs falls back to default', async () => {
		const db = (await import('$lib/db')).db;
		await db.options.delete('1');
		await expect(getDesktopSessionIdleMs()).resolves.toBe(
			DEFAULT_DESKTOP_SESSION_IDLE_MINUTES * 60 * 1000
		);
	});
});