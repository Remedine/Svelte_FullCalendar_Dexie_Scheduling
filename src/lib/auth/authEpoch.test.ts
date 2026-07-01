import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: true }));

import {
	AUTH_EPOCH_STORAGE_KEY,
	getLocalAuthEpoch,
	setLocalAuthEpoch
} from './authEpoch';

describe('authEpoch storage', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('defaults missing local epoch to 0', () => {
		expect(getLocalAuthEpoch()).toBe(0);
	});

	it('stores and reads integer epochs', () => {
		setLocalAuthEpoch(3);
		expect(localStorage.getItem(AUTH_EPOCH_STORAGE_KEY)).toBe('3');
		expect(getLocalAuthEpoch()).toBe(3);
	});

	it('clamps invalid values to 0', () => {
		localStorage.setItem(AUTH_EPOCH_STORAGE_KEY, 'not-a-number');
		expect(getLocalAuthEpoch()).toBe(0);
		setLocalAuthEpoch(-5);
		expect(getLocalAuthEpoch()).toBe(0);
	});
});