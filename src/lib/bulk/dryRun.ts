/**
 * Validate a bulk payload and produce a dry-run report (no database I/O).
 * Later slices will add create/update/skip against PocketBase.
 */
import {
	bulkClientSchema,
	bulkInvoiceSchema,
	bulkJobSchema,
	MAX_BULK_ROWS,
	type BulkClient,
	type BulkEntity,
	type BulkInvoice,
	type BulkJob,
	type BulkPayload
} from './schema';

export type BulkRowAction = 'would_create' | 'error';

export type BulkRowResult = {
	entity: BulkEntity;
	index: number;
	action: BulkRowAction;
	/** externalId or natural key for display */
	key: string;
	summary: string;
	errors?: string[];
	/** Validated data when action is would_create */
	data?: BulkClient | BulkJob | BulkInvoice;
};

export type BulkEntitySummary = {
	total: number;
	valid: number;
	error: number;
};

export type BulkDryRunResult = {
	dryRun: true;
	/** Commit is not implemented in slice 1 */
	commitSupported: false;
	summary: {
		clients: BulkEntitySummary;
		jobs: BulkEntitySummary;
		invoices: BulkEntitySummary;
		totalValid: number;
		totalError: number;
		totalRows: number;
	};
	rows: BulkRowResult[];
	/** Payload-level errors (e.g. too many rows) */
	payloadErrors: string[];
};

function emptySummary(): BulkEntitySummary {
	return { total: 0, valid: 0, error: 0 };
}

function formatZodIssues(issues: { path: PropertyKey[]; message: string }[]): string[] {
	return issues.map((i) => {
		const path = i.path.length ? i.path.join('.') + ': ' : '';
		return `${path}${i.message}`;
	});
}

function clientKey(c: BulkClient, index: number): string {
	return c.externalId || c.email || c.name || `row-${index}`;
}

function jobKey(j: BulkJob, index: number): string {
	return j.externalId || j.title || `row-${index}`;
}

function invoiceKey(inv: BulkInvoice, index: number): string {
	return inv.externalId || inv.invoiceNumber || `row-${index}`;
}

