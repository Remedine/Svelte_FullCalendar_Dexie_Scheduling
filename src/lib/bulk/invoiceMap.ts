import type { BulkInvoice } from './schema';

function normalizeBillables(
	items: BulkInvoice['billableItems']
): Array<{ title: string; price: number; quantity: number; total: number }> | undefined {
	if (!items?.length) return undefined;
	return items.map((item) => {
		const quantity = item.quantity ?? item.hours ?? 1;
		const price = Number(item.price) || 0;
		const total = item.total != null ? Number(item.total) : price * quantity;
		return { title: item.title, price, quantity, total };
	});
}

/** Map validated bulk invoice → PocketBase invoices payload (relations set by caller). */
export function bulkInvoiceToPbPayload(
	inv: BulkInvoice,
	jobPbId: string,
	clientPbId: string
): Record<string, unknown> {
	const billableItems = normalizeBillables(inv.billableItems);
	const payload: Record<string, unknown> = {
		job: jobPbId,
		client: clientPbId,
		status: inv.status || 'sent',
		amount: Number(inv.amount) || 0,
		importSource: inv.importSource || 'bulk-upload'
	};

	if (inv.externalId) payload.importKey = inv.externalId;
	if (inv.invoiceNumber) payload.invoiceNumber = inv.invoiceNumber;
	if (inv.dueDate) {
		payload.dueDate = inv.dueDate instanceof Date ? inv.dueDate.toISOString() : inv.dueDate;
	}
	if (inv.paidAt) {
		payload.paidAt = inv.paidAt instanceof Date ? inv.paidAt.toISOString() : inv.paidAt;
	}
	if (inv.subtotal != null) payload.subtotal = Number(inv.subtotal);
	if (inv.taxAmount != null) payload.taxAmount = Number(inv.taxAmount);
	if (inv.notes) payload.notes = inv.notes;
	if (billableItems) payload.billableItems = billableItems;

	return payload;
}
