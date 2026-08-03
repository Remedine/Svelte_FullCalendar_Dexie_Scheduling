/**
 * Invoice Word layout styles (#10 double-window compatible).
 *
 * App currently ships only **Pay me first** (Options no longer offers a picker).
 * Other layout builders remain for tests / future re-enable.
 */
export const INVOICE_LAYOUT_IDS = ['quiet', 'pay_first', 'job_packet'] as const;

export type InvoiceLayoutId = (typeof INVOICE_LAYOUT_IDS)[number];

/** Only active invoice layout for generated .docx files. */
export const DEFAULT_INVOICE_LAYOUT: InvoiceLayoutId = 'pay_first';

export interface InvoiceLayoutOption {
	id: InvoiceLayoutId;
	/** Short label for the options UI. */
	label: string;
	/** One-line description. */
	summary: string;
	/** Bullet points for the options card. */
	bullets: string[];
}

/** Layout catalog (not shown in Options; pay_first is forced at runtime). */
export const INVOICE_LAYOUT_OPTIONS: InvoiceLayoutOption[] = [
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

/**
 * Normalize a stored/requested layout id.
 * Production path always uses pay_first; explicit non-default ids still work for unit tests.
 */
export function normalizeInvoiceLayout(value: unknown): InvoiceLayoutId {
	if (typeof value === 'string' && (INVOICE_LAYOUT_IDS as readonly string[]).includes(value)) {
		return value as InvoiceLayoutId;
	}
	return DEFAULT_INVOICE_LAYOUT;
}
