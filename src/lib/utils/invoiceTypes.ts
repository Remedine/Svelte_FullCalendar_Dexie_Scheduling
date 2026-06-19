/** Shared invoice editor types (snapshot model). */

export type DiscountType = 'amount' | 'percent';

export interface InvoiceDiscount {
	type: DiscountType;
	value: number;
	/** Shown on the invoice document (e.g. "Senior discount", "Repeat customer"). */
	description?: string;
}

export interface InvoiceBillableItem {
	title: string;
	price: number;
	quantity: number;
	unit?: 'hour' | 'qty';
	lineDiscount?: InvoiceDiscount;
	total: number;
}

export interface InvoiceClientSnapshot {
	name: string;
	serviceAddressStreet: string;
	serviceAddressCity: string;
	serviceAddressState: string;
	serviceAddressZip: string;
	useBillingAddress?: boolean;
	billingAddressStreet?: string;
	billingAddressCity?: string;
	billingAddressState?: string;
	billingAddressZip?: string;
	phone?: string;
	email?: string;
}