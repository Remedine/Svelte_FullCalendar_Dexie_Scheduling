import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('$app/environment', () => ({
	browser: true,
	dev: true
}));

import { isPbAuthRejectedError, tryRefreshPbAuth, pb } from './pb';

describe('isPbAuthRejectedError', () => {
	it('detects PocketBase-style status 401/403', () => {
		expect(isPbAuthRejectedError({ status: 401 })).toBe(true);
		expect(isPbAuthRejectedError({ status: 403 })).toBe(true);
		expect(isPbAuthRejectedError({ response: { status: 401 } })).toBe(true);
	});

	it('ignores network and other errors', () => {
		expect(isPbAuthRejectedError({ status: 0 })).toBe(false);
		expect(isPbAuthRejectedError({ status: 500 })).toBe(false);
		expect(isPbAuthRejectedError(new Error('network'))).toBe(false);
		expect(isPbAuthRejectedError(null)).toBe(false);
	});
});

describe('tryRefreshPbAuth', () => {
	const originalOnLine = navigator.onLine;

	beforeEach(() => {
		pb.authStore.clear();
		vi.restoreAllMocks();
	});

	afterEach(() => {
		Object.defineProperty(navigator, 'onLine', {
			configurable: true,
			value: originalOnLine
		});
		pb.authStore.clear();
	});

	it('returns needsReauth false when offline even with no token', async () => {
		Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
		const result = await tryRefreshPbAuth();
		expect(result).toEqual({ ok: false, needsReauth: false });
	});

	it('returns needsReauth true when online with no token', async () => {
		Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
		const result = await tryRefreshPbAuth();
		expect(result).toEqual({ ok: false, needsReauth: true });
	});

	it('returns needsReauth true when authRefresh rejects with 401', async () => {
		Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
		// Save a token that is not valid (isValid false) so we hit refresh path.
		pb.authStore.save('dead-token', {
			id: 'u1',
			email: 'crew@example.com',
			collectionId: 'users',
			collectionName: 'users'
		} as any);

		// Force isValid false if token parse still looks valid in some envs.
		const isValidDesc = Object.getOwnPropertyDescriptor(pb.authStore, 'isValid');
		Object.defineProperty(pb.authStore, 'isValid', {
			configurable: true,
			get: () => false
		});

		const authRefresh = vi.fn().mockRejectedValue({ status: 401 });
		vi.spyOn(pb, 'collection').mockReturnValue({ authRefresh } as any);

		const result = await tryRefreshPbAuth();
		expect(result).toEqual({ ok: false, needsReauth: true });
		expect(authRefresh).toHaveBeenCalled();

		if (isValidDesc) {
			Object.defineProperty(pb.authStore, 'isValid', isValidDesc);
		}
	});

	it('returns needsReauth false on transient 500', async () => {
		Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
		pb.authStore.save('maybe-token', {
			id: 'u1',
			email: 'crew@example.com',
			collectionId: 'users',
			collectionName: 'users'
		} as any);
		Object.defineProperty(pb.authStore, 'isValid', {
			configurable: true,
			get: () => false
		});

		const authRefresh = vi.fn().mockRejectedValue({ status: 500 });
		vi.spyOn(pb, 'collection').mockReturnValue({ authRefresh } as any);

		const result = await tryRefreshPbAuth();
		expect(result).toEqual({ ok: false, needsReauth: false });
	});
});
