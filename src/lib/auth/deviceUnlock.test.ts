import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$app/environment', () => ({
	browser: true,
	dev: true
}));

import {
	DEFAULT_IDLE_LOCK_MS,
	IDLE_LOCK_MS,
	MAX_PIN_ATTEMPTS,
	PIN_LENGTH,
	validatePinFormat,
	markAppHidden,
	clearAppHidden,
	shouldLockAfterReturn,
	declineQuickUnlockSetup,
	clearQuickUnlockDecline,
	shouldOfferQuickUnlockSetup,
	canOfferQuickUnlockToastAfterLogin,
	userNeedsWelcomeOnboarding,
	userNeedsPhotoOnboarding,
	getPinAttemptsRemaining,
	recordFailedPinAttempt,
	clearPinAttempts,
	getIdleLockMs,
	hasUsableUnlockMethod,
	shouldRequireUnlock,
	markFreshLogin,
	isWithinFreshLoginGrace
} from './deviceUnlock';

describe('deviceUnlock', () => {
	beforeEach(() => {
		sessionStorage.clear();
		localStorage.clear();
	});

	it('validatePinFormat accepts exactly 4 digits', () => {
		expect(validatePinFormat('1234')).toBeNull();
	});

	it('validatePinFormat rejects non-4-digit PINs', () => {
		expect(validatePinFormat('12ab')).toMatch(/exactly/i);
		expect(validatePinFormat('123')).toMatch(/exactly/i);
		expect(validatePinFormat('12345')).toMatch(/exactly/i);
	});

	it('PIN_LENGTH is 4', () => {
		expect(PIN_LENGTH).toBe(4);
	});

	it('shouldLockAfterReturn is false until idle threshold', () => {
		markAppHidden();
		expect(shouldLockAfterReturn(DEFAULT_IDLE_LOCK_MS)).toBe(false);

		const hiddenAt = Date.now() - DEFAULT_IDLE_LOCK_MS - 1;
		sessionStorage.setItem('ccw_app_hidden_at', String(hiddenAt));
		expect(shouldLockAfterReturn(DEFAULT_IDLE_LOCK_MS)).toBe(true);
	});

	it('clearAppHidden removes hidden marker', () => {
		markAppHidden();
		clearAppHidden();
		expect(shouldLockAfterReturn(0)).toBe(false);
	});

	it('shouldOfferQuickUnlockSetup respects decline flag', async () => {
		const db = (await import('$lib/db')).db;
		await db.deviceAuth.clear();

		declineQuickUnlockSetup('user-1');
		await expect(shouldOfferQuickUnlockSetup('user-1')).resolves.toBe(false);
		await expect(shouldOfferQuickUnlockSetup('user-2')).resolves.toBe(true);

		clearQuickUnlockDecline();
		await expect(shouldOfferQuickUnlockSetup('user-1')).resolves.toBe(true);
	});

	it('canOfferQuickUnlockToastAfterLogin waits for welcome and photo onboarding', () => {
		expect(
			canOfferQuickUnlockToastAfterLogin({
				verified: false,
				forcePhotoUpdate: false
			})
		).toBe(false);
		expect(
			canOfferQuickUnlockToastAfterLogin({
				verified: true,
				forcePhotoUpdate: true,
				photo: ''
			})
		).toBe(false);
		expect(
			canOfferQuickUnlockToastAfterLogin({
				verified: true,
				forcePhotoUpdate: true,
				photo: 'data:image/png;base64,abc'
			})
		).toBe(true);
		expect(
			canOfferQuickUnlockToastAfterLogin({
				verified: true,
				forcePhotoUpdate: false
			})
		).toBe(true);
	});

	it('userNeedsWelcomeOnboarding and userNeedsPhotoOnboarding', () => {
		expect(userNeedsWelcomeOnboarding({ verified: false })).toBe(true);
		expect(userNeedsWelcomeOnboarding({ verified: true })).toBe(false);
		expect(
			userNeedsPhotoOnboarding({ verified: true, forcePhotoUpdate: true, photo: '  ' })
		).toBe(true);
		expect(
			userNeedsPhotoOnboarding({
				verified: true,
				forcePhotoUpdate: true,
				photo: 'data:image/png;base64,x'
			})
		).toBe(false);
	});

	it('shouldOfferQuickUnlockSetup is false when already enabled', async () => {
		const db = (await import('$lib/db')).db;
		await db.deviceAuth.put({
			id: 'current',
			enabled: true,
			pinEnabled: true,
			biometricEnabled: false,
			userId: 'user-1'
		});

		await expect(shouldOfferQuickUnlockSetup('user-1')).resolves.toBe(false);
	});

	it('tracks PIN attempts and clears on success path', () => {
		expect(getPinAttemptsRemaining()).toBe(MAX_PIN_ATTEMPTS);
		expect(recordFailedPinAttempt()).toBe(MAX_PIN_ATTEMPTS - 1);
		clearPinAttempts();
		expect(getPinAttemptsRemaining()).toBe(MAX_PIN_ATTEMPTS);
	});

	it('getIdleLockMs uses options when set', async () => {
		const db = (await import('$lib/db')).db;
		await db.options.put({
			id: '1',
			taxRate: 5,
			defaultJobDurationHours: 2,
			invoiceDueDays: 30,
			quickUnlockIdleMinutes: 30,
			areasOfTown: [],
			defaultBillableItems: [],
			cancelReasons: [],
			lastUpdated: new Date(),
			updatedBy: 'test'
		});

		await expect(getIdleLockMs()).resolves.toBe(30 * 60 * 1000);
	});

	it('getIdleLockMs falls back to default', async () => {
		const db = (await import('$lib/db')).db;
		await db.options.delete('1');
		await expect(getIdleLockMs()).resolves.toBe(IDLE_LOCK_MS);
	});

	it('hasUsableUnlockMethod requires stored credentials', () => {
		expect(hasUsableUnlockMethod(null)).toBe(false);
		expect(
			hasUsableUnlockMethod({
				id: 'current',
				enabled: true,
				pinEnabled: true,
				biometricEnabled: false
			})
		).toBe(false);
		expect(
			hasUsableUnlockMethod({
				id: 'current',
				enabled: true,
				pinEnabled: true,
				biometricEnabled: false,
				pinHash: '$2a$10$hash'
			})
		).toBe(true);
	});

	it('fresh login grace suppresses immediate re-lock window', () => {
		expect(isWithinFreshLoginGrace()).toBe(false);
		markFreshLogin();
		expect(isWithinFreshLoginGrace()).toBe(true);
		sessionStorage.setItem('ccw_fresh_login_until', String(Date.now() - 1));
		expect(isWithinFreshLoginGrace()).toBe(false);
	});

	it('shouldRequireUnlock clears corrupt deviceAuth instead of locking', async () => {
		const db = (await import('$lib/db')).db;
		await db.deviceAuth.put({
			id: 'current',
			enabled: true,
			pinEnabled: true,
			biometricEnabled: false,
			userId: 'user-1'
		});

		await expect(shouldRequireUnlock('user-1')).resolves.toBe(false);
		await expect(db.deviceAuth.get('current')).resolves.toBeUndefined();
	});
});