import type { Client, Job } from '$lib/db';
import { getInvoiceDueDateForJob } from '$lib/utils/dates';
import type {
	InvoiceBillableItem,
	InvoiceClientSnapshot,
	InvoiceDiscount
} from '$lib/utils/invoiceTypes';
import { normalizeBillableItems } from '$lib/utils/invoiceTotals';

export function formatInvoiceNumber(prefix: string, generateDate: Date, version: number): string {
	const p = (prefix || 'CCW').trim() || 'CCW';
	const y = generateDate.getFullYear();
	const m = String(generateDate.getMonth() + 1).padStart(2, '0');
	const d = String(generateDate.getDate()).padStart(2, '0');
	const v = String(Math.max(1, version)).padStart(3, '0');
	return `${p}-${y}-${m}-${d}-${v}`;
}

export function buildClientSnapshotFromClient(client: Client | null | undefined): InvoiceClientSnapshot {
	if (!client) {
		return {
			name: '',
			serviceAddressStreet: '',
			serviceAddressCity: '',
			serviceAddressState: '',
			serviceAddressZip: '',
			useBillingAddress: false,
			phone: '',
			email: ''
		};
	}
	return {
		name: client.name || '',
		serviceAddressStreet: client.serviceAddressStreet || '',
		serviceAddressCity: client.serviceAddressCity || '',
		serviceAddressState: client.serviceAddressState || '',
		serviceAddressZip: client.serviceAddressZip || '',
		useBillingAddress: !!client.useBillingAddress,
		billingAddressStreet: client.billingAddressStreet || '',
		billingAddressCity: client.billingAddressCity || '',
		billingAddressState: client.billingAddressState || '',
		billingAddressZip: client.billingAddressZip || '',
		phone: client.phone || '',
		email: client.email || ''
	};
}

export function billableItemsFromJob(job: Job): InvoiceBillableItem[] {
	const items = (job.billableItems || []).map((item) => ({
		title: item.title || '',
		price: Number(item.price) || 0,
		quantity: Number(item.quantity) || 1,
		unit: (item as InvoiceBillableItem).unit || 'qty',
		total: Number(item.total) || 0
	}));
	return normalizeBillableItems(items.length ? items : [{ title: 'Service', price: 0, quantity: 1, unit: 'qty', total: 0 }]);
}

export function buildSnapshotDefaults(
	job: Job,
	client: Client | null | undefined,
	invoiceDueDays = 30
): {
	clientSnapshot: InvoiceClientSnapshot;
	billableItems: InvoiceBillableItem[];
	dueDate: Date;
	invoiceDate: Date;
} {
	return {
		clientSnapshot: buildClientSnapshotFromClient(client),
		billableItems: billableItemsFromJob(job),
		dueDate: getInvoiceDueDateForJob(job, invoiceDueDays),
		invoiceDate: new Date()
	};
}

/** Adapt snapshot to Client shape for docx address helpers. */
export function clientFromSnapshot(
	snapshot: InvoiceClientSnapshot,
	preferredBillingMethod: Client['preferredBillingMethod'] = 'invoice'
): Client {
	return {
		name: snapshot.name,
		serviceAddressStreet: snapshot.serviceAddressStreet,
		serviceAddressCity: snapshot.serviceAddressCity,
		serviceAddressState: snapshot.serviceAddressState,
		serviceAddressZip: snapshot.serviceAddressZip,
		useBillingAddress: snapshot.useBillingAddress,
		billingAddressStreet: snapshot.billingAddressStreet,
		billingAddressCity: snapshot.billingAddressCity,
		billingAddressState: snapshot.billingAddressState,
		billingAddressZip: snapshot.billingAddressZip,
		phone: snapshot.phone || '',
		email: snapshot.email || '',
		areaOfTown: '',
		preferredBillingMethod,
		createdAt: new Date(),
		updatedAt: new Date()
	};
}

export function emptyInvoiceDiscount(): InvoiceDiscount {
	return { type: 'amount', value: 0 };
}

export function isDocxStale(invoice: {
	updatedAt?: Date;
	lastGeneratedAt?: Date;
	primaryInvoiceFile?: { filename?: string };
}): boolean {
	if (!invoice.primaryInvoiceFile?.filename || !invoice.lastGeneratedAt) return false;
	const updated = invoice.updatedAt instanceof Date ? invoice.updatedAt : new Date(invoice.updatedAt || 0);
	const generated =
		invoice.lastGeneratedAt instanceof Date
			? invoice.lastGeneratedAt
			: new Date(invoice.lastGeneratedAt);
	return updated.getTime() > generated.getTime() + 1000;
}