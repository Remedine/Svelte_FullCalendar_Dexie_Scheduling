import { describe, it, expect } from 'vitest';
import {
	normalizeTaxRateToPercent,
	taxRatePercentToPbDecimal,
	taxRateToDecimal
} from './tax';

describe('tax rate normalization', () => {
	it('treats values >= 1 as percent', () => {
		expect(normalizeTaxRateToPercent(5)).toBe(5);
		expect(normalizeTaxRateToPercent(8)).toBe(8);
	});

	it('converts decimal fractions to percent', () => {
		expect(normalizeTaxRateToPercent(0.065)).toBe(6.5);
		expect(normalizeTaxRateToPercent(0.08)).toBe(8);
	});

	it('converts percent to PB decimal', () => {
		expect(taxRatePercentToPbDecimal(5)).toBe(0.05);
		expect(taxRatePercentToPbDecimal(0.08)).toBeCloseTo(0.08);
	});

	it('taxRateToDecimal returns multiplier', () => {
		expect(taxRateToDecimal(5)).toBe(0.05);
		expect(taxRateToDecimal(0.08)).toBeCloseTo(0.08);
	});
});