/**
 * After bulk invoice import, ensure options.nextInvoiceNumber is past imported seqs.
 */
import { computeInvoiceCounterBump, type InvoiceCounterBump } from './invoiceCounter';
import { authHeaders, pbBase } from './pbHttp';

export type OptionsBumpResult = InvoiceCounterBump & {
	applied: boolean;
	error?: string;
};

async function loadOptionsRecord(
	authHeader: string
): Promise<{ id: string; record: Record<string, unknown> } | null> {
	const base = pbBase();
	const url = new URL(`${base}/api/collections/options/records`);
	url.searchParams.set('page', '1');
	url.searchParams.set('perPage', '1');

	const res = await fetch(url.toString(), { headers: authHeaders(authHeader) });
	if (!res.ok) return null;
	const data = (await res.json()) as { items?: Record<string, unknown>[] };
	const rec = data.items?.[0];
	if (!rec?.id) return null;
	return { id: String(rec.id), record: rec };
}

/**
 * Bump nextInvoiceNumber using all known invoice numbers (imported + existing).
 */
export async function bumpNextInvoiceNumberAfterImport(
	authHeader: string,
	invoiceNumbers: string[]
): Promise<OptionsBumpResult> {
	const year = new Date().getFullYear();
	try {
		const loaded = await loadOptionsRecord(authHeader);
		if (!loaded) {
			return {
				nextInvoiceNumber: 1,
				invoiceNumberYear: year,
				bumped: false,
				maxSeqSeen: 0,
				applied: false,
				error: 'Options record not found'
			};
		}

		const prefix = String(loaded.record.invoiceNumberPrefix || 'CCW');
		const currentNext = Number(loaded.record.nextInvoiceNumber ?? 1) || 1;
		const currentYearStored = Number(loaded.record.invoiceNumberYear ?? year) || year;

		const bump = computeInvoiceCounterBump({
			prefix,
			currentNext,
			currentYearStored,
			year,
			invoiceNumbers
		});

		if (!bump.bumped) {
			return { ...bump, applied: false };
		}

		const res = await fetch(
			`${pbBase()}/api/collections/options/records/${encodeURIComponent(loaded.id)}`,
			{
				method: 'PATCH',
				headers: authHeaders(authHeader),
				body: JSON.stringify({
					nextInvoiceNumber: bump.nextInvoiceNumber,
					invoiceNumberYear: bump.invoiceNumberYear
				})
			}
		);

		if (!res.ok) {
			const body = await res.text().catch(() => '');
			return {
				...bump,
				applied: false,
				error: `Options update failed (${res.status}): ${body.slice(0, 200)}`
			};
		}

		return { ...bump, applied: true };
	} catch (err) {
		return {
			nextInvoiceNumber: 1,
			invoiceNumberYear: year,
			bumped: false,
			maxSeqSeen: 0,
			applied: false,
			error: err instanceof Error ? err.message : 'Options bump failed'
		};
	}
}
