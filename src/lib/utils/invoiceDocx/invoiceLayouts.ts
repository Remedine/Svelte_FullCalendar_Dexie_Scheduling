/**
 * Invoice Word layout styles (#10 double-window compatible).
 * Selected in Admin → Options → Invoice.
 */
export const INVOICE_LAYOUT_IDS = ['quiet', 'pay_first', 'job_packet'] as const;

export type InvoiceLayoutId = (typeof INVOICE_LAYOUT_IDS)[number];

export const DEFAULT_INVOICE_LAYOUT: InvoiceLayoutId = 'quiet';

export interface InvoiceLayoutOption {
	id: InvoiceLayoutId;
	/** Short label for the options UI. */
	label: string;
	/** One-line description. */
	summary: string;
	/** Bullet points for the options card. */
	bullets: string[];
}

export const INVOICE_LAYOUT_OPTIONS: InvoiceLayoutOption[] = [
	{
		id: 'quiet',
		label: 'Quiet letter',
		summary: 'Calm professional letter. Soft hierarchy, right-side totals box.',
		bullets: [
			'Return + bill-to in #10 windows',
			'Service location under the fold',
			'Right-aligned totals box under line items'
		]
	},
	{
		id: 'pay_first',
		label: 'Pay me first',
		summary: 'Amount due is the hero — clear ask for faster payment.',
		bullets: [
			'Large amount due in the header',
			'Full-width amount-due bar under the table',
			'Bill-to + service location side by side'
		]
	},
	{
		id: 'job_packet',
		label: 'Job packet',
		summary: 'Service-ops style when site and billing addresses differ.',
		bullets: [
			'Service location + tax/meta cards under the fold',
			'“Work performed” section title',
			'Explicit payment and notes sections'
		]
	}
];

export function normalizeInvoiceLayout(value: unknown): InvoiceLayoutId {
	if (typeof value === 'string' && (INVOICE_LAYOUT_IDS as readonly string[]).includes(value)) {
		return value as InvoiceLayoutId;
	}
	return DEFAULT_INVOICE_LAYOUT;
}
