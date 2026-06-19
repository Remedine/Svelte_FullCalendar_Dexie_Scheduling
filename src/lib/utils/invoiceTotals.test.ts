import { describe, expect, it } from 'vitest';
import { applyDiscount, calculateInvoiceTotals, computeLineNet } from '$lib/utils/invoiceTotals';

describe('invoiceTotals', () => {
	it('applies percent line discount', () => {
		const net = computeLineNet({
			title: 'Wash',
			price: 100,
			quantity: 2,
			lineDiscount: { type: 'percent', value: 10 },
			total: 0
		});
		expect(net).toBe(180);
	});

	it('applies invoice-level dollar discount before tax', () => {
		const result = calculateInvoiceTotals({
			billableItems: [{ title: 'A', price: 100, quantity: 1, total: 100 }],
			invoiceDiscount: { type: 'amount', value: 20 },
			taxRatePercent: 5
		});
		expect(result.subtotal).toBe(80);
		expect(result.taxAmount).toBe(4);
		expect(result.total).toBe(84);
	});
});