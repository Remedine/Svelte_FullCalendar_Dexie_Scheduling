import { normalizeTaxRateToPercent, taxRatePercentToPbDecimal } from '$lib/utils/tax';
import type { BulkJob } from './schema';

function normalizeBillables(
	items: BulkJob['billableItems']
): Array<{ title: string; price: number; quantity: number; total: number }> {
	if (!items?.length) {
		return [{ title: 'Service', price: 0, quantity: 1, total: 0 }];
	}
	return items.map((item) => {
		const quantity = item.quantity ?? item.hours ?? 1;
		const price = Number(item.price) || 0;
		const total = item.total != null ? Number(item.total) : price * quantity;
		return {
			title: item.title,
			price,
			quantity,
			total
		};
	});
}

/** Map validated bulk job → PocketBase jobs payload (client relation set by caller). */
export function bulkJobToPbPayload(
	job: BulkJob,
	clientPbId: string,
	defaultTaxPercent = 5
): Record<string, unknown> {
	const billableItems = normalizeBillables(job.billableItems);
	const subtotal =
		job.subtotal != null
			? Number(job.subtotal)
			: billableItems.reduce((s, i) => s + (i.total || 0), 0);
	const taxPercent = normalizeTaxRateToPercent(job.taxRate, defaultTaxPercent);
	const taxAmount =
		job.taxAmount != null ? Number(job.taxAmount) : (subtotal * taxPercent) / 100;
	const totalAmount =
		job.totalAmount != null ? Number(job.totalAmount) : subtotal + taxAmount;

	const payload: Record<string, unknown> = {
		title: job.title,
		start: job.start instanceof Date ? job.start.toISOString() : job.start,
		end: job.end instanceof Date ? job.end.toISOString() : job.end,
		client: clientPbId,
		status: job.status || 'scheduled',
		assignedCrew: job.assignedCrew || [],
		areaOfTown: job.areaOfTown || '',
		billableItems,
		subtotal,
		taxRate: taxRatePercentToPbDecimal(taxPercent),
		taxAmount,
		totalAmount,
		importSource: job.importSource || 'bulk-upload'
	};

	if (job.externalId) payload.importKey = job.externalId;
	if (job.notes) payload.notes = job.notes;

	return payload;
}
