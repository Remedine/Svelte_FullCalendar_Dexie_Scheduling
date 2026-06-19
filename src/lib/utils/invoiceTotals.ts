import type { InvoiceBillableItem, InvoiceDiscount } from '$lib/utils/invoiceTypes';

export interface InvoiceTotalsInput {
	billableItems: InvoiceBillableItem[];
	invoiceDiscount?: InvoiceDiscount;
	taxRatePercent: number;
}

export interface InvoiceTotalsResult {
	lineGross: number[];
	lineNet: number[];
	subtotalBeforeInvoiceDiscount: number;
	subtotal: number;
	taxAmount: number;
	total: number;
}

export function applyDiscount(base: number, discount?: InvoiceDiscount): number {
	if (!discount || !Number.isFinite(discount.value) || discount.value <= 0) return base;
	if (discount.type === 'amount') return Math.max(0, roundMoney(base - discount.value));
	return Math.max(0, roundMoney(base * (1 - discount.value / 100)));
}

export function roundMoney(n: number): number {
	return Math.round(n * 100) / 100;
}

export function computeLineGross(item: Pick<InvoiceBillableItem, 'price' | 'quantity'>): number {
	return roundMoney((item.price || 0) * (item.quantity || 0));
}

export function computeLineNet(item: InvoiceBillableItem): number {
	return applyDiscount(computeLineGross(item), item.lineDiscount);
}

/** Recompute each line's `total` from qty × rate minus line discount. */
export function normalizeBillableItems(items: InvoiceBillableItem[]): InvoiceBillableItem[] {
	return items.map((item) => ({
		...item,
		total: computeLineNet(item)
	}));
}

export function calculateInvoiceTotals(input: InvoiceTotalsInput): InvoiceTotalsResult {
	const items = normalizeBillableItems(input.billableItems || []);
	const lineGross = items.map(computeLineGross);
	const lineNet = items.map(computeLineNet);
	const subtotalBeforeInvoiceDiscount = roundMoney(lineNet.reduce((s, n) => s + n, 0));
	const subtotal = applyDiscount(subtotalBeforeInvoiceDiscount, input.invoiceDiscount);
	const taxAmount = roundMoney(subtotal * (input.taxRatePercent / 100));
	const total = roundMoney(subtotal + taxAmount);
	return {
		lineGross,
		lineNet,
		subtotalBeforeInvoiceDiscount,
		subtotal,
		taxAmount,
		total
	};
}