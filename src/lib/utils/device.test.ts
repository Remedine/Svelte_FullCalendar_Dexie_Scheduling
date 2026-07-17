import { describe, it, expect } from 'vitest';
import {
	MOBILE_LANDSCAPE_MAX_HEIGHT_PX,
	MOBILE_MAX_WIDTH_PX,
	mobileViewportMediaQuery
} from './device';

describe('device viewport helpers', () => {
	it('exposes stable breakpoints', () => {
		expect(MOBILE_MAX_WIDTH_PX).toBe(768);
		expect(MOBILE_LANDSCAPE_MAX_HEIGHT_PX).toBe(500);
	});

	it('builds a media query covering portrait width and short landscape height', () => {
		const q = mobileViewportMediaQuery();
		expect(q).toContain(`(max-width: ${MOBILE_MAX_WIDTH_PX}px)`);
		expect(q).toContain('(orientation: landscape)');
		expect(q).toContain(`(max-height: ${MOBILE_LANDSCAPE_MAX_HEIGHT_PX}px)`);
	});
});
