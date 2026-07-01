import { describe, expect, it } from 'vitest';
import { isRetentionAnchorDay } from './anchorDays';

describe('isRetentionAnchorDay', () => {
	it('matches monthly anchor days', () => {
		expect(isRetentionAnchorDay('2026-07-01')).toBe(true);
		expect(isRetentionAnchorDay('2026-07-08')).toBe(true);
		expect(isRetentionAnchorDay('2026-07-10')).toBe(false);
	});

	it('uses last day of month as February anchor', () => {
		expect(isRetentionAnchorDay('2026-02-28')).toBe(true);
	});
});