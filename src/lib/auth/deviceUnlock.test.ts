import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$app/environment', () => ({
	browser: true,
	dev: true
}));

import {
	IDLE_LOCK_MS,
	validatePinFormat,
	markAppHidden,
	clearAppHidden,
	shouldLockAfterReturn,
	declineQuickUnlockSetup,
	clearQuickUnlockDecline,
	shouldOfferQuickUnlockSetup
} from './deviceUnlock';

describe('deviceUnlock', () => {
	beforeEach(() => {
		sessionStorage.clear();
		localStorage.clear();
	});

	it('validatePinFormat accepts 4–8 digit PINs', () => {
		expect(validatePinFormat('1234')).toBeNull();
		expect(validatePinFormat('12345678')).toBeNull();
	});

	it('validatePinFormat rejects non-digits and wrong length', () => {
		expect(validatePinFormat('12ab')).toMatch(/digits/i);
		expect(validatePinFormat('123')).toMatch(/4–8/);
		expect(validatePinFormat('123456789')).toMatch(/4–8/);
	});

	it('shouldLockAfterReturn is false until idle threshold', () => {
		markAppHidden();
		expect(shouldLockAfterReturn(IDLE_LOCK_MS)).toBe(false);

		const hiddenAt = Date.now() - IDLE_LOCK_MS - 1;
		sessionStorage.setItem('ccw_app_hidden_at', String(hiddenAt));
		expect(shouldLockAfterReturn(IDLE_LOCK_MS)).toBe(true);
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
});