export function runBulkDryRun(payload: BulkPayload): BulkDryRunResult {
	const rows: BulkRowResult[] = [];
	const payloadErrors: string[] = [];
	const summary = {
		clients: emptySummary(),
		jobs: emptySummary(),
		invoices: emptySummary(),
		totalValid: 0,
		totalError: 0,
		totalRows: 0
	};

	const clientCount = payload.clients?.length ?? 0;
	const jobCount = payload.jobs?.length ?? 0;
	const invoiceCount = payload.invoices?.length ?? 0;
	const total = clientCount + jobCount + invoiceCount;

	if (total === 0) {
		payloadErrors.push('Payload must include at least one of clients, jobs, or invoices');
	}
	if (total > MAX_BULK_ROWS) {
		payloadErrors.push(`Too many rows (${total}); max is ${MAX_BULK_ROWS}`);
	}

	// Track externalIds within this payload for duplicate + cross-ref checks
	const clientExternalIds = new Set<string>();
	const jobExternalIds = new Set<string>();
	const seenClientExt = new Map<string, number>();
	const seenJobExt = new Map<string, number>();
	const seenInvoiceExt = new Map<string, number>();
	const seenInvoiceNumbers = new Map<string, number>();

	// --- Clients ---
	if (payload.clients) {
		for (let i = 0; i < payload.clients.length; i++) {
			summary.clients.total++;
			summary.totalRows++;
			const parsed = bulkClientSchema.safeParse(payload.clients[i]);
			if (!parsed.success) {
				summary.clients.error++;
				summary.totalError++;
				rows.push({
					entity: 'clients',
					index: i,
					action: 'error',
					key: guessKey(payload.clients[i], i),
					summary: 'Invalid client row',
					errors: formatZodIssues(parsed.error.issues)
				});
				continue;
			}
			const data = parsed.data;
			const key = clientKey(data, i);
			const errors: string[] = [];

			if (data.externalId) {
				const prev = seenClientExt.get(data.externalId);
				if (prev !== undefined) {
					errors.push(`Duplicate externalId "${data.externalId}" (also row ${prev})`);
				} else {
					seenClientExt.set(data.externalId, i);
					clientExternalIds.add(data.externalId);
				}
			}

			if (errors.length) {
				summary.clients.error++;
				summary.totalError++;
				rows.push({
					entity: 'clients',
					index: i,
					action: 'error',
					key,
					summary: data.name,
					errors
				});
			} else {
				summary.clients.valid++;
				summary.totalValid++;
				rows.push({
					entity: 'clients',
					index: i,
					action: 'would_create',
					key,
					summary: `${data.name} · ${data.serviceAddressCity}`,
					data
				});
			}
		}
	}

	// --- Jobs ---
	if (payload.jobs) {
		for (let i = 0; i < payload.jobs.length; i++) {
			summary.jobs.total++;
			summary.totalRows++;
			const parsed = bulkJobSchema.safeParse(payload.jobs[i]);
			if (!parsed.success) {
				summary.jobs.error++;
				summary.totalError++;
				rows.push({
					entity: 'jobs',
					index: i,
					action: 'error',
					key: guessKey(payload.jobs[i], i),
					summary: 'Invalid job row',
					errors: formatZodIssues(parsed.error.issues)
				});
				continue;
			}
			const data = parsed.data;
			const key = jobKey(data, i);
			const errors: string[] = [];

			if (data.externalId) {
				const prev = seenJobExt.get(data.externalId);
				if (prev !== undefined) {
					errors.push(`Duplicate externalId "${data.externalId}" (also row ${prev})`);
				} else {
					seenJobExt.set(data.externalId, i);
					jobExternalIds.add(data.externalId);
				}
			}

			// Cross-ref: if clientExternalId is set and clients are in this payload, require match
			if (data.clientExternalId && payload.clients?.length) {
				if (!clientExternalIds.has(data.clientExternalId)) {
					// Also allow if that client row failed validation — still report missing
					const anyClientExt = (payload.clients as unknown[]).some((c) => {
						if (c && typeof c === 'object' && 'externalId' in c) {
							return String((c as { externalId?: string }).externalId) === data.clientExternalId;
						}
						return false;
					});
					if (!anyClientExt) {
						errors.push(
							`clientExternalId "${data.clientExternalId}" not found in this payload's clients`
						);
					} else if (!clientExternalIds.has(data.clientExternalId)) {
						errors.push(
							`clientExternalId "${data.clientExternalId}" refers to an invalid client row`
						);
					}
				}
			}

			if (errors.length) {
				summary.jobs.error++;
				summary.totalError++;
				rows.push({
					entity: 'jobs',
					index: i,
					action: 'error',
					key,
					summary: data.title,
					errors
				});
			} else {
				summary.jobs.valid++;
				summary.totalValid++;
				const clientRef = data.clientExternalId || data.clientEmail || data.clientPbId || '';
				rows.push({
					entity: 'jobs',
					index: i,
					action: 'would_create',
					key,
					summary: `${data.title} → ${clientRef}`,
					data
				});
			}
		}
	}

	// --- Invoices ---
	if (payload.invoices) {
		for (let i = 0; i < payload.invoices.length; i++) {
			summary.invoices.total++;
			summary.totalRows++;
			const parsed = bulkInvoiceSchema.safeParse(payload.invoices[i]);
			if (!parsed.success) {
				summary.invoices.error++;
				summary.totalError++;
				rows.push({
					entity: 'invoices',
					index: i,
					action: 'error',
					key: guessKey(payload.invoices[i], i),
					summary: 'Invalid invoice row',
					errors: formatZodIssues(parsed.error.issues)
				});
				continue;
			}
			const data = parsed.data;
			const key = invoiceKey(data, i);
			const errors: string[] = [];

			if (data.externalId) {
				const prev = seenInvoiceExt.get(data.externalId);
				if (prev !== undefined) {
					errors.push(`Duplicate externalId "${data.externalId}" (also row ${prev})`);
				} else {
					seenInvoiceExt.set(data.externalId, i);
				}
			}

			if (data.invoiceNumber) {
				const prev = seenInvoiceNumbers.get(data.invoiceNumber);
				if (prev !== undefined) {
					errors.push(`Duplicate invoiceNumber "${data.invoiceNumber}" (also row ${prev})`);
				} else {
					seenInvoiceNumbers.set(data.invoiceNumber, i);
				}
			}

			if (data.jobExternalId && payload.jobs?.length) {
				if (!jobExternalIds.has(data.jobExternalId)) {
					const anyJobExt = (payload.jobs as unknown[]).some((j) => {
						if (j && typeof j === 'object' && 'externalId' in j) {
							return String((j as { externalId?: string }).externalId) === data.jobExternalId;
						}
						return false;
					});
					if (!anyJobExt) {
						errors.push(
							`jobExternalId "${data.jobExternalId}" not found in this payload's jobs`
						);
					} else if (!jobExternalIds.has(data.jobExternalId)) {
						errors.push(`jobExternalId "${data.jobExternalId}" refers to an invalid job row`);
					}
				}
			}

			if (errors.length) {
				summary.invoices.error++;
				summary.totalError++;
				rows.push({
					entity: 'invoices',
					index: i,
					action: 'error',
					key,
					summary: data.invoiceNumber || key,
					errors
				});
			} else {
				summary.invoices.valid++;
				summary.totalValid++;
				const jobRef = data.jobExternalId || data.jobPbId || '';
				rows.push({
					entity: 'invoices',
					index: i,
					action: 'would_create',
					key,
					summary: `${data.invoiceNumber || key} · ${data.status} · job ${jobRef}`,
					data
				});
			}
		}
	}

	// If payload-level fatal errors, mark nothing as commit-ready beyond report
	if (payloadErrors.length && summary.totalRows === 0) {
		// already empty
	}

	return {
		dryRun: true,
		commitSupported: false,
		summary,
		rows,
		payloadErrors
	};
}

function guessKey(raw: unknown, index: number): string {
	if (raw && typeof raw === 'object') {
		const o = raw as Record<string, unknown>;
		for (const k of ['externalId', 'name', 'title', 'invoiceNumber', 'email']) {
			if (typeof o[k] === 'string' && o[k]) return String(o[k]);
		}
	}
	return `row-${index}`;
}
