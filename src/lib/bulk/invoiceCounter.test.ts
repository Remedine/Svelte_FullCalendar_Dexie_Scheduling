import { describe, expect, it } from 'vitest';
import { computeInvoiceCounterBump, extractSeqFromInvoiceNumber } from './invoiceCounter';

describe('extractSeqFromInvoiceNumber', () => {
	it('parses PREFIX-YEAR-SEQ', () => {
		expect(extractSeqFromInvoiceNumber('CCW-2026-0042', 'CCW', 2026)).toBe(42);
		expect(extractSeqFromInvoiceNumber('ccw-2026-7', 'CCW', 2026)).toBe(7);
	});

	it('ignores wrong year or format', () => {
		expect(extractSeqFromInvoiceNumber('CCW-2025-0042', 'CCW', 2026)).toBeNull();
		expect(extractSeqFromInvoiceNumber('LEG-0001', 'CCW', 2026)).toBeNull();
		expect(extractSeqFromInvoiceNumber('CCW-2026-01-15-001', 'CCW', 2026)).toBeNull();
	});
});

describe('computeInvoiceCounterBump', () => {
	it('bumps past highest imported seq', () => {
		const r = computeInvoiceCounterBump({
			prefix: 'CCW',
			currentNext: 10,
			currentYearStored: 2026,
			year: 2026,
			invoiceNumbers: ['CCW-2026-0005', 'CCW-2026-0042', 'LEG-9']
		});
		expect(r.maxSeqSeen).toBe(42);
		expect(r.nextInvoiceNumber).toBe(43);
		expect(r.bumped).toBe(true);
	});

	it('keeps current when already ahead', () => {
		const r = computeInvoiceCounterBump({
			prefix: 'CCW',
			currentNext: 100,
			currentYearStored: 2026,
			year: 2026,
			invoiceNumbers: ['CCW-2026-0042']
		});
		expect(r.nextInvoiceNumber).toBe(100);
		expect(r.bumped).toBe(false);
	});

	it('resets year and uses max for new year', () => {
		const r = computeInvoiceCounterBump({
			prefix: 'CCW',
			currentNext: 50,
			currentYearStored: 2025,
			year: 2026,
			invoiceNumbers: ['CCW-2026-0003']
		});
		expect(r.nextInvoiceNumber).toBe(4);
		expect(r.invoiceNumberYear).toBe(2026);
		expect(r.bumped).toBe(true);
	});
});
