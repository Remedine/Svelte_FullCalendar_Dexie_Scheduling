import { describe, it, expect } from 'vitest';
import {
	DEFAULT_TAX_RATE_PERCENT,
	normalizeTaxRateToPercent,
	taxRatePercentToPbDecimal,
	taxRateToDecimal
} from './tax';

describe('tax rate normalization', () => {
	it('uses DEFAULT_TAX_RATE_PERCENT (5) when rate is missing', () => {
		expect(DEFAULT_TAX_RATE_PERCENT).toBe(5);
		expect(normalizeTaxRateToPercent(null)).toBe(5);
		expect(normalizeTaxRateToPercent(undefined)).toBe(5);
		expect(normalizeTaxRateToPercent(Number.NaN)).toBe(5);
	});

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