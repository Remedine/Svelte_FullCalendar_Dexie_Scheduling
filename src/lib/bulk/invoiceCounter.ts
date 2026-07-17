/**
 * Keep options.nextInvoiceNumber ahead of imported legacy numbers
 * so allocateInvoiceNumber() never collides.
 *
 * App format from allocateInvoiceNumber: `{prefix}-{year}-{seq:4}` e.g. CCW-2026-0042
 */

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Parse sequence from PREFIX-YEAR-SEQ style numbers for the given year. */
export function extractSeqFromInvoiceNumber(
	invoiceNumber: string,
	prefix: string,
	year: number
): number | null {
	const p = (prefix || 'CCW').trim() || 'CCW';
	const re = new RegExp(`^${escapeRegex(p)}-${year}-(\\d+)$`, 'i');
	const m = String(invoiceNumber || '')
		.trim()
		.match(re);
	if (!m) return null;
	const seq = parseInt(m[1], 10);
	return Number.isFinite(seq) ? seq : null;
}

export type InvoiceCounterBump = {
	nextInvoiceNumber: number;
	invoiceNumberYear: number;
	/** True when nextInvoiceNumber increased */
	bumped: boolean;
	/** Highest seq found among imported / existing numbers for this year */
	maxSeqSeen: number;
};

/**
 * Compute the next counter so it is strictly greater than any known PREFIX-YEAR-SEQ.
 */
export function computeInvoiceCounterBump(opts: {
	prefix: string;
	currentNext: number;
	currentYearStored: number;
	/** Calendar year for numbering (usually now) */
	year: number;
	invoiceNumbers: string[];
}): InvoiceCounterBump {
	const prefix = (opts.prefix || 'CCW').trim() || 'CCW';
	const year = opts.year;
	let maxSeq = 0;
	for (const n of opts.invoiceNumbers) {
		const seq = extractSeqFromInvoiceNumber(n, prefix, year);
		if (seq != null && seq > maxSeq) maxSeq = seq;
	}

	// If options year rolled over, ignore old next and start after max seen this year
	let currentNext = opts.currentNext ?? 1;
	if ((opts.currentYearStored ?? year) !== year) {
		currentNext = 1;
	}

	const nextInvoiceNumber = Math.max(currentNext, maxSeq + 1);
	return {
		nextInvoiceNumber,
		invoiceNumberYear: year,
		bumped: nextInvoiceNumber > currentNext || (opts.currentYearStored ?? year) !== year,
		maxSeqSeen: maxSeq
	};
}
