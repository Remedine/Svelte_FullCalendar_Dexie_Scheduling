import { describe, it, expect } from 'vitest';
import { validatePinFormat } from './deviceUnlock';

describe('deviceUnlock', () => {
	it('validatePinFormat accepts 4–8 digit PINs', () => {
		expect(validatePinFormat('1234')).toBeNull();
		expect(validatePinFormat('12345678')).toBeNull();
	});

	it('validatePinFormat rejects non-digits and wrong length', () => {
		expect(validatePinFormat('12ab')).toMatch(/digits/i);
		expect(validatePinFormat('123')).toMatch(/4–8/);
		expect(validatePinFormat('123456789')).toMatch(/4–8/);
	});
});