import { describe, it, expect } from 'vitest';
import { isPendingLocalPhoto } from './avatarImage';

describe('isPendingLocalPhoto', () => {
	it('detects local data URL photos', () => {
		expect(isPendingLocalPhoto('data:image/jpeg;base64,abc')).toBe(true);
		expect(isPendingLocalPhoto('photo_xyz.jpg')).toBe(false);
		expect(isPendingLocalPhoto(undefined)).toBe(false);
		expect(isPendingLocalPhoto(null)).toBe(false);
		expect(isPendingLocalPhoto('https://example.com/a.jpg')).toBe(false);
	});
});
